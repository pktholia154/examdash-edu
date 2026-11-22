import https from 'node:https';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  CatalogItemDTO,
  CollectionName,
  UserPurchaseRecord,
} from '../../lib/types/catalog';
import { makeFirestoreSafeCartKey } from '../../lib/registry/content-type-registry';
import {
  ensureDefaultDbUserDocument,
  syncSinglePurchaseToDefaultDb,
} from '../firebase/default-db-mirror';
import { verifyCallerPurchaseRecord } from '../repositories/catalog-repository';

function sanitizeBoundedString(
  val: string | null | undefined,
  maxLen: number,
  fallback: string
): string {
  const trimmed = (val ?? '').trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLen);
}

function getFirestoreDbResourceRoot(overrideDatabaseId?: string): {
  projectId: string;
  databaseId: string;
  docPrefix: string;
  restBase: string;
} {
  const projectId = firebaseConfig.projectId || 'examdash-ed';
  const databaseId =
    overrideDatabaseId || firebaseConfig.firestoreDatabaseId || '(default)';
  const docPrefix = `projects/${projectId}/databases/${databaseId}/documents`;
  const restBase = `/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(databaseId)}/documents`;
  return { projectId, databaseId, docPrefix, restBase };
}

function firestoreRestRequest<T>(params: {
  method: 'GET' | 'POST';
  path: string;
  bearerIdToken: string;
  body?: Record<string, unknown>;
}): Promise<{ statusCode: number; data: T | null; rawText: string }> {
  const payload = params.body ? JSON.stringify(params.body) : undefined;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: params.path,
        method: params.method,
        headers: {
          Authorization: `Bearer ${params.bearerIdToken}`,
          Accept: 'application/json',
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
        timeout: 10000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const rawText = Buffer.concat(chunks).toString('utf8');
          const statusCode = res.statusCode || 500;
          let data: T | null = null;
          try {
            data = rawText ? (JSON.parse(rawText) as T) : null;
          } catch {
            // Non-JSON error body
          }
          resolve({ statusCode, data, rawText });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Firestore commit request timed out.'));
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function checkParentUserExists(
  userId: string,
  bearerIdToken: string,
  databaseId?: string
): Promise<boolean> {
  const { restBase } = getFirestoreDbResourceRoot(databaseId);
  const res = await firestoreRestRequest({
    method: 'GET',
    path: `${restBase}/users/${encodeURIComponent(userId)}`,
    bearerIdToken,
  });
  return res.statusCode === 200;
}

/**
 * Mirrors verified completed purchase entitlements into `databases/(default)/documents/users/{uid}/purchases`
 * when the applet uses a named Firestore database. Firebase Storage Security Rules (`storage.rules`)
 * in `examdash-ed` evaluate `firestore.exists(/databases/(default)/documents/users/$(request.auth.uid)/purchases/...)`,
 * so keeping `(default)` synchronized ensures paid users receive immediate access to `fullPdfStoragePath`,
 * `fullMarkdownStoragePath`, and `fullJsonStoragePath` in Firebase Storage.
 */
export async function mirrorVerifiedPurchasesToDefaultDb(
  userId: string,
  records: UserPurchaseRecord[],
  bearerIdToken: string,
  userProfile?: {
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
  }
): Promise<void> {
  const configuredDb = firebaseConfig.firestoreDatabaseId || '(default)';
  if (
    configuredDb === '(default)' ||
    !userId ||
    !bearerIdToken ||
    records.length === 0
  ) {
    return;
  }

  await ensureDefaultDbUserDocument({
    uid: userId,
    bearerIdToken,
    displayName: userProfile?.displayName,
    email: userProfile?.email,
    photoURL: userProfile?.photoURL,
  });

  await Promise.all(
    records.map((rec) =>
      syncSinglePurchaseToDefaultDb({
        uid: userId,
        itemId: rec.itemId,
        collectionName: rec.collectionName,
        title: rec.title,
        urlSlug: rec.urlSlug,
        currency: rec.currency,
        paidPrice: rec.paidPrice,
        razorpayOrderId: rec.razorpayOrderId,
        razorpayPaymentId: rec.razorpayPaymentId,
        createdAtIso: rec.createdAtIso,
        bearerIdToken,
        userDisplayName: userProfile?.displayName,
        userEmail: userProfile?.email,
        userPhotoUrl: userProfile?.photoURL,
      })
    )
  );
}

export interface CommitPurchasesInput {
  userId: string;
  userDisplayName?: string | null;
  userEmail?: string | null;
  userPhotoUrl?: string | null;
  bearerIdToken: string;
  items: CatalogItemDTO[];
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
}

/**
 * Atomically persists verified book & exam pack entitlements into
 * `/users/{userId}/purchases/{purchaseId}` and cleans up `/users/{userId}/cart/{cartKey}`
 * via Firestore REST `documents:commit` using the caller's verified Firebase Bearer ID token.
 * Enforced by `firestore.rules` (REQUEST_TIME timestamps, Razorpay proof, immutable entitlements).
 */
export async function commitVerifiedPurchasesToFirestore(
  input: CommitPurchasesInput
): Promise<UserPurchaseRecord[]> {
  const { docPrefix, restBase } = getFirestoreDbResourceRoot();
  const uid = input.userId;

  const [parentExists, ownershipFlags] = await Promise.all([
    checkParentUserExists(uid, input.bearerIdToken),
    Promise.all(
      input.items.map((item) =>
        verifyCallerPurchaseRecord(
          uid,
          item.collectionName,
          item.id,
          input.bearerIdToken
        )
      )
    ),
  ]);

  const writes: Array<Record<string, unknown>> = [];

  // Ensure parent `/users/{uid}` exists atomically in the same batch if first-time buyer
  if (!parentExists) {
    const profileFields: Record<string, unknown> = {
      uid: { stringValue: uid },
      displayName: {
        stringValue: sanitizeBoundedString(
          input.userDisplayName || input.userEmail?.split('@')[0],
          120,
          'ExamDash Learner'
        ),
      },
      preferredView: { stringValue: 'list' },
    };
    const safePhoto = sanitizeBoundedString(input.userPhotoUrl, 1024, '');
    if (safePhoto) {
      profileFields.photoURL = { stringValue: safePhoto };
    }

    writes.push({
      update: {
        name: `${docPrefix}/users/${uid}`,
        fields: profileFields,
      },
      currentDocument: { exists: false },
      updateTransforms: [
        { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
    });
  }

  const nowIso = new Date().toISOString();
  const committedRecords: UserPurchaseRecord[] = [];

  input.items.forEach((item, index) => {
    const safeItemId = item.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const purchaseId = `${item.collectionName}_${safeItemId}`.slice(0, 120);
    const cleanSlug =
      item.urlSlug
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .slice(0, 200) || 'item';

    const paidPrice = Math.max(0, Number(item.buyPrice) || 0);
    const listPrice = Math.max(paidPrice, Number(item.listPrice) || paidPrice);
    const currency = /^[A-Z]{3}$/.test((item.currency || '').toUpperCase())
      ? item.currency.toUpperCase()
      : 'INR';

    const title = sanitizeBoundedString(item.title, 300, 'ExamDash Resource');
    const type = sanitizeBoundedString(item.type, 64, 'Ebook');
    const authorName = sanitizeBoundedString(item.authorName, 160, 'ExamDash');
    const language = sanitizeBoundedString(item.language, 64, 'English');
    const isPaid = paidPrice > 0;
    const paymentProvider: 'razorpay' | 'free' = isPaid ? 'razorpay' : 'free';

    const record: UserPurchaseRecord = {
      purchaseId,
      userId: uid,
      itemId: safeItemId,
      collectionName: item.collectionName,
      urlSlug: cleanSlug,
      title,
      type,
      authorName,
      language,
      currency,
      listPrice,
      paidPrice,
      ...(item.collectionName === 'ExamPackDocument' &&
      typeof item.totalMocktest === 'number' &&
      item.totalMocktest >= 0
        ? { totalMocktest: Math.floor(item.totalMocktest) }
        : {}),
      paymentProvider,
      ...(isPaid && input.razorpayOrderId
        ? { razorpayOrderId: input.razorpayOrderId }
        : {}),
      ...(isPaid && input.razorpayPaymentId
        ? { razorpayPaymentId: input.razorpayPaymentId }
        : {}),
      status: 'completed',
      createdAtIso: nowIso,
    };

    committedRecords.push(record);

    // Idempotency: skip Firestore create if the immutable purchase doc already exists
    if (!ownershipFlags[index]) {
      const fields: Record<string, unknown> = {
        purchaseId: { stringValue: purchaseId },
        userId: { stringValue: uid },
        itemId: { stringValue: safeItemId },
        collectionName: { stringValue: item.collectionName },
        urlSlug: { stringValue: cleanSlug },
        title: { stringValue: title },
        type: { stringValue: type },
        authorName: { stringValue: authorName },
        language: { stringValue: language },
        currency: { stringValue: currency },
        listPrice: { doubleValue: listPrice },
        paidPrice: { doubleValue: paidPrice },
        paymentProvider: { stringValue: paymentProvider },
        status: { stringValue: 'completed' },
      };

      if (
        item.collectionName === 'ExamPackDocument' &&
        typeof item.totalMocktest === 'number' &&
        item.totalMocktest >= 0
      ) {
        fields.totalMocktest = {
          integerValue: String(Math.floor(item.totalMocktest)),
        };
      }

      if (isPaid && input.razorpayOrderId && input.razorpayPaymentId) {
        fields.razorpayOrderId = { stringValue: input.razorpayOrderId };
        fields.razorpayPaymentId = { stringValue: input.razorpayPaymentId };
      }

      writes.push({
        update: {
          name: `${docPrefix}/users/${uid}/purchases/${purchaseId}`,
          fields,
        },
        currentDocument: { exists: false },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        ],
      });
    }

    // Remove purchased item from synced Firestore cart
    const cartKey = makeFirestoreSafeCartKey(item.collectionName, item.id);
    writes.push({
      delete: `${docPrefix}/users/${uid}/cart/${cartKey}`,
    });
  });

  if (writes.length > 0) {
    const commitRes = await firestoreRestRequest({
      method: 'POST',
      path: `${restBase}:commit`,
      bearerIdToken: input.bearerIdToken,
      body: { writes },
    });

    if (commitRes.statusCode < 200 || commitRes.statusCode >= 300) {
      throw new Error(
        `Failed to record verified purchases in library (HTTP ${commitRes.statusCode}).`
      );
    }
  }

  // Synchronize `(default)` database purchase docs so Firebase Storage rules grant full file access
  await mirrorVerifiedPurchasesToDefaultDb(
    uid,
    committedRecords,
    input.bearerIdToken,
    {
      displayName: input.userDisplayName,
      email: input.userEmail,
      photoURL: input.userPhotoUrl,
    }
  );

  return committedRecords;
}

type FirestoreRestFieldMap = Record<string, Record<string, unknown>>;

function parseRestValue(val: Record<string, unknown> | undefined): unknown {
  if (!val || typeof val !== 'object') return undefined;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('stringValue' in val) return String(val.stringValue);
  if ('timestampValue' in val) return String(val.timestampValue);
  return undefined;
}

function parseRestFields(
  fields: FirestoreRestFieldMap | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [k, v] of Object.entries(fields)) {
    out[k] = parseRestValue(v);
  }
  return out;
}

function normalizeCollectionFromRaw(
  rawCol: unknown,
  docId: string
): CollectionName {
  if (
    rawCol === 'ExamPackDocument' ||
    rawCol === 'exams' ||
    rawCol === 'exam' ||
    docId.startsWith('ExamPackDocument_') ||
    docId.startsWith('exams_')
  ) {
    return 'ExamPackDocument';
  }
  return 'books';
}

function parsePurchaseDocRow(
  docName: string,
  fields: FirestoreRestFieldMap | undefined,
  fallbackUserId: string
): UserPurchaseRecord | null {
  const segments = docName.split('/');
  const docId = segments[segments.length - 1] || '';
  const d = parseRestFields(fields);

  if (d.status && d.status !== 'completed') {
    return null;
  }

  const collectionName = normalizeCollectionFromRaw(
    d.collectionName ?? d.contentType,
    docId
  );
  const rawItemId = String(
    d.itemId ||
      docId
        .replace(/^ExamPackDocument_/, '')
        .replace(/^exams_/, '')
        .replace(/^books_/, '')
  ).trim();
  if (!rawItemId) return null;

  const canonicalPurchaseId = `${collectionName}_${rawItemId}`;
  const rawTimestamp =
    typeof d.createdAt === 'string' && d.createdAt
      ? d.createdAt
      : typeof d.purchasedAt === 'string' && d.purchasedAt
      ? d.purchasedAt
      : '';
  const createdIso = rawTimestamp
    ? new Date(rawTimestamp).toISOString()
    : new Date().toISOString();

  const paidPrice =
    typeof d.paidPrice === 'number'
      ? d.paidPrice
      : typeof d.amountPaid === 'number'
      ? d.amountPaid
      : Number(d.paidPrice ?? d.amountPaid) || 0;
  const listPrice =
    typeof d.listPrice === 'number'
      ? d.listPrice
      : Math.max(paidPrice, Number(d.listPrice) || paidPrice);

  return {
    purchaseId: canonicalPurchaseId,
    userId: String(d.userId || d.uid || fallbackUserId),
    itemId: rawItemId,
    collectionName,
    urlSlug: String(d.urlSlug || ''),
    title: String(d.title || 'Untitled'),
    type: String(
      d.type || (collectionName === 'ExamPackDocument' ? 'Mock Test' : 'Ebook')
    ),
    authorName: String(d.authorName || 'ExamDash'),
    language: String(d.language || 'English'),
    currency: String(d.currency || 'INR'),
    listPrice,
    paidPrice,
    ...(typeof d.totalMocktest === 'number'
      ? { totalMocktest: d.totalMocktest }
      : {}),
    paymentProvider:
      d.paymentProvider === 'razorpay' || d.razorpayPaymentId
        ? 'razorpay'
        : d.paymentProvider === 'free'
        ? 'free'
        : undefined,
    ...(typeof d.razorpayOrderId === 'string'
      ? { razorpayOrderId: d.razorpayOrderId }
      : {}),
    ...(typeof d.razorpayPaymentId === 'string'
      ? { razorpayPaymentId: d.razorpayPaymentId }
      : {}),
    status: 'completed',
    createdAtIso: createdIso,
  };
}

async function queryPurchasesInDatabase(
  databaseId: string,
  userId: string,
  bearerIdToken: string,
  ownerField: 'userId' | 'uid' | 'none'
): Promise<UserPurchaseRecord[]> {
  const { restBase } = getFirestoreDbResourceRoot(databaseId);
  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: 'purchases' }],
    ...(ownerField !== 'none'
      ? {
          where: {
            fieldFilter: {
              field: { fieldPath: ownerField },
              op: 'EQUAL',
              value: { stringValue: userId },
            },
          },
        }
      : {}),
  };

  const queryRes = await firestoreRestRequest<
    Array<{
      document?: {
        name?: string;
        fields?: FirestoreRestFieldMap;
      };
    }>
  >({
    method: 'POST',
    path: `${restBase}/users/${encodeURIComponent(userId)}:runQuery`,
    bearerIdToken,
    body: { structuredQuery },
  }).catch(() => null);

  if (
    !queryRes ||
    queryRes.statusCode < 200 ||
    queryRes.statusCode >= 300 ||
    !Array.isArray(queryRes.data)
  ) {
    return [];
  }

  const out: UserPurchaseRecord[] = [];
  for (const row of queryRes.data) {
    if (!row?.document?.name) continue;
    const parsed = parsePurchaseDocRow(
      row.document.name,
      row.document.fields,
      userId
    );
    if (parsed && parsed.userId === userId) {
      out.push(parsed);
    }
  }
  return out;
}

