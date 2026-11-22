import crypto from 'node:crypto';
import https from 'node:https';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  CollectionName,
  PublicBookDTO,
  PublicExamDTO,
} from '../../lib/types/catalog';
import {
  isDocumentLive,
  mapBookToPublicDTO,
  mapExamToPublicDTO,
} from '../dto/mapper';
import {
  buildFirebaseStorageHeaders,
  syncSinglePurchaseToDefaultDb,
} from '../firebase/default-db-mirror';

/**
 * Strict server-side Firestore field projections for public queries (Pillar 3).
 * Protected asset paths (`fullPdfStoragePath`, `fullMarkdownStoragePath`, `fullJsonStoragePath`)
 * are stripped to boolean existence flags on all public catalog/detail/search routes.
 */
const PUBLIC_BOOK_CARD_FIELDS = [
  'id',
  'title',
  'urlSlug',
  'seoDescription',
  'type',
  'language',
  'publisher',
  'authorName',
  'tags',
  'currency',
  'listPrice',
  'buyPrice',
  'isPublished',
  'isDeleted',
  'publishAt',
  'updatedAt',
  'createdAt',
  'samplePdfUrl',
  'sampleMarkdownUrl',
] as const;

const PUBLIC_EXAM_CARD_FIELDS = [
  'id',
  'title',
  'urlSlug',
  'seoDescription',
  'type',
  'language',
  'publisher',
  'authorName',
  'tags',
  'currency',
  'listPrice',
  'buyPrice',
  'isPublished',
  'isDeleted',
  'publishAt',
  'updatedAt',
  'createdAt',
  'totalMocktest',
  'sampleJsonStoragePath',
] as const;

const PUBLIC_BOOK_FIELDS = [
  'id',
  'title',
  'urlSlug',
  'seoDescription',
  'fullDescription',
  'type',
  'language',
  'publisher',
  'authorName',
  'tags',
  'currency',
  'listPrice',
  'buyPrice',
  'isPublished',
  'isDeleted',
  'publishAt',
  'updatedAt',
  'createdAt',
  'samplePdfUrl',
  'sampleMarkdownUrl',
  'fullPdfStoragePath',
  'fullMarkdownStoragePath',
] as const;

const PUBLIC_EXAM_FIELDS = [
  'id',
  'title',
  'urlSlug',
  'seoDescription',
  'fullDescription',
  'type',
  'language',
  'publisher',
  'authorName',
  'tags',
  'currency',
  'listPrice',
  'buyPrice',
  'isPublished',
  'isDeleted',
  'publishAt',
  'updatedAt',
  'createdAt',
  'totalMocktest',
  'MocktestTitles',
  'sampleJsonStoragePath',
  'fullJsonStoragePath',
] as const;

const supportsPublishAtOrder: Record<CollectionName, boolean> = {
  books: true,
  ExamPackDocument: true,
};

type FirestoreRestFieldMap = Record<string, Record<string, unknown>>;

function parseFirestoreRestValue(val: Record<string, unknown> | undefined): unknown {
  if (!val || typeof val !== 'object') return undefined;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('stringValue' in val) return String(val.stringValue);
  if ('timestampValue' in val) return String(val.timestampValue);
  if ('arrayValue' in val) {
    const arrObj = val.arrayValue as { values?: Record<string, unknown>[] } | undefined;
    return Array.isArray(arrObj?.values)
      ? arrObj.values.map((item) => parseFirestoreRestValue(item))
      : [];
  }
  if ('mapValue' in val) {
    const mapObj = val.mapValue as { fields?: FirestoreRestFieldMap } | undefined;
    return parseFirestoreRestFields(mapObj?.fields);
  }
  return undefined;
}

function parseFirestoreRestFields(fields: FirestoreRestFieldMap | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [key, rawVal] of Object.entries(fields)) {
    out[key] = parseFirestoreRestValue(rawVal);
  }
  return out;
}

interface ParsedFirestoreDoc {
  docId: string;
  data: Record<string, unknown>;
}

/**
 * Executes a structured query against the existing `(default)` Firestore database in `examdash-ed`
 * over `node:https` (bypassing React 19 dev-mode global `fetch` RSC serialization).
 */
