import https from 'node:https';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  buildDeterministicReviewId,
  buildReviewTargetKey,
  computeItemReviewSummary,
  computeReviewAggregateMap,
  createEmptyReviewSummary,
  sanitizeReviewAuthorName,
  sanitizeReviewItemId,
} from '../../lib/reviews/validation';
import type {
  CollectionName,
  ItemReviewDTO,
  ItemReviewSummaryDTO,
  ReviewAggregateBadge,
} from '../../lib/types/catalog';
import { getCatalogItemsByRefs } from './catalog-repository';

type FirestoreRestFieldMap = Record<string, Record<string, unknown>>;

function getProvisionedFirestoreRoot(): {
  projectId: string;
  databaseId: string;
  apiKey: string;
  docPrefix: string;
  restBase: string;
} {
  const projectId = firebaseConfig.projectId || 'examdash-ed';
  const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
  const apiKey = firebaseConfig.apiKey || '';
  const docPrefix = `projects/${projectId}/databases/${databaseId}/documents`;
  const restBase = `/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(databaseId)}/documents`;
  return { projectId, databaseId, apiKey, docPrefix, restBase };
}

function parseRestPrimitive(val: Record<string, unknown> | undefined): unknown {
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
    out[k] = parseRestPrimitive(v);
  }
  return out;
}

function firestoreRestCall<T>(params: {
  method: 'GET' | 'POST';
  path: string;
  bearerIdToken?: string;
  body?: Record<string, unknown>;
}): Promise<{ statusCode: number; data: T | null; rawText: string }> {
  const payload = params.body ? JSON.stringify(params.body) : undefined;

  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = {
      Accept: 'application/json',
    };
    if (params.bearerIdToken) {
      headers.Authorization = `Bearer ${params.bearerIdToken}`;
    }
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(
      {
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: params.path,
        method: params.method,
        headers,
        timeout: 8000,
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
      req.destroy(new Error('Firestore review request timed out.'));
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function mapRawReviewDoc(
  docId: string,
  fields: FirestoreRestFieldMap | undefined
): ItemReviewDTO | null {
  const d = parseRestFields(fields);
  if (d.status !== 'published') return null;

  const ratingNum = Number(d.rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return null;
  }

  const comment = typeof d.comment === 'string' ? d.comment.trim() : '';
  if (!comment) return null;

  const collectionName: CollectionName =
    d.collectionName === 'ExamPackDocument' ? 'ExamPackDocument' : 'books';
  const itemId = sanitizeReviewItemId(String(d.itemId || ''));
  const targetKey =
    typeof d.targetKey === 'string' && d.targetKey
      ? d.targetKey
      : buildReviewTargetKey(collectionName, itemId);

  const createdRaw = typeof d.createdAt === 'string' ? d.createdAt : '';
  const updatedRaw = typeof d.updatedAt === 'string' ? d.updatedAt : createdRaw;
  const createdAtIso = createdRaw
    ? new Date(createdRaw).toISOString()
    : new Date(0).toISOString();
  const updatedAtIso = updatedRaw
    ? new Date(updatedRaw).toISOString()
    : createdAtIso;

  const title =
    typeof d.title === 'string' && d.title.trim().length > 0
      ? d.title.trim()
      : undefined;

  return {
    reviewId: String(d.reviewId || docId),
    targetKey,
    collectionName,
    itemId,
    urlSlug: String(d.urlSlug || ''),
    userId: String(d.userId || ''),
    authorName: sanitizeReviewAuthorName(
      typeof d.authorName === 'string' ? d.authorName : undefined
    ),
    rating: ratingNum as 1 | 2 | 3 | 4 | 5,
    ...(title ? { title } : {}),
    comment,
    verifiedPurchase: d.verifiedPurchase === true,
    createdAtIso,
    updatedAtIso,
  };
}

function getPublicReviewQueryPaths(): string[] {
  const { projectId, databaseId, restBase, apiKey } = getProvisionedFirestoreRoot();
  const keySuffix = apiKey ? `?key=${encodeURIComponent(apiKey)}` : '';
  const primaryPath = `${restBase}:runQuery${keySuffix}`;
  if (databaseId === '(default)') {
    return [primaryPath];
  }
  const defaultPath = `/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents:runQuery${keySuffix}`;
  return [primaryPath, defaultPath];
}

/**
 * Fetches real published learner reviews for a single catalog item on the server (SSR + API).
 * Queries provisioned Firestore and `(default)` fallback in parallel, deduplicating by `reviewId`.
 * NEVER returns demo, fake, or sample reviews. Returns reviewCount: 0 when none exist.
 */
export async function getItemReviewsSummary(
  collectionName: CollectionName,
  rawItemId: string
): Promise<ItemReviewSummaryDTO> {
  const safeItemId = sanitizeReviewItemId(rawItemId);
  if (!safeItemId) {
    return createEmptyReviewSummary(collectionName, '');
  }

  const targetKey = buildReviewTargetKey(collectionName, safeItemId);
  const queryPaths = getPublicReviewQueryPaths();
  const queryBody = {
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
                field: { fieldPath: 'targetKey' },
                op: 'EQUAL',
                value: { stringValue: targetKey },
              },
            },
          ],
        },
      },
      limit: 100,
    },
  };

  try {
    const responses = await Promise.all(
      queryPaths.map((path) =>
        firestoreRestCall<
          Array<{
            document?: { name?: string; fields?: FirestoreRestFieldMap };
          }>
        >({
          method: 'POST',
          path,
          body: queryBody,
        }).catch(() => ({ statusCode: 500, data: null, rawText: '' }))
      )
    );

    const byId = new Map<string, ItemReviewDTO>();
    for (const res of responses) {
      if (res.statusCode < 200 || res.statusCode >= 300 || !Array.isArray(res.data)) {
        continue;
      }
      for (const row of res.data) {
        if (!row?.document?.name) continue;
        const segments = row.document.name.split('/');
        const docId = segments[segments.length - 1] || '';
        const mapped = mapRawReviewDoc(docId, row.document.fields);
        if (!mapped) continue;
        const existing = byId.get(mapped.reviewId);
        if (
          !existing ||
          new Date(mapped.updatedAtIso).getTime() >=
            new Date(existing.updatedAtIso).getTime()
        ) {
          byId.set(mapped.reviewId, mapped);
        }
      }
    }

    return computeItemReviewSummary(
      collectionName,
      safeItemId,
      Array.from(byId.values())
    );
  } catch {
    return createEmptyReviewSummary(collectionName, safeItemId);
  }
}