/**
 * One-shot server query for `/users/{userId}/purchases` across both the provisioned database
 * and `(default)` database in `examdash-ed` using the caller's verified Bearer ID token.
 * Automatically backfills missing `(default)` purchase docs so Firebase Storage rules grant full file access.
 */
export async function listUserPurchasesFromFirestore(
  userId: string,
  bearerIdToken: string
): Promise<UserPurchaseRecord[]> {
  const configuredDb = firebaseConfig.firestoreDatabaseId || '(default)';

  const [primaryList, defaultList] = await Promise.all([
    queryPurchasesInDatabase(configuredDb, userId, bearerIdToken, 'userId'),
    configuredDb !== '(default)'
      ? queryPurchasesInDatabase('(default)', userId, bearerIdToken, 'none')
      : Promise.resolve([] as UserPurchaseRecord[]),
  ]);

  const defaultKeys = new Set(defaultList.map((r) => r.purchaseId));
  const missingInDefault = primaryList.filter(
    (r) => !defaultKeys.has(r.purchaseId)
  );

  if (missingInDefault.length > 0 && configuredDb !== '(default)') {
    await mirrorVerifiedPurchasesToDefaultDb(
      userId,
      missingInDefault,
      bearerIdToken
    );
  }

  const byKey = new Map<string, UserPurchaseRecord>();
  for (const item of defaultList) {
    byKey.set(item.purchaseId, item);
  }
  for (const item of primaryList) {
    byKey.set(item.purchaseId, item);
  }

  const list = Array.from(byKey.values());
  list.sort(
    (a, b) =>
      new Date(b.createdAtIso).getTime() - new Date(a.createdAtIso).getTime()
  );
  return list;
}