function runDefaultFirestoreQuery(
  structuredQuery: Record<string, unknown>,
  options?: { includePrivateStoragePaths?: boolean }
): Promise<ParsedFirestoreDoc[]> {
  const projectId = firebaseConfig.projectId || 'examdash-ed';
  const apiKey = firebaseConfig.apiKey || '';
  const payload = JSON.stringify({ structuredQuery });
  const includePrivate = options?.includePrivateStoragePaths === true;

  const urlPath = `/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents:runQuery${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 8000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Firestore runQuery HTTP ${res.statusCode}: ${text.slice(0, 240)}`));
            return;
          }
          try {
            const rows = JSON.parse(text) as Array<{
              document?: { name?: string; fields?: FirestoreRestFieldMap };
            }>;
            const docs: ParsedFirestoreDoc[] = [];
            if (Array.isArray(rows)) {
              for (const row of rows) {
                if (!row?.document?.name) continue;
                const segments = row.document.name.split('/');
                const docId = segments[segments.length - 1] || '';
                const parsed = parseFirestoreRestFields(row.document.fields);
                if (!includePrivate) {
                  parsed.hasFullPdf =
                    typeof parsed.fullPdfStoragePath === 'string' &&
                    parsed.fullPdfStoragePath.trim().length > 0;
                  parsed.hasFullMarkdown =
                    typeof parsed.fullMarkdownStoragePath === 'string' &&
                    parsed.fullMarkdownStoragePath.trim().length > 0;
                  parsed.hasFullJson =
                    typeof parsed.fullJsonStoragePath === 'string' &&
                    parsed.fullJsonStoragePath.trim().length > 0;
                  delete parsed.fullPdfStoragePath;
                  delete parsed.fullMarkdownStoragePath;
                  delete parsed.fullJsonStoragePath;
                }
                docs.push({
                  docId,
                  data: parsed,
                });
              }
            }
            resolve(docs);
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Firestore runQuery timeout'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Executes a lightweight Firestore COUNT() aggregation query for published catalog documents
 * without transferring document payloads. Falls back gracefully to `null` if unavailable.
 */
export function getLiveCollectionCount(
  collectionId: CollectionName
): Promise<number | null> {
  const projectId = firebaseConfig.projectId || 'examdash-ed';
  const apiKey = firebaseConfig.apiKey || '';
  const payload = JSON.stringify({
    structuredAggregationQuery: {
      aggregations: [{ alias: 'total', count: {} }],
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'isPublished' },
            op: 'EQUAL',
            value: { booleanValue: true },
          },
        },
      },
    },
  });

  const urlPath = `/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents:runAggregationQuery${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            resolve(null);
            return;
          }
          try {
            const rows = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Array<{
              result?: {
                aggregateFields?: {
                  total?: { integerValue?: string | number };
                };
              };
            }>;
            const rawVal = rows?.[0]?.result?.aggregateFields?.total?.integerValue;
            const parsed = Number(rawVal);
            resolve(Number.isFinite(parsed) && parsed >= 0 ? parsed : null);
          } catch {
            resolve(null);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.write(payload);
    req.end();
  });
}

export interface CatalogPageResult<T> {
  items: T[];
  hasMore: boolean;
  nextOffset: number;
}

async function runPaginatedCollectionQuery<T>(params: {
  collectionId: CollectionName;
  fields: readonly string[];
  limit: number;
  offset: number;
  mapper: (docId: string, raw: Record<string, unknown>) => T;
}): Promise<CatalogPageResult<T>> {
  const safeLimit = Math.max(1, Math.min(24, Math.floor(params.limit) || 10));
  const safeOffset = Math.max(0, Math.min(5000, Math.floor(params.offset) || 0));
  const nowMs = Date.now();
  const items: T[] = [];
  let hasMore = false;
  let currentOffset = safeOffset;

  const queryBatch = async (batchOffset: number, batchLimit: number) => {
    const baseQuery: Record<string, unknown> = {
      from: [{ collectionId: params.collectionId }],
      select: {
        fields: params.fields.map((fieldPath) => ({ fieldPath })),
      },
      where: {
        fieldFilter: {
          field: { fieldPath: 'isPublished' },
          op: 'EQUAL',
          value: { booleanValue: true },
        },
      },
      limit: batchLimit,
      ...(batchOffset > 0 ? { offset: batchOffset } : {}),
    };

    if (supportsPublishAtOrder[params.collectionId]) {
      try {
        return await runDefaultFirestoreQuery({
          ...baseQuery,
          orderBy: [{ field: { fieldPath: 'publishAt' }, direction: 'DESCENDING' }],
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : '';
        if (msg.includes('HTTP 400') || msg.includes('FAILED_PRECONDITION')) {
          supportsPublishAtOrder[params.collectionId] = false;
          return runDefaultFirestoreQuery(baseQuery);
        }
        throw error;
      }
    }

    return runDefaultFirestoreQuery(baseQuery);
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = safeLimit - items.length;
    const rawLimit = remaining > 0 ? remaining + 1 : 1;
    const docs = await queryBatch(currentOffset, rawLimit);

    let consumedRaw = 0;
    for (const docSnap of docs) {
      const live = isDocumentLive(docSnap.data, nowMs);
      if (items.length >= safeLimit) {
        if (live) {
          hasMore = true;
          break;
        }
        consumedRaw += 1;
        continue;
      }
      consumedRaw += 1;
      if (live) {
        items.push(params.mapper(docSnap.docId, docSnap.data));
      }
    }

    currentOffset += consumedRaw;

    if (hasMore || docs.length < rawLimit) {
      break;
    }
  }

  return {
    items,
    hasMore,
    nextOffset: currentOffset,
  };
}

export async function getLiveBooksPage(options?: {
  limit?: number;
  offset?: number;
}): Promise<CatalogPageResult<PublicBookDTO>> {
  return runPaginatedCollectionQuery({
    collectionId: 'books',
    fields: PUBLIC_BOOK_CARD_FIELDS,
    limit: options?.limit ?? 10,
    offset: options?.offset ?? 0,
    mapper: mapBookToPublicDTO,
  });
}

export async function getLiveExamsPage(options?: {
  limit?: number;
  offset?: number;
}): Promise<CatalogPageResult<PublicExamDTO>> {
  return runPaginatedCollectionQuery({
    collectionId: 'ExamPackDocument',
    fields: PUBLIC_EXAM_CARD_FIELDS,
    limit: options?.limit ?? 10,
    offset: options?.offset ?? 0,
    mapper: mapExamToPublicDTO,
  });
}

export type SlugLookupResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'deleted' }
  | { status: 'not_found' };

export async function getLiveBooks(): Promise<PublicBookDTO[]> {
  const docs = await runDefaultFirestoreQuery({
    from: [{ collectionId: 'books' }],
    select: {
      fields: PUBLIC_BOOK_FIELDS.map((fieldPath) => ({ fieldPath })),
    },
    where: {
      fieldFilter: {
        field: { fieldPath: 'isPublished' },
        op: 'EQUAL',
        value: { booleanValue: true },
      },
    },
  });

  const nowMs = Date.now();
  const items: PublicBookDTO[] = [];

  for (const docSnap of docs) {
    if (isDocumentLive(docSnap.data, nowMs)) {
      items.push(mapBookToPublicDTO(docSnap.docId, docSnap.data));
    }
  }

  items.sort(
    (a, b) =>
      new Date(b.publishAtIso).getTime() - new Date(a.publishAtIso).getTime()
  );
  return items;
}

export async function getLiveExams(): Promise<PublicExamDTO[]> {
  const docs = await runDefaultFirestoreQuery({
    from: [{ collectionId: 'ExamPackDocument' }],
    select: {
      fields: PUBLIC_EXAM_FIELDS.map((fieldPath) => ({ fieldPath })),
    },
    where: {
      fieldFilter: {
        field: { fieldPath: 'isPublished' },
        op: 'EQUAL',
        value: { booleanValue: true },
      },
    },
  });

  const nowMs = Date.now();
  const items: PublicExamDTO[] = [];

  for (const docSnap of docs) {
    if (isDocumentLive(docSnap.data, nowMs)) {
      items.push(mapExamToPublicDTO(docSnap.docId, docSnap.data));
    }
  }

  items.sort(
    (a, b) =>
      new Date(b.publishAtIso).getTime() - new Date(a.publishAtIso).getTime()
  );
  return items;
}

export async function getBookBySlug(
  urlSlug: string
): Promise<SlugLookupResult<PublicBookDTO>> {
  const cleanSlug = (urlSlug || '').trim();
  if (!cleanSlug) return { status: 'not_found' };

  const docs = await runDefaultFirestoreQuery({
    from: [{ collectionId: 'books' }],
    select: {
      fields: PUBLIC_BOOK_FIELDS.map((fieldPath) => ({ fieldPath })),
    },
    where: {
      fieldFilter: {
        field: { fieldPath: 'urlSlug' },
        op: 'EQUAL',
        value: { stringValue: cleanSlug },
      },
    },
  });

  if (docs.length === 0) {
    return { status: 'not_found' };
  }

  const nowMs = Date.now();
  for (const docSnap of docs) {
    const raw = docSnap.data;
    if (raw.isDeleted === true) {
      return { status: 'deleted' };
    }
    if (isDocumentLive(raw, nowMs)) {
      return { status: 'ok', data: mapBookToPublicDTO(docSnap.docId, raw) };
    }
  }

  return { status: 'not_found' };
}

export async function getExamBySlug(
  urlSlug: string
): Promise<SlugLookupResult<PublicExamDTO>> {
  const cleanSlug = (urlSlug || '').trim();
  if (!cleanSlug) return { status: 'not_found' };

  const docs = await runDefaultFirestoreQuery({
    from: [{ collectionId: 'ExamPackDocument' }],
    select: {
      fields: PUBLIC_EXAM_FIELDS.map((fieldPath) => ({ fieldPath })),
    },
    where: {
      fieldFilter: {
        field: { fieldPath: 'urlSlug' },
        op: 'EQUAL',
        value: { stringValue: cleanSlug },
      },
    },
  });

  if (docs.length === 0) {
    return { status: 'not_found' };
  }

  const nowMs = Date.now();
  for (const docSnap of docs) {
    const raw = docSnap.data;
    if (raw.isDeleted === true) {
      return { status: 'deleted' };
    }
    if (isDocumentLive(raw, nowMs)) {
      return { status: 'ok', data: mapExamToPublicDTO(docSnap.docId, raw) };
    }
  }

  return { status: 'not_found' };
}

export interface CatalogItemRef {
  collectionName: CollectionName;
  id: string;
}

/**
 * Resolves authoritative live published catalog records by (collectionName, id) on the server.
 * Used exclusively by server-side payment order creation and verification so pricing and metadata
 * are never trusted from client payloads.
 */
export async function getCatalogItemsByRefs(
  refs: CatalogItemRef[]
): Promise<Array<PublicBookDTO | PublicExamDTO>> {
  if (!Array.isArray(refs) || refs.length === 0) return [];

  const uniqueRefs = new Map<string, CatalogItemRef>();
  for (const ref of refs) {
    const cleanId = (ref.id || '').trim();
    if (!cleanId) continue;
    if (ref.collectionName !== 'books' && ref.collectionName !== 'ExamPackDocument') {
      continue;
    }
    uniqueRefs.set(`${ref.collectionName}:${cleanId}`, {
      collectionName: ref.collectionName,
      id: cleanId,
    });
  }

  const wantsBooks = Array.from(uniqueRefs.values()).some(
    (r) => r.collectionName === 'books'
  );
  const wantsExams = Array.from(uniqueRefs.values()).some(
    (r) => r.collectionName === 'ExamPackDocument'
  );

  const [books, exams] = await Promise.all([
    wantsBooks ? getLiveBooks() : Promise.resolve([] as PublicBookDTO[]),
    wantsExams ? getLiveExams() : Promise.resolve([] as PublicExamDTO[]),
  ]);

  const bookMap = new Map<string, PublicBookDTO>();
  for (const b of books) {
    bookMap.set(b.id, b);
    bookMap.set(b.urlSlug, b);
  }

  const examMap = new Map<string, PublicExamDTO>();
  for (const e of exams) {
    examMap.set(e.id, e);
    examMap.set(e.urlSlug, e);
  }

  const resolved: Array<PublicBookDTO | PublicExamDTO> = [];
  for (const ref of uniqueRefs.values()) {
    const match =
      ref.collectionName === 'books'
        ? bookMap.get(ref.id)
        : examMap.get(ref.id);
    if (match) {
      resolved.push(match);
    }
  }

  return resolved;
}

export async function searchCatalog(rawQuery: string): Promise<{
  books: PublicBookDTO[];
  exams: PublicExamDTO[];
}> {
  const q = (rawQuery || '').trim().toLowerCase();
  const [books, exams] = await Promise.all([getLiveBooks(), getLiveExams()]);

  if (!q) {
    return {
      books: books.slice(0, 6),
      exams: exams.slice(0, 6),
    };
  }

  const matchesQuery = (
    title: string,
    authorName: string,
    tags: string[],
    type: string
  ) => {
    if (title.toLowerCase().includes(q)) return true;
    if (authorName.toLowerCase().includes(q)) return true;
    if (type.toLowerCase().includes(q)) return true;
    return tags.some((tag) => tag.toLowerCase().includes(q));
  };

  return {
    books: books
      .filter((b) => matchesQuery(b.title, b.authorName, b.tags, b.type))
      .slice(0, 8),
    exams: exams
      .filter((e) => matchesQuery(e.title, e.authorName, e.tags, e.type))
      .slice(0, 8),
  };
}

function extractBucketFromSampleUrl(sampleUrl?: string): string {
  if (!sampleUrl) return '';
  try {
    const m = sampleUrl.match(/\/v0\/b\/([^/]+)\/o\//);
    return m && m[1] ? decodeURIComponent(m[1]) : '';
  } catch {
    return '';
  }
}

export function buildStorageMediaUrl(
  storagePath: string,
  bucketHint?: string
): string {
  const trimmed = (storagePath || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('gs://')) {
    const withoutScheme = trimmed.slice('gs://'.length);
    const slashIdx = withoutScheme.indexOf('/');
    if (slashIdx > 0) {
      const gsBucket = withoutScheme.slice(0, slashIdx);
      const gsObject = withoutScheme.slice(slashIdx + 1).replace(/^\/+/, '');
      if (gsBucket && gsObject) {
        return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
          gsBucket
        )}/o/${encodeURIComponent(gsObject)}?alt=media`;
      }
    }
  }
  const bucket =
    bucketHint ||
    firebaseConfig.storageBucket ||
    'examdash-ed.firebasestorage.app';
  const encodedPath = encodeURIComponent(trimmed.replace(/^\/+/, ''));
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
    bucket
  )}/o/${encodedPath}?alt=media`;
}

/**
 * Resolves a Firebase Storage object's tokenized download URL (`?alt=media&token=...`)
 * using the caller's verified Firebase ID token when `downloadTokens` metadata is available,
 * matching Firebase Storage SDK `getDownloadURL()` behavior.
 */
export function resolveFirebaseTokenizedMediaUrl(
  mediaUrl: string,
  firebaseIdToken?: string | null
): Promise<string> {
  if (!mediaUrl) return Promise.resolve('');
  let parsed: URL;
  try {
    parsed = new URL(mediaUrl);
  } catch {
    return Promise.resolve(mediaUrl);
  }
  if (
    parsed.hostname !== 'firebasestorage.googleapis.com' ||
    parsed.searchParams.has('token')
  ) {
    return Promise.resolve(mediaUrl);
  }

  const headers = buildFirebaseStorageHeaders(firebaseIdToken, {
    Accept: 'application/json',
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname, // metadata endpoint (no ?alt=media)
        method: 'GET',
        headers,
        timeout: 6000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve(mediaUrl);
            return;
          }
          try {
            const meta = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              downloadTokens?: string;
            };
            const firstToken =
              typeof meta.downloadTokens === 'string'
                ? meta.downloadTokens.split(',')[0]?.trim()
                : '';
            if (firstToken) {
              const withToken = new URL(mediaUrl);
              withToken.searchParams.set('alt', 'media');
              withToken.searchParams.set('token', firstToken);
              resolve(withToken.toString());
              return;
            }
          } catch {
            // Fall back to ?alt=media
          }
          resolve(mediaUrl);
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(mediaUrl);
    });
    req.on('error', () => resolve(mediaUrl));
    req.end();
  });
}

export function hasFirebaseDownloadToken(url: string): boolean {
  if (!url || !url.startsWith('https://')) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'firebasestorage.googleapis.com') {
      return Boolean(parsed.searchParams.get('token')?.trim());
    }
    return true;
  } catch {
    return false;
  }
}

function getSigningSecret(): string {
  const runtimeEnv = process.env as Record<string, string | undefined>;
  return (
    runtimeEnv['ASSET_GRANT_SECRET'] ||
    runtimeEnv['RAZORPAY_KEY_SECRET'] ||
    firebaseConfig.appId ||
    'examdash-ephemeral'
  );
}

export function computeAssetGrantSignature(
  userId: string,
  collectionName: CollectionName,
  docId: string,
  expiresMs: number
): string {
  return crypto
    .createHmac('sha256', getSigningSecret())
    .update(`${userId}:${collectionName}:${docId}:${expiresMs}`)
    .digest('hex')
    .slice(0, 32);
}

export function verifyAssetGrantSignature(
  userId: string,
  collectionName: CollectionName,
  docId: string,
  expiresMs: number,
  providedSig: string
): boolean {
  if (!userId || !docId || !providedSig || !Number.isFinite(expiresMs)) {
    return false;
  }
  if (Date.now() > expiresMs) {
    return false;
  }
  const expected = computeAssetGrantSignature(
    userId,
    collectionName,
    docId,
    expiresMs
  );
  if (expected.length !== providedSig.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(providedSig, 'utf8')
    );
  } catch {
    return false;
  }
}

function getPurchaseDocInDb(params: {
  projectId: string;
  databaseId: string;
  userId: string;
  purchaseDocId: string;
  bearerIdToken: string;
}): Promise<Record<string, unknown> | null> {
  const docPath = `/v1/projects/${encodeURIComponent(
    params.projectId
  )}/databases/${encodeURIComponent(
    params.databaseId
  )}/documents/users/${encodeURIComponent(
    params.userId
  )}/purchases/${encodeURIComponent(params.purchaseDocId)}`;

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: docPath,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.bearerIdToken}`,
        },
        timeout: 6000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          try {
            const parsed = JSON.parse(
              Buffer.concat(chunks).toString('utf8')
            ) as { fields?: FirestoreRestFieldMap };
            const data = parseFirestoreRestFields(parsed.fields);
            const ownerUid = String(data.userId || data.uid || '');
            const status = String(data.status || 'completed');
            if (ownerUid === params.userId && status === 'completed') {
              resolve(data);
              return;
            }
            resolve(null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

/**
 * Verifies user purchase record in the provisioned Firestore database AND `(default)` database
 * using the caller's own Firebase Auth Bearer token (zero Admin SDK IAM required; enforced by firestore.rules).
 * Synchronously backfills missing `(default)` purchase docs using the exact 13-key `(default)` schema
 * so Firebase Storage rules grant immediate read access to `fullPdfStoragePath`, `fullMarkdownStoragePath`,
 * and `fullJsonStoragePath`.
 */
export async function verifyCallerPurchaseRecord(
  userId: string,
  collectionName: CollectionName,
  rawItemId: string,
  bearerIdToken: string,
  catalogFallback?: {
    title?: string;
    urlSlug?: string;
    currency?: string;
    buyPrice?: number;
  }
): Promise<boolean> {
  if (!userId || !rawItemId || !bearerIdToken) return false;
  const projectId = firebaseConfig.projectId || 'examdash-ed';
  const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
  const safeItemId = rawItemId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const purchaseId = `${collectionName}_${safeItemId}`.slice(0, 120);

  const [primaryDoc, defaultDoc, defaultRawAliasDoc, defaultExamAliasDoc] =
    await Promise.all([
      getPurchaseDocInDb({
        projectId,
        databaseId,
        userId,
        purchaseDocId: purchaseId,
        bearerIdToken,
      }),
      databaseId !== '(default)'
        ? getPurchaseDocInDb({
            projectId,
            databaseId: '(default)',
            userId,
            purchaseDocId: purchaseId,
            bearerIdToken,
          })
        : Promise.resolve(null),
      databaseId !== '(default)'
        ? getPurchaseDocInDb({
            projectId,
            databaseId: '(default)',
            userId,
            purchaseDocId: safeItemId,
            bearerIdToken,
          })
        : Promise.resolve(null),
      databaseId !== '(default)' && collectionName === 'ExamPackDocument'
        ? getPurchaseDocInDb({
            projectId,
            databaseId: '(default)',
            userId,
            purchaseDocId: `exams_${safeItemId}`.slice(0, 120),
            bearerIdToken,
          })
        : Promise.resolve(null),
    ]);

  if (
    primaryDoc &&
    databaseId !== '(default)' &&
    (!defaultDoc ||
      !defaultRawAliasDoc ||
      (collectionName === 'ExamPackDocument' && !defaultExamAliasDoc))
  ) {
    const paidPrice =
      typeof primaryDoc.paidPrice === 'number'
        ? primaryDoc.paidPrice
        : typeof primaryDoc.amountPaid === 'number'
        ? primaryDoc.amountPaid
        : Number(
            primaryDoc.paidPrice ??
              primaryDoc.amountPaid ??
              catalogFallback?.buyPrice ??
              0
          ) || 0;

    await syncSinglePurchaseToDefaultDb({
      uid: userId,
      itemId: safeItemId,
      collectionName,
      title: String(
        primaryDoc.title || catalogFallback?.title || 'ExamDash Resource'
      ),
      urlSlug: String(
        primaryDoc.urlSlug || catalogFallback?.urlSlug || safeItemId
      ),
      currency: String(
        primaryDoc.currency || catalogFallback?.currency || 'INR'
      ),
      paidPrice,
      razorpayOrderId:
        typeof primaryDoc.razorpayOrderId === 'string'
          ? primaryDoc.razorpayOrderId
          : undefined,
      razorpayPaymentId:
        typeof primaryDoc.razorpayPaymentId === 'string'
          ? primaryDoc.razorpayPaymentId
          : undefined,
      createdAtIso:
        typeof primaryDoc.createdAt === 'string'
          ? primaryDoc.createdAt
          : typeof primaryDoc.purchasedAt === 'string'
          ? primaryDoc.purchasedAt
          : undefined,
      bearerIdToken,
    });
  }

  return Boolean(
    primaryDoc || defaultDoc || defaultRawAliasDoc || defaultExamAliasDoc
  );
}

export interface SignedAssetGrant {
  itemId: string;
  collectionName: CollectionName;
  urlSlug: string;
  expiresAtIso: string;
  signature: string;
  remoteUpdatedAtIso?: string;
  hasFullPdf?: boolean;
  hasFullMarkdown?: boolean;
  hasFullJson?: boolean;
  assets: {
    pdfUrl?: string;
    markdownUrl?: string;
    jsonUrl?: string;
  };
  directUrls?: {
    pdfUrl?: string;
    markdownUrl?: string;
    jsonUrl?: string;
  };
  storagePaths?: {
    fullPdfStoragePath?: string;
    fullMarkdownStoragePath?: string;
    fullJsonStoragePath?: string;
  };
}

export type UnlockGrantResult =
  | { status: 'ok'; grant: SignedAssetGrant }
  | { status: 'not_found' }
  | { status: 'forbidden' };

/**
 * Server-only protected asset unlock helper.
 * Queries full storage paths (`fullPdfStoragePath`, `fullMarkdownStoragePath`, `fullJsonStoragePath`)
 * strictly inside the authenticated `/api/v1/library/unlock` boundary ONLY after caller identity
 * and purchase entitlement verification. Never falls back to sample URLs in `full` mode.
 */
export async function issueShortLivedAssetGrant(
  collectionName: CollectionName,
  urlSlug: string,
  userId: string,
  bearerIdToken?: string
): Promise<UnlockGrantResult> {
  const cleanSlug = urlSlug.trim();
  const docs = await runDefaultFirestoreQuery(
    {
      from: [{ collectionId: collectionName }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'urlSlug' },
          op: 'EQUAL',
          value: { stringValue: cleanSlug },
        },
      },
    },
    { includePrivateStoragePaths: true }
  );
  if (docs.length === 0) return { status: 'not_found' };

  const docSnap = docs[0];
  const raw = docSnap.data;
  if (!isDocumentLive(raw)) return { status: 'not_found' };

  const itemId =
    typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : docSnap.docId;
  const buyPrice =
    typeof raw.buyPrice === 'number' ? raw.buyPrice : Number(raw.buyPrice) || 0;

  const catalogFallback = {
    title: typeof raw.title === 'string' ? raw.title : undefined,
    urlSlug: cleanSlug,
    currency: typeof raw.currency === 'string' ? raw.currency : 'INR',
    buyPrice,
  };

  // Strictly verify caller purchase entitlement for paid items (and backfill `(default)` DB for Storage rules)
  if (buyPrice > 0) {
    if (!bearerIdToken) {
      return { status: 'forbidden' };
    }
    const entitledByItemId = await verifyCallerPurchaseRecord(
      userId,
      collectionName,
      itemId,
      bearerIdToken,
      catalogFallback
    );
    const entitledByDocId =
      !entitledByItemId && docSnap.docId !== itemId
        ? await verifyCallerPurchaseRecord(
            userId,
            collectionName,
            docSnap.docId,
            bearerIdToken,
            catalogFallback
          )
        : false;

    if (!entitledByItemId && !entitledByDocId) {
      return { status: 'forbidden' };
    }
  } else if (bearerIdToken) {
    await verifyCallerPurchaseRecord(
      userId,
      collectionName,
      itemId,
      bearerIdToken,
      catalogFallback
    );
  }

  const expiresMs = Date.now() + 15 * 60 * 1000; // <= 15 minutes
  const expiresAtIso = new Date(expiresMs).toISOString();
  const signature = computeAssetGrantSignature(
    userId,
    collectionName,
    docSnap.docId,
    expiresMs
  );

  if (collectionName === 'books') {
    const mappedBook = mapBookToPublicDTO(docSnap.docId, raw);
    const fullPdf =
      typeof raw.fullPdfStoragePath === 'string'
        ? raw.fullPdfStoragePath.trim()
        : '';
    const fullMd =
      typeof raw.fullMarkdownStoragePath === 'string'
        ? raw.fullMarkdownStoragePath.trim()
        : '';
    const samplePdf =
      typeof raw.samplePdfUrl === 'string' ? raw.samplePdfUrl.trim() : '';
    const sampleMd =
      typeof raw.sampleMarkdownUrl === 'string'
        ? raw.sampleMarkdownUrl.trim()
        : '';

    const bucketHint =
      extractBucketFromSampleUrl(samplePdf) ||
      extractBucketFromSampleUrl(sampleMd);

    const [directPdfUrl, directMdUrl] = await Promise.all([
      fullPdf
        ? resolveFirebaseTokenizedMediaUrl(
            buildStorageMediaUrl(fullPdf, bucketHint),
            bearerIdToken
          )
        : Promise.resolve(''),
      fullMd
        ? resolveFirebaseTokenizedMediaUrl(
            buildStorageMediaUrl(fullMd, bucketHint),
            bearerIdToken
          )
        : Promise.resolve(''),
    ]);

    const baseQuery = `collection=books&slug=${encodeURIComponent(
      cleanSlug
    )}&mode=full&uid=${encodeURIComponent(
      userId
    )}&exp=${expiresMs}&sig=${signature}`;

    return {
      status: 'ok',
      grant: {
        itemId,
        collectionName,
        urlSlug: cleanSlug,
        expiresAtIso,
        signature,
        remoteUpdatedAtIso: mappedBook.updatedAtIso,
        hasFullPdf: Boolean(fullPdf),
        hasFullMarkdown: Boolean(fullMd),
        assets: {
          ...(fullPdf
            ? {
                pdfUrl: `/api/v1/library/stream?${baseQuery}&format=pdf`,
              }
            : {}),
          ...(fullMd
            ? {
                markdownUrl: `/api/v1/library/stream?${baseQuery}&format=markdown`,
              }
            : {}),
        },
        directUrls: {
          ...(hasFirebaseDownloadToken(directPdfUrl)
            ? { pdfUrl: directPdfUrl }
            : {}),
          ...(hasFirebaseDownloadToken(directMdUrl)
            ? { markdownUrl: directMdUrl }
            : {}),
        },
        storagePaths: {
          ...(fullPdf ? { fullPdfStoragePath: fullPdf } : {}),
          ...(fullMd ? { fullMarkdownStoragePath: fullMd } : {}),
        },
      },
    };
  }

  const mappedExam = mapExamToPublicDTO(docSnap.docId, raw);
  const fullJson =
    typeof raw.fullJsonStoragePath === 'string'
      ? raw.fullJsonStoragePath.trim()
      : '';
  const sampleJson =
    typeof raw.sampleJsonStoragePath === 'string'
      ? raw.sampleJsonStoragePath.trim()
      : '';
  const examBucketHint = extractBucketFromSampleUrl(sampleJson);

  const directJsonUrl = fullJson
    ? await resolveFirebaseTokenizedMediaUrl(
        buildStorageMediaUrl(fullJson, examBucketHint),
        bearerIdToken
      )
    : '';

  const examStreamUrl = `/api/v1/exams/${encodeURIComponent(
    cleanSlug
  )}?mode=full&uid=${encodeURIComponent(
    userId
  )}&exp=${expiresMs}&sig=${signature}`;

  return {
    status: 'ok',
    grant: {
      itemId,
      collectionName,
      urlSlug: cleanSlug,
      expiresAtIso,
      signature,
      remoteUpdatedAtIso: mappedExam.updatedAtIso,
      hasFullJson: Boolean(fullJson),
      assets: {
        ...(fullJson ? { jsonUrl: examStreamUrl } : {}),
      },
      directUrls: {
        ...(hasFirebaseDownloadToken(directJsonUrl)
          ? { jsonUrl: directJsonUrl }
          : {}),
      },
      storagePaths: {
        ...(fullJson ? { fullJsonStoragePath: fullJson } : {}),
      },
    },
  };
}

