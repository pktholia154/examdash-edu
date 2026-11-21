import https from 'node:https';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  CatalogItemDTO,
  UserPurchaseRecord,
} from '../../lib/types/catalog';
import { makeFirestoreSafeCartKey } from '../../lib/registry/content-type-registry';
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

function getFirestoreDbResourceRoot(): {
  projectId: string;
  databaseId: string;
  docPrefix: string;
  restBase: string;
} {
  const projectId = firebaseConfig.projectId || 'examdash-ed';
  const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
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
  bearerIdToken: string
): Promise<boolean> {
  const { restBase } = getFirestoreDbResourceRoot();
  const res = await firestoreRestRequest({
    method: 'GET',
    path: `${restBase}/users/${encodeURIComponent(userId)}`,
    bearerIdToken,
  });
  return res.statusCode === 200;
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
      preferredView: { stringValue: 'grid' },
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

/**
 * One-shot server query for `/users/{userId}/purchases` satisfying `firestore.rules`
 * (`where('userId', '==', userId)`) using the caller's verified Bearer ID token.
 * Replaces client-side `onSnapshot` (`Listen/channel`) listeners completely.
 */
export async function listUserPurchasesFromFirestore(
  userId: string,
  bearerIdToken: string
): Promise<UserPurchaseRecord[]> {
  const { restBase } = getFirestoreDbResourceRoot();
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
    body: {
      structuredQuery: {
        from: [{ collectionId: 'purchases' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'userId' },
            op: 'EQUAL',
            value: { stringValue: userId },
          },
        },
      },
    },
  });

  if (queryRes.statusCode < 200 || queryRes.statusCode >= 300 || !Array.isArray(queryRes.data)) {
    return [];
  }

  const list: UserPurchaseRecord[] = [];
  for (const row of queryRes.data) {
    if (!row?.document?.name) continue;
    const segments = row.document.name.split('/');
    const docId = segments[segments.length - 1] || '';
    const d = parseRestFields(row.document.fields);
    const createdIso =
      typeof d.createdAt === 'string' && d.createdAt
        ? new Date(d.createdAt).toISOString()
        : new Date().toISOString();

    list.push({
      purchaseId: String(d.purchaseId || docId),
      userId: String(d.userId || userId),
      itemId: String(d.itemId || ''),
      collectionName:
        d.collectionName === 'ExamPackDocument' ? 'ExamPackDocument' : 'books',
      urlSlug: String(d.urlSlug || ''),
      title: String(d.title || 'Untitled'),
      type: String(d.type || 'Ebook'),
      authorName: String(d.authorName || 'ExamDash'),
      language: String(d.language || 'English'),
      currency: String(d.currency || 'INR'),
      listPrice: Number(d.listPrice) || 0,
      paidPrice: Number(d.paidPrice) || 0,
      ...(typeof d.totalMocktest === 'number'
        ? { totalMocktest: d.totalMocktest }
        : {}),
      paymentProvider:
        d.paymentProvider === 'razorpay'
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
    });
  }

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
      preferredView: { stringValue: 'grid' },
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
}

export async function deleteUserProfileFromFirestore(
  userId: string,
  bearerIdToken: string
): Promise<void> {
  const { docPrefix, restBase } = getFirestoreDbResourceRoot();
  await firestoreRestRequest({
    method: 'POST',
    path: `${restBase}:commit`,
    bearerIdToken,
    body: {
      writes: [
        { delete: `${docPrefix}/users/${userId}/private/contact` },
        { delete: `${docPrefix}/users/${userId}` },
      ],
    },
  }).catch(() => {});
}

