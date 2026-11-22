import https from 'node:https';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  makeCompositeKey,
  makeFirestoreSafeCartKey,
} from '../../lib/registry/content-type-registry';
import type { CollectionName, WishlistItem } from '../../lib/types/catalog';

type FirestoreRestFieldMap = Record<string, Record<string, unknown>>;

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
            // Non-JSON response body
          }
          resolve({ statusCode, data, rawText });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Firestore wishlist request timed out.'));
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function sanitizeBoundedString(
  val: unknown,
  maxLen: number,
  fallback: string
): string {
  const trimmed =
    typeof val === 'string' ? val.trim() : String(val ?? '').trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLen);
}

function sanitizeSlug(val: unknown): string {
  const cleaned = String(val ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
  return cleaned || 'item';
}

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

function parseWishlistDocRow(
  docName: string,
  fields: FirestoreRestFieldMap | undefined,
  fallbackUserId: string
): WishlistItem | null {
  if (!fields) return null;
  const segments = docName.split('/');
  const docId = segments[segments.length - 1] || '';
  const d = parseRestFields(fields);

  if (d.userId && d.userId !== fallbackUserId) {
    return null;
  }

  const collectionName: CollectionName =
    d.collectionName === 'ExamPackDocument' ? 'ExamPackDocument' : 'books';
  const itemId = String(d.itemId || '').trim();
  if (!itemId) return null;

  const wishlistKey = String(
    d.wishlistKey || docId || makeFirestoreSafeCartKey(collectionName, itemId)
  );
  const createdIso =
    typeof d.createdAt === 'string' && d.createdAt
      ? new Date(d.createdAt).toISOString()
      : new Date().toISOString();

  return {
    compositeKey: makeCompositeKey(collectionName, itemId),
    wishlistKey,
    id: itemId,
    collectionName,
    urlSlug: String(d.urlSlug || ''),
    title: String(d.title || 'Untitled'),
    authorName: String(d.authorName || 'ExamDash'),
    language: String(d.language || 'English'),
    type: String(
      d.type || (collectionName === 'ExamPackDocument' ? 'Exam' : 'Ebook')
    ),
    currency: String(d.currency || 'INR'),
    listPrice: Number(d.listPrice) || 0,
    buyPrice: Number(d.buyPrice) || 0,
    ...(typeof d.totalMocktest === 'number' && d.totalMocktest >= 0
      ? { totalMocktest: Math.floor(d.totalMocktest) }
      : {}),
    createdAtIso: createdIso,
  };
}

export async function listUserWishlistFromFirestore(
  userId: string,
  bearerIdToken: string
): Promise<WishlistItem[]> {
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
  }).catch(() => null);

  if (
    !queryRes ||
    queryRes.statusCode < 200 ||
    queryRes.statusCode >= 300 ||
    !Array.isArray(queryRes.data)
  ) {
    return [];
  }

  const out: WishlistItem[] = [];
  for (const row of queryRes.data) {
    if (!row?.document?.name) continue;
    const parsed = parseWishlistDocRow(
      row.document.name,
      row.document.fields,
      userId
    );
    if (parsed) {
      out.push(parsed);
    }
  }

  out.sort(
    (a, b) =>
      new Date(b.createdAtIso).getTime() - new Date(a.createdAtIso).getTime()
  );
  return out;
}

export interface AddWishlistInput {
  userId: string;
  emailVerified: boolean;
  userDisplayName?: string | null;
  userEmail?: string | null;
  userPhotoUrl?: string | null;
  bearerIdToken: string;
  item: {
    id: string;
    collectionName: CollectionName;
    urlSlug: string;
    title: string;
    authorName?: string;
    language?: string;
    type?: string;
    currency: string;
    listPrice: number;
    buyPrice: number;
    totalMocktest?: number;
  };
}