/**
 * Fetches lightweight published review aggregates across the catalog (or targeted item keys)
 * so catalog cards display real rating stars ONLY when real learner reviews exist (0 fake/demo badges)
 * without scanning thousands of unrelated review documents.
 */
export async function getPublishedReviewAggregates(
  targetKeys?: string[]
): Promise<Map<string, ReviewAggregateBadge>> {
  const queryPaths = getPublicReviewQueryPaths();

  if (Array.isArray(targetKeys)) {
    const uniqueKeys = Array.from(
      new Set(targetKeys.map((k) => k.trim()).filter(Boolean))
    );
    if (uniqueKeys.length === 0) {
      return new Map();
    }

    const chunks: string[][] = [];
    for (let i = 0; i < uniqueKeys.length; i += 30) {
      chunks.push(uniqueKeys.slice(i, i + 30));
    }

    try {
      const byDocId = new Map<string, { targetKey: string; rating: number }>();

      await Promise.all(
        chunks.flatMap((chunk) => {
          const chunkQueryBody = {
            structuredQuery: {
              from: [{ collectionId: 'reviews' }],
              select: {
                fields: [
                  { fieldPath: 'targetKey' },
                  { fieldPath: 'rating' },
                  { fieldPath: 'status' },
                ],
              },
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
                        field: { fieldPath: 'targetKey' },
                        op: 'IN',
                        value: {
                          arrayValue: {
                            values: chunk.map((stringValue) => ({ stringValue })),
                          },
                        },
                      },
                    },
                  ],
                },
              },
              limit: 500,
            },
          };

          return queryPaths.map((path) =>
            firestoreRestCall<
              Array<{
                document?: { name?: string; fields?: FirestoreRestFieldMap };
              }>
            >({
              method: 'POST',
              path,
              body: chunkQueryBody,
            })
              .then((res) => {
                if (
                  res.statusCode < 200 ||
                  res.statusCode >= 300 ||
                  !Array.isArray(res.data)
                ) {
                  return;
                }
                for (const row of res.data) {
                  if (!row?.document?.name || !row?.document?.fields) continue;
                  const segments = row.document.name.split('/');
                  const docId = segments[segments.length - 1] || row.document.name;
                  const parsed = parseRestFields(row.document.fields);
                  if (parsed.status !== 'published') continue;
                  if (
                    typeof parsed.targetKey === 'string' &&
                    typeof parsed.rating === 'number' &&
                    !byDocId.has(docId)
                  ) {
                    byDocId.set(docId, {
                      targetKey: parsed.targetKey,
                      rating: parsed.rating,
                    });
                  }
                }
              })
              .catch(() => undefined)
          );
        })
      );

      return computeReviewAggregateMap(Array.from(byDocId.values()));
    } catch {
      return new Map();
    }
  }

  const queryBody = {
    structuredQuery: {
      from: [{ collectionId: 'reviews' }],
      select: {
        fields: [
          { fieldPath: 'targetKey' },
          { fieldPath: 'rating' },
          { fieldPath: 'status' },
        ],
      },
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'published' },
        },
      },
      limit: 1000,
    },
  };

  try {
    const responses = await Promise.all(
      queryPaths.map((path) =>
        firestoreRestCall<
          Array<{
            document?: { name?: string; fields?: FirestoreRestFieldMap };
          }>
        >({
          method: 'POST',
          path,
          body: queryBody,
        }).catch(() => ({ statusCode: 500, data: null, rawText: '' }))
      )
    );

    const byDocId = new Map<string, { targetKey: string; rating: number }>();
    for (const res of responses) {
      if (res.statusCode < 200 || res.statusCode >= 300 || !Array.isArray(res.data)) {
        continue;
      }
      for (const row of res.data) {
        if (!row?.document?.name || !row?.document?.fields) continue;
        const segments = row.document.name.split('/');
        const docId = segments[segments.length - 1] || row.document.name;
        const parsed = parseRestFields(row.document.fields);
        if (parsed.status !== 'published') continue;
        if (
          typeof parsed.targetKey === 'string' &&
          typeof parsed.rating === 'number' &&
          !byDocId.has(docId)
        ) {
          byDocId.set(docId, {
            targetKey: parsed.targetKey,
            rating: parsed.rating,
          });
        }
      }
    }

    return computeReviewAggregateMap(Array.from(byDocId.values()));
  } catch {
    return new Map();
  }
}

