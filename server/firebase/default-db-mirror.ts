import crypto from 'node:crypto';
import https from 'node:https';
import firebaseConfig from '../../firebase-applet-config.json';
import type { CollectionName } from '../../lib/types/catalog';

const FIREBASE_STORAGE_SDK_VERSION = 'webjs/13.4.0';

function sanitizeString(
  val: string | null | undefined,
  maxLen: number,
  fallback: string
): string {
  const trimmed = (val ?? '').trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLen);
}

function getProofSigningSecret(): string {
  const runtimeEnv = process.env as Record<string, string | undefined>;
  return (
    runtimeEnv['ASSET_GRANT_SECRET'] ||
    runtimeEnv['RAZORPAY_KEY_SECRET'] ||
    firebaseConfig.appId ||
    'examdash-ephemeral'
  );
}

/**
 * Builds official Firebase Web Storage SDK headers (`Authorization: Firebase <idToken>`,
 * `X-Firebase-GMPID`, and `X-Firebase-Storage-Version`) so server-side Storage requests
 * satisfy `storage.rules` identically to `firebase/storage` in the browser.
 */
export function buildFirebaseStorageHeaders(
  firebaseIdToken?: string | null,
  extra?: Record<string, string>,
  options?: { omitAuthIfTokenParamPresent?: boolean; targetUrl?: string }
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Firebase-Storage-Version': FIREBASE_STORAGE_SDK_VERSION,
    ...(firebaseConfig.appId ? { 'X-Firebase-GMPID': firebaseConfig.appId } : {}),
    ...(extra || {}),
  };

  let hasDownloadTokenParam = false;
  if (options?.omitAuthIfTokenParamPresent && options.targetUrl) {
    try {
      hasDownloadTokenParam = new URL(options.targetUrl).searchParams.has('token');
    } catch {
      hasDownloadTokenParam = false;
    }
  }

  if (firebaseIdToken && !hasDownloadTokenParam) {
    headers.Authorization = `Firebase ${firebaseIdToken}`;
  }

  return headers;
}

/**
 * Generates an HMAC-signed `entitlementProof` token matching the `(default)` Firestore
 * `/users/{uid}/purchases/{docId}` schema (`<base64url_payload>.<base64url_hmac_sha256>`).
 */