export async function addWishlistItemToFirestore(
  input: AddWishlistInput
): Promise<WishlistItem> {
  if (!input.emailVerified) {
    throw new Error('Verified Google email is required to sync wishlist items.');
  }

  const { docPrefix, restBase } = getFirestoreDbResourceRoot();
  const uid = input.userId;
  const safeItemId = input.item.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const wishlistKey = makeFirestoreSafeCartKey(
    input.item.collectionName,
    safeItemId
  );
  const cleanSlug = sanitizeSlug(input.item.urlSlug);
  const title = sanitizeBoundedString(input.item.title, 300, 'ExamDash Resource');
  const authorName = sanitizeBoundedString(
    input.item.authorName,
    160,
    'ExamDash'
  );
  const language = sanitizeBoundedString(input.item.language, 64, 'English');
  const type = sanitizeBoundedString(
    input.item.type,
    64,
    input.item.collectionName === 'ExamPackDocument' ? 'Exam' : 'Ebook'
  );
  const currency = /^[A-Z]{3}$/.test((input.item.currency || '').toUpperCase())
    ? input.item.currency.toUpperCase()
    : 'INR';
  const buyPrice = Math.max(0, Number(input.item.buyPrice) || 0);
  const listPrice = Math.max(buyPrice, Number(input.item.listPrice) || buyPrice);

  const [userRes, existingRes] = await Promise.all([
    firestoreRestRequest({
      method: 'GET',
      path: `${restBase}/users/${encodeURIComponent(uid)}`,
      bearerIdToken: input.bearerIdToken,
    }),
    firestoreRestRequest<{ name?: string; fields?: FirestoreRestFieldMap }>({
      method: 'GET',
      path: `${restBase}/users/${encodeURIComponent(
        uid
      )}/wishlist/${encodeURIComponent(wishlistKey)}`,
      bearerIdToken: input.bearerIdToken,
    }),
  ]);

  if (existingRes.statusCode === 200 && existingRes.data?.fields) {
    const parsedExisting = parseWishlistDocRow(
      existingRes.data.name || wishlistKey,
      existingRes.data.fields,
      uid
    );
    if (parsedExisting) return parsedExisting;
  }

  const writes: Array<Record<string, unknown>> = [];

  if (userRes.statusCode !== 200) {
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

  const fields: FirestoreRestFieldMap = {
    wishlistKey: { stringValue: wishlistKey },
    userId: { stringValue: uid },
    itemId: { stringValue: safeItemId },
    collectionName: { stringValue: input.item.collectionName },
    urlSlug: { stringValue: cleanSlug },
    title: { stringValue: title },
    authorName: { stringValue: authorName },
    language: { stringValue: language },
    type: { stringValue: type },
    currency: { stringValue: currency },
    listPrice: { doubleValue: listPrice },
    buyPrice: { doubleValue: buyPrice },
  };

  if (
    input.item.collectionName === 'ExamPackDocument' &&
    typeof input.item.totalMocktest === 'number' &&
    input.item.totalMocktest >= 0
  ) {
    fields.totalMocktest = {
      integerValue: String(Math.floor(input.item.totalMocktest)),
    };
  }

  writes.push({
    update: {
      name: `${docPrefix}/users/${uid}/wishlist/${wishlistKey}`,
      fields,
    },
    currentDocument: { exists: false },
    updateTransforms: [
      { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
    ],
  });

  const commitRes = await firestoreRestRequest({
    method: 'POST',
    path: `${restBase}:commit`,
    bearerIdToken: input.bearerIdToken,
    body: { writes },
  });

  if (commitRes.statusCode < 200 || commitRes.statusCode >= 300) {
    throw new Error(
      `Failed to save wishlist item to Firestore (HTTP ${commitRes.statusCode}).`
    );
  }

  return {
    compositeKey: makeCompositeKey(input.item.collectionName, safeItemId),
    wishlistKey,
    id: safeItemId,
    collectionName: input.item.collectionName,
    urlSlug: cleanSlug,
    title,
    authorName,
    language,
    type,
    currency,
    listPrice,
    buyPrice,
    ...(input.item.collectionName === 'ExamPackDocument' &&
    typeof input.item.totalMocktest === 'number' &&
    input.item.totalMocktest >= 0
      ? { totalMocktest: Math.floor(input.item.totalMocktest) }
      : {}),
    createdAtIso: new Date().toISOString(),
  };
}

export async function removeWishlistItemFromFirestore(params: {
  userId: string;
  emailVerified: boolean;
  bearerIdToken: string;
  wishlistKey: string;
}): Promise<void> {
  if (!params.emailVerified) {
    throw new Error('Verified Google email is required to update wishlist.');
  }
  const cleanKey = params.wishlistKey
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 128);
  if (cleanKey.length < 3) {
    throw new Error('Invalid wishlistKey.');
  }

  const { docPrefix, restBase } = getFirestoreDbResourceRoot();
  const commitRes = await firestoreRestRequest({
    method: 'POST',
    path: `${restBase}:commit`,
    bearerIdToken: params.bearerIdToken,
    body: {
      writes: [
        {
          delete: `${docPrefix}/users/${params.userId}/wishlist/${cleanKey}`,
        },
      ],
    },
  });

  if (commitRes.statusCode < 200 || commitRes.statusCode >= 300) {
    throw new Error(
      `Failed to remove wishlist item (HTTP ${commitRes.statusCode}).`
    );
  }
}