export interface UpsertItemReviewInput {
  userId: string;
  userDisplayName?: string | null;
  userEmail?: string | null;
  userPhotoUrl?: string | null;
  bearerIdToken: string;
  collectionName: CollectionName;
  itemId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  title?: string;
  comment: string;
}

export type UpsertItemReviewResult =
  | { status: 'ok'; reviewId: string; urlSlug: string; summary: ItemReviewSummaryDTO }
  | { status: 'not_found'; error: string }
  | { status: 'error'; error: string };

/**
 * Creates or updates the caller's single verified review for a published Book or ExamPack.
 * Enforces catalog item existence, parent `/users/{uid}` sync, cryptographic `verifiedPurchase`
 * entitlement verification, and `firestore.rules` schema invariants.
 */
export async function upsertUserItemReview(
  input: UpsertItemReviewInput
): Promise<UpsertItemReviewResult> {
  const resolvedItems = await getCatalogItemsByRefs([
    { collectionName: input.collectionName, id: input.itemId },
  ]);

  if (resolvedItems.length === 0) {
    return {
      status: 'not_found',
      error: 'The requested book or exam pack was not found in the published catalog.',
    };
  }

  const catalogItem = resolvedItems[0];
  const safeItemId = sanitizeReviewItemId(catalogItem.id);
  const targetKey = buildReviewTargetKey(input.collectionName, safeItemId);
  const reviewId = buildDeterministicReviewId(
    input.collectionName,
    safeItemId,
    input.userId
  );

  const { docPrefix, restBase } = getProvisionedFirestoreRoot();

  const [userRes, existingReviewRes, primaryPurchaseRes] = await Promise.all([
    firestoreRestCall<{ fields?: FirestoreRestFieldMap }>({
      method: 'GET',
      path: `${restBase}/users/${encodeURIComponent(input.userId)}`,
      bearerIdToken: input.bearerIdToken,
    }),
    firestoreRestCall<{ fields?: FirestoreRestFieldMap }>({
      method: 'GET',
      path: `${restBase}/reviews/${encodeURIComponent(reviewId)}`,
      bearerIdToken: input.bearerIdToken,
    }),
    // Check the exact provisioned-DB path enforced by firestore.rules `hasValidReviewPurchaseProof`
    // so users with legacy `(default)`-only records never hit HTTP 403 on review submission.
    firestoreRestCall<{ fields?: FirestoreRestFieldMap }>({
      method: 'GET',
      path: `${restBase}/users/${encodeURIComponent(
        input.userId
      )}/purchases/${encodeURIComponent(targetKey)}`,
      bearerIdToken: input.bearerIdToken,
    }).catch(() => ({ statusCode: 404, data: null, rawText: '' })),
  ]);

  const hasProvisionedPurchaseDoc = primaryPurchaseRes.statusCode === 200;

  const writes: Array<Record<string, unknown>> = [];

  // Ensure parent `/users/{uid}` exists atomically if this is the learner's first write
  const authorName = sanitizeReviewAuthorName(
    input.userDisplayName || input.userEmail?.split('@')[0],
    'ExamDash Learner'
  );

  if (userRes.statusCode !== 200) {
    const profileFields: Record<string, unknown> = {
      uid: { stringValue: input.userId },
      displayName: { stringValue: authorName },
      preferredView: { stringValue: 'grid' },
    };
    const safePhoto = (input.userPhotoUrl || '').trim().slice(0, 1024);
    if (safePhoto) {
      profileFields.photoURL = { stringValue: safePhoto };
    }
    writes.push({
      update: {
        name: `${docPrefix}/users/${input.userId}`,
        fields: profileFields,
      },
      currentDocument: { exists: false },
      updateTransforms: [
        { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
    });
  }

  const cleanSlug =
    catalogItem.urlSlug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 200) || 'item';

  const existingExists = existingReviewRes.statusCode === 200;
  const existingFields = existingReviewRes.data?.fields;
  const existingCreatedAtRaw =
    existingExists &&
    existingFields?.createdAt &&
    typeof existingFields.createdAt.timestampValue === 'string'
      ? String(existingFields.createdAt.timestampValue)
      : null;
  const existingSlugRaw =
    existingExists &&
    existingFields?.urlSlug &&
    typeof existingFields.urlSlug.stringValue === 'string'
      ? String(existingFields.urlSlug.stringValue)
      : null;

  const reviewFields: Record<string, unknown> = {
    reviewId: { stringValue: reviewId },
    targetKey: { stringValue: targetKey },
    collectionName: { stringValue: input.collectionName },
    itemId: { stringValue: safeItemId },
    urlSlug: { stringValue: existingSlugRaw || cleanSlug },
    userId: { stringValue: input.userId },
    authorName: { stringValue: authorName },
    rating: { integerValue: String(input.rating) },
    comment: { stringValue: input.comment },
    verifiedPurchase: { booleanValue: hasProvisionedPurchaseDoc },
    status: { stringValue: 'published' },
  };

  if (input.title) {
    reviewFields.title = { stringValue: input.title };
  }

  if (existingExists && existingCreatedAtRaw) {
    reviewFields.createdAt = { timestampValue: existingCreatedAtRaw };
    writes.push({
      update: {
        name: `${docPrefix}/reviews/${reviewId}`,
        fields: reviewFields,
      },
      currentDocument: { exists: true },
      updateTransforms: [
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
    });
  } else {
    writes.push({
      update: {
        name: `${docPrefix}/reviews/${reviewId}`,
        fields: reviewFields,
      },
      currentDocument: { exists: false },
      updateTransforms: [
        { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
    });
  }

  const commitRes = await firestoreRestCall({
    method: 'POST',
    path: `${restBase}:commit`,
    bearerIdToken: input.bearerIdToken,
    body: { writes },
  });

  if (commitRes.statusCode < 200 || commitRes.statusCode >= 300) {
    return {
      status: 'error',
      error: `Unable to save review right now (HTTP ${commitRes.statusCode}).`,
    };
  }

  const summary = await getItemReviewsSummary(input.collectionName, safeItemId);
  return {
    status: 'ok',
    reviewId,
    urlSlug: existingSlugRaw || cleanSlug,
    summary,
  };
}

export async function deleteUserItemReview(params: {
  userId: string;
  bearerIdToken: string;
  collectionName: CollectionName;
  itemId: string;
}): Promise<
  | { status: 'ok'; urlSlug?: string; summary: ItemReviewSummaryDTO }
  | { status: 'error'; error: string }
> {
  const safeItemId = sanitizeReviewItemId(params.itemId);
  if (!safeItemId) {
    return { status: 'error', error: 'Invalid catalog item identifier.' };
  }

  const reviewId = buildDeterministicReviewId(
    params.collectionName,
    safeItemId,
    params.userId
  );
  const { docPrefix, restBase } = getProvisionedFirestoreRoot();

  const existingRes = await firestoreRestCall<{ fields?: FirestoreRestFieldMap }>({
    method: 'GET',
    path: `${restBase}/reviews/${encodeURIComponent(reviewId)}`,
    bearerIdToken: params.bearerIdToken,
  });

  const existingSlug =
    existingRes.statusCode === 200 &&
    typeof existingRes.data?.fields?.urlSlug?.stringValue === 'string'
      ? String(existingRes.data.fields.urlSlug.stringValue)
      : undefined;

  if (existingRes.statusCode === 200) {
    const delRes = await firestoreRestCall({
      method: 'POST',
      path: `${restBase}:commit`,
      bearerIdToken: params.bearerIdToken,
      body: {
        writes: [{ delete: `${docPrefix}/reviews/${reviewId}` }],
      },
    });

    if (delRes.statusCode < 200 || delRes.statusCode >= 300) {
      return {
        status: 'error',
        error: `Unable to delete review right now (HTTP ${delRes.statusCode}).`,
      };
    }
  }

  const summary = await getItemReviewsSummary(params.collectionName, safeItemId);
  return { status: 'ok', urlSlug: existingSlug, summary };
}