export function computeDefaultDbEntitlementProof(params: {
  uid: string;
  itemId: string;
  contentType: string;
  orderId?: string;
  paymentId?: string;
}): string {
  const payloadJson = JSON.stringify({
    uid: params.uid,
    itemId: params.itemId,
    contentType: params.contentType,
    orderId: params.orderId || `free_${params.itemId}`,
    paymentId: params.paymentId || `free_${params.itemId}`,
    issuedAt: Date.now(),
  });
  const encodedPayload = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const hmacSig = crypto
    .createHmac('sha256', getProofSigningSecret())
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${hmacSig}`;
}

function defaultDbRestRequest(params: {
  method: 'GET' | 'POST';
  path: string;
  bearerIdToken: string;
  body?: Record<string, unknown>;
}): Promise<{ statusCode: number; rawText: string }> {
  const payload = params.body ? JSON.stringify(params.body) : undefined;

  return new Promise((resolve) => {
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
        timeout: 6500,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 500,
            rawText: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 504, rawText: '' });
    });
    req.on('error', () => {
      resolve({ statusCode: 502, rawText: '' });
    });
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * Ensures `/users/{uid}` exists in `databases/(default)` using the exact 11-key `(default)` user schema
 * so parent document checks in `(default)` Firestore or Storage rules always succeed.
 */
export async function ensureDefaultDbUserDocument(params: {
  uid: string;
  bearerIdToken: string;
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
}): Promise<void> {
  const configuredDb = firebaseConfig.firestoreDatabaseId || '(default)';
  if (configuredDb === '(default)' || !params.uid || !params.bearerIdToken) {
    return;
  }

  const projectId = firebaseConfig.projectId || 'examdash-ed';
  const restBase = `/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents`;
  const docPrefix = `projects/${projectId}/databases/(default)/documents`;

  const existing = await defaultDbRestRequest({
    method: 'GET',
    path: `${restBase}/users/${encodeURIComponent(params.uid)}`,
    bearerIdToken: params.bearerIdToken,
  });

  if (existing.statusCode === 200) {
    return;
  }

  const displayName = sanitizeString(
    params.displayName || params.email?.split('@')[0],
    120,
    'ExamDash Learner'
  );
  const safeEmail = sanitizeString(params.email, 254, '');
  const safePhoto = sanitizeString(params.photoURL, 1024, '');

  const baseFields: Record<string, unknown> = {
    uid: { stringValue: params.uid },
    displayName: { stringValue: displayName },
    ...(safeEmail ? { email: { stringValue: safeEmail } } : {}),
    ...(safePhoto ? { photoURL: { stringValue: safePhoto } } : {}),
    testsAttempted: { integerValue: '0' },
    booksOwned: { integerValue: '0' },
    examsOwned: { integerValue: '0' },
    averageAccuracy: { integerValue: '0' },
    studyStreakDays: { integerValue: '0' },
  };

  // Attempt 1: Server REQUEST_TIME transforms
  const attempt1 = await defaultDbRestRequest({
    method: 'POST',
    path: `${restBase}:commit`,
    bearerIdToken: params.bearerIdToken,
    body: {
      writes: [
        {
          update: {
            name: `${docPrefix}/users/${params.uid}`,
            fields: baseFields,
          },
          currentDocument: { exists: false },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        },
      ],
    },
  });

  if (attempt1.statusCode >= 200 && attempt1.statusCode < 300) {
    return;
  }

  // Attempt 2: Explicit timestampValue fields
  const nowIso = new Date().toISOString();
  await defaultDbRestRequest({
    method: 'POST',
    path: `${restBase}:commit`,
    bearerIdToken: params.bearerIdToken,
    body: {
      writes: [
        {
          update: {
            name: `${docPrefix}/users/${params.uid}`,
            fields: {
              ...baseFields,
              createdAt: { timestampValue: nowIso },
              updatedAt: { timestampValue: nowIso },
            },
          },
          currentDocument: { exists: false },
        },
      ],
    },
  });
}

export interface DefaultDbPurchaseSyncInput {
  uid: string;
  itemId: string;
  collectionName: CollectionName;
  title: string;
  urlSlug: string;
  currency?: string;
  paidPrice: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  createdAtIso?: string;
  bearerIdToken: string;
  userDisplayName?: string | null;
  userEmail?: string | null;
  userPhotoUrl?: string | null;
}

async function commitDefaultPurchaseCandidate(params: {
  restBase: string;
  docPrefix: string;
  uid: string;
  docId: string;
  safeItemId: string;
  contentType: string;
  title: string;
  urlSlug: string;
  currency: string;
  amountPaidInt: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  purchasedAtIso: string;
  bearerIdToken: string;
}): Promise<boolean> {
  const checkRes = await defaultDbRestRequest({
    method: 'GET',
    path: `${params.restBase}/users/${encodeURIComponent(
      params.uid
    )}/purchases/${encodeURIComponent(params.docId)}`,
    bearerIdToken: params.bearerIdToken,
  });

  if (checkRes.statusCode === 200) {
    return true;
  }

  const proof = computeDefaultDbEntitlementProof({
    uid: params.uid,
    itemId: params.safeItemId,
    contentType: params.contentType,
    orderId: params.razorpayOrderId,
    paymentId: params.razorpayPaymentId,
  });

  const coreFields: Record<string, unknown> = {
    id: { stringValue: params.docId },
    uid: { stringValue: params.uid },
    itemId: { stringValue: params.safeItemId },
    contentType: { stringValue: params.contentType },
    title: { stringValue: params.title },
    urlSlug: { stringValue: params.urlSlug },
    currency: { stringValue: params.currency },
    amountPaid: { integerValue: params.amountPaidInt },
    ...(params.razorpayOrderId
      ? { razorpayOrderId: { stringValue: params.razorpayOrderId } }
      : {}),
    ...(params.razorpayPaymentId
      ? { razorpayPaymentId: { stringValue: params.razorpayPaymentId } }
      : {}),
    entitlementProof: { stringValue: proof },
    status: { stringValue: 'completed' },
  };

  const docResourceName = `${params.docPrefix}/users/${params.uid}/purchases/${params.docId}`;

  // Attempt 1: Exact 13-key `(default)` schema with server REQUEST_TIME transform on `purchasedAt`
  const res1 = await defaultDbRestRequest({
    method: 'POST',
    path: `${params.restBase}:commit`,
    bearerIdToken: params.bearerIdToken,
    body: {
      writes: [
        {
          update: {
            name: docResourceName,
            fields: coreFields,
          },
          currentDocument: { exists: false },
          updateTransforms: [
            { fieldPath: 'purchasedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        },
      ],
    },
  });
  if (res1.statusCode >= 200 && res1.statusCode < 300) {
    return true;
  }

  // Attempt 2: Exact 13-key `(default)` schema with explicit `purchasedAt` timestampValue
  const res2 = await defaultDbRestRequest({
    method: 'POST',
    path: `${params.restBase}:commit`,
    bearerIdToken: params.bearerIdToken,
    body: {
      writes: [
        {
          update: {
            name: docResourceName,
            fields: {
              ...coreFields,
              purchasedAt: { timestampValue: params.purchasedAtIso },
            },
          },
          currentDocument: { exists: false },
        },
      ],
    },
  });
  if (res2.statusCode >= 200 && res2.statusCode < 300) {
    return true;
  }

  // Attempt 3: Free / Native order fallback where `(default)` rules require non-empty order/payment IDs
  if (!params.razorpayOrderId || !params.razorpayPaymentId) {
    const fallbackOrder = params.razorpayOrderId || `free_${params.safeItemId}`;
    const fallbackPayment =
      params.razorpayPaymentId || `free_${params.safeItemId}`;
    const fallbackFields: Record<string, unknown> = {
      ...coreFields,
      razorpayOrderId: { stringValue: fallbackOrder },
      razorpayPaymentId: { stringValue: fallbackPayment },
    };

    const res3 = await defaultDbRestRequest({
      method: 'POST',
      path: `${params.restBase}:commit`,
      bearerIdToken: params.bearerIdToken,
      body: {
        writes: [
          {
            update: {
              name: docResourceName,
              fields: fallbackFields,
            },
            currentDocument: { exists: false },
            updateTransforms: [
              { fieldPath: 'purchasedAt', setToServerValue: 'REQUEST_TIME' },
            ],
          },
        ],
      },
    });
    if (res3.statusCode >= 200 && res3.statusCode < 300) {
      return true;
    }

    const res4 = await defaultDbRestRequest({
      method: 'POST',
      path: `${params.restBase}:commit`,
      bearerIdToken: params.bearerIdToken,
      body: {
        writes: [
          {
            update: {
              name: docResourceName,
              fields: {
                ...fallbackFields,
                purchasedAt: { timestampValue: params.purchasedAtIso },
              },
            },
            currentDocument: { exists: false },
          },
        ],
      },
    });
    if (res4.statusCode >= 200 && res4.statusCode < 300) {
      return true;
    }
  }

  return false;
}

/**
 * Synchronizes a verified completed purchase into `databases/(default)/documents/users/{uid}/purchases/{docId}`
 * using the exact `(default)` Firestore 13-key schema (`id`, `uid`, `itemId`, `contentType`, `title`,
 * `urlSlug`, `currency`, `amountPaid`, `razorpayOrderId`, `razorpayPaymentId`, `entitlementProof`,
 * `status`, `purchasedAt`) so Firebase Storage security rules authorize `fullPdfStoragePath`,
 * `fullMarkdownStoragePath`, and `fullJsonStoragePath`.
 */
export async function syncSinglePurchaseToDefaultDb(
  input: DefaultDbPurchaseSyncInput
): Promise<boolean> {
  const configuredDb = firebaseConfig.firestoreDatabaseId || '(default)';
  if (
    configuredDb === '(default)' ||
    !input.uid ||
    !input.itemId ||
    !input.bearerIdToken
  ) {
    return true;
  }

  const projectId = firebaseConfig.projectId || 'examdash-ed';
  const restBase = `/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents`;
  const docPrefix = `projects/${projectId}/databases/(default)/documents`;

  await ensureDefaultDbUserDocument({
    uid: input.uid,
    bearerIdToken: input.bearerIdToken,
    displayName: input.userDisplayName,
    email: input.userEmail,
    photoURL: input.userPhotoUrl,
  });

  const safeItemId = input.itemId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const title = sanitizeString(input.title, 300, 'ExamDash Resource');
  const urlSlug = sanitizeString(
    input.urlSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    200,
    safeItemId.toLowerCase()
  );
  const currency = /^[A-Z]{3}$/.test((input.currency || '').toUpperCase())
    ? (input.currency || 'INR').toUpperCase()
    : 'INR';
  const amountPaidInt = String(Math.max(0, Math.round(Number(input.paidPrice) || 0)));
  const purchasedAtIso =
    input.createdAtIso && !Number.isNaN(new Date(input.createdAtIso).getTime())
      ? new Date(input.createdAtIso).toISOString()
      : new Date().toISOString();

  if (input.collectionName === 'books') {
    return commitDefaultPurchaseCandidate({
      restBase,
      docPrefix,
      uid: input.uid,
      docId: `books_${safeItemId}`.slice(0, 120),
      safeItemId,
      contentType: 'books',
      title,
      urlSlug,
      currency,
      amountPaidInt,
      razorpayOrderId: input.razorpayOrderId,
      razorpayPaymentId: input.razorpayPaymentId,
      purchasedAtIso,
      bearerIdToken: input.bearerIdToken,
    });
  }

  // For ExamPackDocument, sync both canonical `ExamPackDocument_<id>` and `exams_<id>` alias
  const canonicalDocId = `ExamPackDocument_${safeItemId}`.slice(0, 120);
  const aliasDocId = `exams_${safeItemId}`.slice(0, 120);

  const canonicalOk =
    (await commitDefaultPurchaseCandidate({
      restBase,
      docPrefix,
      uid: input.uid,
      docId: canonicalDocId,
      safeItemId,
      contentType: 'ExamPackDocument',
      title,
      urlSlug,
      currency,
      amountPaidInt,
      razorpayOrderId: input.razorpayOrderId,
      razorpayPaymentId: input.razorpayPaymentId,
      purchasedAtIso,
      bearerIdToken: input.bearerIdToken,
    })) ||
    (await commitDefaultPurchaseCandidate({
      restBase,
      docPrefix,
      uid: input.uid,
      docId: canonicalDocId,
      safeItemId,
      contentType: 'exams',
      title,
      urlSlug,
      currency,
      amountPaidInt,
      razorpayOrderId: input.razorpayOrderId,
      razorpayPaymentId: input.razorpayPaymentId,
      purchasedAtIso,
      bearerIdToken: input.bearerIdToken,
    }));

  const aliasOk = await commitDefaultPurchaseCandidate({
    restBase,
    docPrefix,
    uid: input.uid,
    docId: aliasDocId,
    safeItemId,
    contentType: 'exams',
    title,
    urlSlug,
    currency,
    amountPaidInt,
    razorpayOrderId: input.razorpayOrderId,
    razorpayPaymentId: input.razorpayPaymentId,
    purchasedAtIso,
    bearerIdToken: input.bearerIdToken,
  });

  return Boolean(canonicalOk || aliasOk);
}