export interface ExamUpstreamResolution {
  docId: string;
  itemId: string;
  urlSlug: string;
  title: string;
  buyPrice: number;
  mocktestTitles: PublicExamDTO['MocktestTitles'];
  upstreamUrl: string;
}

/**
 * Resolves ExamPack JSON upstream URLs on the server for `/api/v1/exams/[packId]`
 * so `fullJsonStoragePath` never leaks into public HTML/RSC payloads and full packs
 * strictly enforce user authentication & purchase ownership without falling back to sample JSON.
 */
export async function resolveExamPackUpstream(params: {
  packIdentifier: string;
  mode: 'sample' | 'full';
  uid?: string;
  expMs?: number;
  sig?: string;
  verifiedTokenUid?: string | null;
  bearerIdToken?: string | null;
}): Promise<
  | { status: 'ok'; target: ExamUpstreamResolution }
  | { status: 'not_found' }
  | { status: 'unauthorized' }
  | { status: 'forbidden' }
> {
  const cleanIdent = (params.packIdentifier || '').trim();
  if (!cleanIdent) return { status: 'not_found' };

  // Match by urlSlug first, then by id if needed
  let docs = await runDefaultFirestoreQuery(
    {
      from: [{ collectionId: 'ExamPackDocument' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'urlSlug' },
          op: 'EQUAL',
          value: { stringValue: cleanIdent },
        },
      },
    },
    { includePrivateStoragePaths: true }
  );

  if (docs.length === 0) {
    docs = await runDefaultFirestoreQuery(
      {
        from: [{ collectionId: 'ExamPackDocument' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'id' },
            op: 'EQUAL',
            value: { stringValue: cleanIdent },
          },
        },
      },
      { includePrivateStoragePaths: true }
    );
  }

  if (docs.length === 0) return { status: 'not_found' };
  const docSnap = docs[0];
  const raw = docSnap.data;
  if (!isDocumentLive(raw)) return { status: 'not_found' };

  const mappedDto = mapExamToPublicDTO(docSnap.docId, raw);
  const samplePath =
    typeof raw.sampleJsonStoragePath === 'string'
      ? raw.sampleJsonStoragePath.trim()
      : '';
  const fullPath =
    typeof raw.fullJsonStoragePath === 'string'
      ? raw.fullJsonStoragePath.trim()
      : '';

  const bucketHint = extractBucketFromSampleUrl(samplePath);
  const sampleUrl = samplePath ? buildStorageMediaUrl(samplePath, bucketHint) : '';
  const fullMediaUrl = fullPath ? buildStorageMediaUrl(fullPath, bucketHint) : '';

  if (params.mode === 'sample') {
    const resolvedSampleUrl = sampleUrl
      ? await resolveFirebaseTokenizedMediaUrl(sampleUrl, params.bearerIdToken)
      : '';
    return {
      status: 'ok',
      target: {
        docId: docSnap.docId,
        itemId: mappedDto.id,
        urlSlug: mappedDto.urlSlug,
        title: mappedDto.title,
        buyPrice: mappedDto.buyPrice,
        mocktestTitles: mappedDto.MocktestTitles,
        upstreamUrl: resolvedSampleUrl,
      },
    };
  }

  // Full mode requires EITHER a valid <= 15m HMAC grant OR verified Bearer token + ownership
  const hasValidSignedGrant = Boolean(
    params.uid &&
      params.expMs &&
      params.sig &&
      verifyAssetGrantSignature(
        params.uid,
        'ExamPackDocument',
        docSnap.docId,
        params.expMs,
        params.sig
      )
  );

  if (!hasValidSignedGrant) {
    if (!params.verifiedTokenUid || !params.bearerIdToken) {
      return { status: 'unauthorized' };
    }
    if (mappedDto.buyPrice > 0) {
      const entitled = await verifyCallerPurchaseRecord(
        params.verifiedTokenUid,
        'ExamPackDocument',
        mappedDto.id,
        params.bearerIdToken,
        {
          title: mappedDto.title,
          urlSlug: mappedDto.urlSlug,
          currency: mappedDto.currency,
          buyPrice: mappedDto.buyPrice,
        }
      );
      if (!entitled) {
        return { status: 'forbidden' };
      }
    }
  } else if (params.verifiedTokenUid && params.bearerIdToken) {
    // Ensure `(default)` DB purchase mirror is synced so Firebase Storage rules authorize fullJsonStoragePath
    await verifyCallerPurchaseRecord(
      params.verifiedTokenUid,
      'ExamPackDocument',
      mappedDto.id,
      params.bearerIdToken,
      {
        title: mappedDto.title,
        urlSlug: mappedDto.urlSlug,
        currency: mappedDto.currency,
        buyPrice: mappedDto.buyPrice,
      }
    );
  }

  if (!fullMediaUrl) {
    return { status: 'not_found' };
  }

  const resolvedFullUrl = await resolveFirebaseTokenizedMediaUrl(
    fullMediaUrl,
    params.bearerIdToken
  );

  return {
    status: 'ok',
    target: {
      docId: docSnap.docId,
      itemId: mappedDto.id,
      urlSlug: mappedDto.urlSlug,
      title: mappedDto.title,
      buyPrice: mappedDto.buyPrice,
      mocktestTitles: mappedDto.MocktestTitles,
      upstreamUrl: resolvedFullUrl,
    },
  };
}

