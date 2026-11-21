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

/**
 * Strict server-side Firestore field projections for public queries (Pillar 3).
 * Protected asset paths (`fullPdfStoragePath`, `fullMarkdownStoragePath`, `fullJsonStoragePath`)
 * are omitted at the Firestore wire-projection layer on all public catalog/detail/search routes.
 */
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

function buildStorageMediaUrl(storagePath: string): string {
  if (!storagePath) return '';
  if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) {
    return storagePath;
  }
  const bucket = firebaseConfig.storageBucket || 'examdash-ed.firebasestorage.app';
  const encodedPath = encodeURIComponent(storagePath.replace(/^\/+/, ''));
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
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

/**
 * Verifies user purchase record in the provisioned Firestore database using the caller's
 * own Firebase Auth Bearer token (zero Admin SDK IAM required; enforced by firestore.rules).
 */
export async function verifyCallerPurchaseRecord(
  userId: string,
  collectionName: CollectionName,
  rawItemId: string,
  bearerIdToken: string
): Promise<boolean> {
  if (!userId || !rawItemId || !bearerIdToken) return false;
  const projectId = firebaseConfig.projectId || 'examdash-ed';
  const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
  const safeItemId = rawItemId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const purchaseId = `${collectionName}_${safeItemId}`.slice(0, 120);

  const docPath = `/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(
    databaseId
  )}/documents/users/${encodeURIComponent(
    userId
  )}/purchases/${encodeURIComponent(purchaseId)}`;

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: docPath,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bearerIdToken}`,
        },
        timeout: 6000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve(false);
            return;
          }
          try {
            const parsed = JSON.parse(
              Buffer.concat(chunks).toString('utf8')
            ) as { fields?: FirestoreRestFieldMap };
            const data = parseFirestoreRestFields(parsed.fields);
            resolve(
              data.userId === userId && data.status === 'completed'
            );
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
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
}

export type UnlockGrantResult =
  | { status: 'ok'; grant: SignedAssetGrant }
  | { status: 'not_found' }
  | { status: 'forbidden' };

/**
 * Server-only protected asset unlock helper.
 * Queries full storage paths strictly inside the authenticated `/api/v1/library/unlock` boundary
 * ONLY after caller identity and purchase entitlement verification.
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

  // Verify caller purchase entitlement for paid items when Bearer token is supplied
  if (buyPrice > 0 && bearerIdToken) {
    const entitled = await verifyCallerPurchaseRecord(
      userId,
      collectionName,
      itemId,
      bearerIdToken
    );
    if (!entitled) {
      return { status: 'forbidden' };
    }
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
          ...(fullPdf || samplePdf
            ? {
                pdfUrl: `/api/v1/library/stream?${baseQuery}&format=pdf`,
              }
            : {}),
          ...(fullMd || sampleMd
            ? {
                markdownUrl: `/api/v1/library/stream?${baseQuery}&format=markdown`,
              }
            : {}),
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
        ...(fullJson || sampleJson ? { jsonUrl: examStreamUrl } : {}),
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
  fallbackSampleUrl?: string;
}

/**
 * Resolves ExamPack JSON upstream URLs on the server for `/api/v1/exams/[packId]`
 * so `fullJsonStoragePath` never leaks into public HTML/RSC payloads and full packs
 * strictly enforce user authentication & purchase ownership.
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

  const sampleUrl = samplePath ? buildStorageMediaUrl(samplePath) : '';
  const fullUrl = fullPath ? buildStorageMediaUrl(fullPath) : '';

  if (params.mode === 'sample') {
    return {
      status: 'ok',
      target: {
        docId: docSnap.docId,
        itemId: mappedDto.id,
        urlSlug: mappedDto.urlSlug,
        title: mappedDto.title,
        buyPrice: mappedDto.buyPrice,
        mocktestTitles: mappedDto.MocktestTitles,
        upstreamUrl: sampleUrl,
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
        params.bearerIdToken
      );
      if (!entitled) {
        return { status: 'forbidden' };
      }
    }
  }

  return {
    status: 'ok',
    target: {
      docId: docSnap.docId,
      itemId: mappedDto.id,
      urlSlug: mappedDto.urlSlug,
      title: mappedDto.title,
      buyPrice: mappedDto.buyPrice,
      mocktestTitles: mappedDto.MocktestTitles,
      upstreamUrl: fullUrl || sampleUrl,
      fallbackSampleUrl: sampleUrl || undefined,
    },
  };
}

export interface BookUpstreamResolution {
  docId: string;
  itemId: string;
  upstreamUrl: string;
  fallbackSampleUrl?: string;
  contentType: string;
}

/**
 * Resolves the upstream Firebase Storage URL on the server for `/api/v1/library/stream`
 * so raw private storage paths never enter public HTML and browsers/Workers avoid CORS errors.
 */
export async function resolveBookStreamUpstream(params: {
  urlSlug: string;
  mode: 'sample' | 'full';
  format: 'pdf' | 'markdown';
  uid?: string;
  expMs?: number;
  sig?: string;
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
  const contentType =
    params.format === 'pdf'
      ? 'application/pdf'
      : 'text/markdown; charset=utf-8';

  const sampleUrl =
    params.format === 'pdf'
      ? typeof raw.samplePdfUrl === 'string'
        ? raw.samplePdfUrl.trim()
        : ''
      : typeof raw.sampleMarkdownUrl === 'string'
      ? raw.sampleMarkdownUrl.trim()
      : '';

  if (params.mode === 'sample') {
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

  const fullPath =
    params.format === 'pdf'
      ? typeof raw.fullPdfStoragePath === 'string'
        ? raw.fullPdfStoragePath.trim()
        : ''
      : typeof raw.fullMarkdownStoragePath === 'string'
      ? raw.fullMarkdownStoragePath.trim()
      : '';

  const upstreamUrl = fullPath ? buildStorageMediaUrl(fullPath) : sampleUrl;
  if (!upstreamUrl) return { status: 'not_found' };

  return {
    status: 'ok',
    target: {
      docId: docSnap.docId,
      itemId,
      upstreamUrl,
      fallbackSampleUrl: sampleUrl || undefined,
      contentType,
    },
  };
}

export function resolvePublicSampleJsonUrl(sampleJsonStoragePath: string): string {
  return buildStorageMediaUrl(sampleJsonStoragePath);
}