export async function syncUserProfileInFirestore(params: {
  userId: string;
  emailVerified: boolean;
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
  bearerIdToken: string;
}): Promise<void> {
  if (!params.emailVerified) return;
  const { docPrefix, restBase } = getFirestoreDbResourceRoot();
  const uid = params.userId;

  const [userRes, privateRes] = await Promise.all([
    firestoreRestRequest<{ fields?: FirestoreRestFieldMap }>({
      method: 'GET',
      path: `${restBase}/users/${encodeURIComponent(uid)}`,
      bearerIdToken: params.bearerIdToken,
    }),
    firestoreRestRequest<{ fields?: FirestoreRestFieldMap }>({
      method: 'GET',
      path: `${restBase}/users/${encodeURIComponent(uid)}/private/contact`,
      bearerIdToken: params.bearerIdToken,
    }),
  ]);

  const writes: Array<Record<string, unknown>> = [];
  const displayName = sanitizeBoundedString(
    params.displayName || params.email?.split('@')[0],
    120,
    'ExamDash Learner'
  );
  const safePhoto = sanitizeBoundedString(params.photoURL, 1024, '');

  if (userRes.statusCode !== 200) {
    const profileFields: Record<string, unknown> = {
      uid: { stringValue: uid },
      displayName: { stringValue: displayName },
      preferredView: { stringValue: 'list' },
    };
    if (safePhoto) {
      profileFields.photoURL = { stringValue: safePhoto };
    }
    writes.push({
      update: {
        name: `${docPrefix}/users/${uid}`,
        fields: profileFields,
      },
      currentDocument: { exists: false },
      updateTransforms: [
        { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
    });
  }

  if (params.email && privateRes.statusCode !== 200) {
    writes.push({
      update: {
        name: `${docPrefix}/users/${uid}/private/contact`,
        fields: {
          uid: { stringValue: uid },
          email: { stringValue: params.email.slice(0, 254) },
        },
      },
      currentDocument: { exists: false },
      updateTransforms: [
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
    });
  }

  if (writes.length > 0) {
    await firestoreRestRequest({
      method: 'POST',
      path: `${restBase}:commit`,
      bearerIdToken: params.bearerIdToken,
      body: { writes },
    }).catch(() => {});
  }

  await ensureDefaultDbUserDocument({
    uid,
    bearerIdToken: params.bearerIdToken,
    displayName: params.displayName,
    email: params.email,
    photoURL: params.photoURL,
  });
}

export async function deleteUserProfileFromFirestore(
  userId: string,
  bearerIdToken: string
): Promise<void> {
  const { docPrefix, restBase } = getFirestoreDbResourceRoot();

  const [reviewQueryRes, attemptsQueryRes, wishlistQueryRes] = await Promise.all([
    firestoreRestRequest<Array<{ document?: { name?: string } }>>({
      method: 'POST',
      path: `${restBase}:runQuery`,
      bearerIdToken,
      body: {
        structuredQuery: {
          from: [{ collectionId: 'reviews' }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: 'status' },
                    op: 'EQUAL',
                    value: { stringValue: 'published' },
                  },
                },
                {
                  fieldFilter: {
                    field: { fieldPath: 'userId' },
                    op: 'EQUAL',
                    value: { stringValue: userId },
                  },
                },
              ],
            },
          },
          limit: 200,
        },
      },
    }).catch(() => null),
    firestoreRestRequest<Array<{ document?: { name?: string } }>>({
      method: 'POST',
      path: `${restBase}/users/${encodeURIComponent(userId)}:runQuery`,
      bearerIdToken,
      body: {
        structuredQuery: {
          from: [{ collectionId: 'examAttempts' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'userId' },
              op: 'EQUAL',
              value: { stringValue: userId },
            },
          },
          limit: 200,
        },
      },
    }).catch(() => null),
    firestoreRestRequest<Array<{ document?: { name?: string } }>>({
      method: 'POST',
      path: `${restBase}/users/${encodeURIComponent(userId)}:runQuery`,
      bearerIdToken,
      body: {
        structuredQuery: {
          from: [{ collectionId: 'wishlist' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'userId' },
              op: 'EQUAL',
              value: { stringValue: userId },
            },
          },
          limit: 200,
        },
      },
    }).catch(() => null),
  ]);

  const childDeletes: Array<{ delete: string }> = [];
  if (reviewQueryRes && Array.isArray(reviewQueryRes.data)) {
    for (const row of reviewQueryRes.data) {
      if (row?.document?.name) {
        childDeletes.push({ delete: row.document.name });
      }
    }
  }
  if (attemptsQueryRes && Array.isArray(attemptsQueryRes.data)) {
    for (const row of attemptsQueryRes.data) {
      if (row?.document?.name) {
        childDeletes.push({ delete: row.document.name });
      }
    }
  }
  if (wishlistQueryRes && Array.isArray(wishlistQueryRes.data)) {
    for (const row of wishlistQueryRes.data) {
      if (row?.document?.name) {
        childDeletes.push({ delete: row.document.name });
      }
    }
  }

  await firestoreRestRequest({
    method: 'POST',
    path: `${restBase}:commit`,
    bearerIdToken,
    body: {
      writes: [
        ...childDeletes.slice(0, 450),
        { delete: `${docPrefix}/users/${userId}/private/contact` },
        { delete: `${docPrefix}/users/${userId}` },
      ],
    },
  }).catch(() => {});
}
