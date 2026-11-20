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
function runDefaultFirestoreQuery(structuredQuery: Record<string, unknown>): Promise<ParsedFirestoreDoc[]> {
  const projectId = firebaseConfig.projectId || 'examdash-ed';
  const apiKey = firebaseConfig.apiKey || '';
  const payload = JSON.stringify({ structuredQuery });

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
                docs.push({
                  docId,
                  data: parseFirestoreRestFields(row.document.fields),
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

export interface SignedAssetGrant {
  itemId: string;
  collectionName: CollectionName;
  urlSlug: string;
  expiresAtIso: string;
  signature: string;
  assets: {
    pdfUrl?: string;
    markdownUrl?: string;
    jsonUrl?: string;
  };
}

/**
 * Server-only protected asset unlock helper.
 * Queries full storage paths strictly inside the authenticated `/api/v1/library/unlock` boundary
 * ONLY after caller identity and purchase entitlement verification.
 */
export async function issueShortLivedAssetGrant(
  collectionName: CollectionName,
  urlSlug: string,
  userId: string
): Promise<SignedAssetGrant | null> {
  const docs = await runDefaultFirestoreQuery({
    from: [{ collectionId: collectionName }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'urlSlug' },
        op: 'EQUAL',
        value: { stringValue: urlSlug.trim() },
      },
    },
  });
  if (docs.length === 0) return null;

  const docSnap = docs[0];
  const raw = docSnap.data;
  if (!isDocumentLive(raw)) return null;

  const expiresMs = Date.now() + 15 * 60 * 1000; // <= 15 minutes
  const expiresAtIso = new Date(expiresMs).toISOString();
  const signingSecret =
    process.env.GEMINI_API_KEY || firebaseConfig.appId || 'examdash-ephemeral';

  const signature = crypto
    .createHmac('sha256', signingSecret)
    .update(`${userId}:${collectionName}:${docSnap.docId}:${expiresMs}`)
    .digest('hex')
    .slice(0, 32);

  if (collectionName === 'books') {
    const fullPdf =
      typeof raw.fullPdfStoragePath === 'string'
        ? raw.fullPdfStoragePath.trim()
        : '';
    const fullMd =
      typeof raw.fullMarkdownStoragePath === 'string'
        ? raw.fullMarkdownStoragePath.trim()
        : '';

    return {
      itemId: typeof raw.id === 'string' ? raw.id : docSnap.docId,
      collectionName,
      urlSlug,
      expiresAtIso,
      signature,
      assets: {
        ...(fullPdf
          ? {
              pdfUrl: `${buildStorageMediaUrl(fullPdf)}&ed_sig=${signature}&ed_exp=${expiresMs}`,
            }
          : {}),
        ...(fullMd
          ? {
              markdownUrl: `${buildStorageMediaUrl(fullMd)}&ed_sig=${signature}&ed_exp=${expiresMs}`,
            }
          : {}),
      },
    };
  }

  const fullJson =
    typeof raw.fullJsonStoragePath === 'string'
      ? raw.fullJsonStoragePath.trim()
      : '';

  return {
    itemId: typeof raw.id === 'string' ? raw.id : docSnap.docId,
    collectionName,
    urlSlug,
    expiresAtIso,
    signature,
    assets: {
      ...(fullJson
        ? {
            jsonUrl: `${buildStorageMediaUrl(fullJson)}&ed_sig=${signature}&ed_exp=${expiresMs}`,
          }
        : {}),
    },
  };
}

export function resolvePublicSampleJsonUrl(sampleJsonStoragePath: string): string {
  return buildStorageMediaUrl(sampleJsonStoragePath);
}