export interface BookUpstreamResolution {
  docId: string;
  itemId: string;
  upstreamUrl: string;
  contentType: string;
}

/**
 * Resolves the upstream Firebase Storage URL on the server for `/api/v1/library/stream`
 * so raw private storage paths never enter public HTML and browsers/Workers avoid CORS errors.
 * In `full` mode, strictly resolves `fullPdfStoragePath` / `fullMarkdownStoragePath` without sample fallback.
 */
export async function resolveBookStreamUpstream(params: {
  urlSlug: string;
  mode: 'sample' | 'full';
  format: 'pdf' | 'markdown';
  uid?: string;
  expMs?: number;
  sig?: string;
  verifiedTokenUid?: string | null;
  bearerIdToken?: string | null;
}): Promise<
  | { status: 'ok'; target: BookUpstreamResolution }
  | { status: 'not_found' }
  | { status: 'unauthorized' }
> {
  const cleanSlug = (params.urlSlug || '').trim();
  if (!cleanSlug) return { status: 'not_found' };

  const docs = await runDefaultFirestoreQuery(
    {
      from: [{ collectionId: 'books' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'urlSlug' },
          op: 'EQUAL',
          value: { stringValue: cleanSlug },
        },
      },
    },
    { includePrivateStoragePaths: true }
  );

  if (docs.length === 0) return { status: 'not_found' };
  const docSnap = docs[0];
  const raw = docSnap.data;
  if (!isDocumentLive(raw)) return { status: 'not_found' };

  const itemId =
    typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : docSnap.docId;
  const buyPrice =
    typeof raw.buyPrice === 'number' ? raw.buyPrice : Number(raw.buyPrice) || 0;
  const contentType =
    params.format === 'pdf'
      ? 'application/pdf'
      : 'text/markdown; charset=utf-8';

  const samplePdf =
    typeof raw.samplePdfUrl === 'string' ? raw.samplePdfUrl.trim() : '';
  const sampleMd =
    typeof raw.sampleMarkdownUrl === 'string'
      ? raw.sampleMarkdownUrl.trim()
      : '';
  const bucketHint =
    extractBucketFromSampleUrl(samplePdf) ||
    extractBucketFromSampleUrl(sampleMd);

  const samplePath = params.format === 'pdf' ? samplePdf : sampleMd;

  if (params.mode === 'sample') {
    const sampleUrl = samplePath
      ? buildStorageMediaUrl(samplePath, bucketHint)
      : '';
    if (!sampleUrl) return { status: 'not_found' };
    return {
      status: 'ok',
      target: {
        docId: docSnap.docId,
        itemId,
        upstreamUrl: sampleUrl,
        contentType,
      },
    };
  }

  // Full mode requires valid <= 15m HMAC grant signature
  if (
    !params.uid ||
    !params.expMs ||
    !params.sig ||
    !verifyAssetGrantSignature(
      params.uid,
      'books',
      docSnap.docId,
      params.expMs,
      params.sig
    )
  ) {
    return { status: 'unauthorized' };
  }

  if (params.verifiedTokenUid && params.bearerIdToken) {
    await verifyCallerPurchaseRecord(
      params.verifiedTokenUid,
      'books',
      itemId,
      params.bearerIdToken,
      {
        title: typeof raw.title === 'string' ? raw.title : undefined,
        urlSlug: cleanSlug,
        currency: typeof raw.currency === 'string' ? raw.currency : 'INR',
        buyPrice,
      }
    );
  }

  const fullPath =
    params.format === 'pdf'
      ? typeof raw.fullPdfStoragePath === 'string'
        ? raw.fullPdfStoragePath.trim()
        : ''
      : typeof raw.fullMarkdownStoragePath === 'string'
      ? raw.fullMarkdownStoragePath.trim()
      : '';

  if (!fullPath) return { status: 'not_found' };

  const baseMediaUrl = buildStorageMediaUrl(fullPath, bucketHint);
  if (!baseMediaUrl) return { status: 'not_found' };

  const resolvedFullUrl = await resolveFirebaseTokenizedMediaUrl(
    baseMediaUrl,
    params.bearerIdToken
  );

  return {
    status: 'ok',
    target: {
      docId: docSnap.docId,
      itemId,
      upstreamUrl: resolvedFullUrl,
      contentType,
    },
  };
}

export function resolvePublicSampleJsonUrl(sampleJsonStoragePath: string): string {
  return buildStorageMediaUrl(sampleJsonStoragePath);
}
