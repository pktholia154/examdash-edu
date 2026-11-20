import type {
  MocktestTitleItem,
  PublicBookDTO,
  PublicExamDTO,
} from '../../lib/types/catalog';

interface TimestampLike {
  toMillis?: () => number;
  seconds?: number;
  nanoseconds?: number;
}

export function extractTimestampMs(val: unknown): number | null {
  if (!val) return null;
  if (typeof val === 'object') {
    const ts = val as TimestampLike;
    if (typeof ts.toMillis === 'function') {
      const ms = ts.toMillis();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof ts.seconds === 'number') {
      return ts.seconds * 1000 + Math.floor((ts.nanoseconds ?? 0) / 1_000_000);
    }
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const parsed = new Date(val).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isDocumentLive(raw: Record<string, unknown>, nowMs: number = Date.now()): boolean {
  if (raw.isPublished !== true) return false;
  if (raw.isDeleted === true) return false;

  const publishMs =
    extractTimestampMs(raw.publishAt) ?? extractTimestampMs(raw.createdAt) ?? 0;

  return publishMs <= nowMs;
}

function normalizeTags(rawTags: unknown): string[] {
  if (!Array.isArray(rawTags)) return [];
  return rawTags
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim())
    .slice(0, 25);
}

function normalizePrice(val: unknown): number {
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function normalizeProse(val: unknown): string {
  if (typeof val !== 'string') return '';
  return val.replace(/\\n/g, '\n').trim();
}

/**
 * Maps raw Firestore `books` document to strictly whitelisted PublicBookDTO.
 * Strips `fullPdfStoragePath` and `fullMarkdownStoragePath` so private storage paths never enter HTML/hydration payloads.
 */
export function mapBookToPublicDTO(
  docId: string,
  raw: Record<string, unknown>
): PublicBookDTO {
  const createdMs = extractTimestampMs(raw.createdAt) ?? Date.now();
  const publishMs = extractTimestampMs(raw.publishAt) ?? createdMs;
  const updatedMs = extractTimestampMs(raw.updatedAt) ?? publishMs;

  const buyPrice = normalizePrice(raw.buyPrice);
  const listPrice = Math.max(buyPrice, normalizePrice(raw.listPrice));

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : docId,
    collectionName: 'books',
    title: typeof raw.title === 'string' ? raw.title.trim() : 'Untitled Book',
    urlSlug: typeof raw.urlSlug === 'string' ? raw.urlSlug.trim() : docId,
    seoDescription: normalizeProse(raw.seoDescription),
    fullDescription: normalizeProse(raw.fullDescription),
    type: typeof raw.type === 'string' && raw.type.trim() ? raw.type.trim() : 'Ebook',
    language:
      typeof raw.language === 'string' && raw.language.trim()
        ? raw.language.trim()
        : 'English',
    publisher:
      typeof raw.publisher === 'string' && raw.publisher.trim()
        ? raw.publisher.trim()
        : 'ExamDash',
    authorName:
      typeof raw.authorName === 'string' && raw.authorName.trim()
        ? raw.authorName.trim()
        : 'ExamDash Editorial',
    tags: normalizeTags(raw.tags),
    currency:
      typeof raw.currency === 'string' && raw.currency.trim()
        ? raw.currency.trim().toUpperCase()
        : 'INR',
    listPrice,
    buyPrice,
    publishAtIso: new Date(publishMs).toISOString(),
    updatedAtIso: new Date(updatedMs).toISOString(),
    createdAtIso: new Date(createdMs).toISOString(),
    samplePdfUrl:
      typeof raw.samplePdfUrl === 'string' ? raw.samplePdfUrl.trim() : '',
    sampleMarkdownUrl:
      typeof raw.sampleMarkdownUrl === 'string' ? raw.sampleMarkdownUrl.trim() : '',
    hasFullPdf:
      raw.hasFullPdf === true ||
      (typeof raw.fullPdfStoragePath === 'string' &&
        raw.fullPdfStoragePath.trim().length > 0),
    hasFullMarkdown:
      raw.hasFullMarkdown === true ||
      (typeof raw.fullMarkdownStoragePath === 'string' &&
        raw.fullMarkdownStoragePath.trim().length > 0),
  };
}

function normalizeMocktestTitles(rawList: unknown): MocktestTitleItem[] {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((entry, idx) => ({
      id:
        typeof entry.id === 'string' && entry.id.trim()
          ? entry.id.trim()
          : `mock_${idx + 1}`,
      title:
        typeof entry.title === 'string' && entry.title.trim()
          ? entry.title.trim()
          : `Mock Test ${idx + 1}`,
      duration: normalizePrice(entry.duration),
      totalQuestions: normalizePrice(entry.totalQuestions),
      totalMarks: normalizePrice(entry.totalMarks),
    }));
}

/**
 * Maps raw Firestore `ExamPackDocument` document to strictly whitelisted PublicExamDTO.
 * Strips `fullJsonStoragePath` so private storage paths never enter HTML/hydration payloads.
 */
export function mapExamToPublicDTO(
  docId: string,
  raw: Record<string, unknown>
): PublicExamDTO {
  const createdMs = extractTimestampMs(raw.createdAt) ?? Date.now();
  const publishMs = extractTimestampMs(raw.publishAt) ?? createdMs;
  const updatedMs = extractTimestampMs(raw.updatedAt) ?? publishMs;

  const buyPrice = normalizePrice(raw.buyPrice);
  const listPrice = Math.max(buyPrice, normalizePrice(raw.listPrice));
  const syllabus = normalizeMocktestTitles(raw.MocktestTitles);
  const totalMocktest = Math.max(
    syllabus.length,
    normalizePrice(raw.totalMocktest)
  );

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : docId,
    collectionName: 'ExamPackDocument',
    title: typeof raw.title === 'string' ? raw.title.trim() : 'Untitled Exam Pack',
    urlSlug: typeof raw.urlSlug === 'string' ? raw.urlSlug.trim() : docId,
    seoDescription: normalizeProse(raw.seoDescription),
    fullDescription: normalizeProse(raw.fullDescription),
    type: typeof raw.type === 'string' && raw.type.trim() ? raw.type.trim() : 'Exam',
    language:
      typeof raw.language === 'string' && raw.language.trim()
        ? raw.language.trim()
        : 'English',
    publisher:
      typeof raw.publisher === 'string' && raw.publisher.trim()
        ? raw.publisher.trim()
        : 'ExamDash',
    authorName:
      typeof raw.authorName === 'string' && raw.authorName.trim()
        ? raw.authorName.trim()
        : 'ExamDash Faculty',
    tags: normalizeTags(raw.tags),
    currency:
      typeof raw.currency === 'string' && raw.currency.trim()
        ? raw.currency.trim().toUpperCase()
        : 'INR',
    listPrice,
    buyPrice,
    publishAtIso: new Date(publishMs).toISOString(),
    updatedAtIso: new Date(updatedMs).toISOString(),
    createdAtIso: new Date(createdMs).toISOString(),
    totalMocktest,
    MocktestTitles: syllabus,
    sampleJsonStoragePath:
      typeof raw.sampleJsonStoragePath === 'string'
        ? raw.sampleJsonStoragePath.trim()
        : '',
    hasFullJson:
      raw.hasFullJson === true ||
      (typeof raw.fullJsonStoragePath === 'string' &&
        raw.fullJsonStoragePath.trim().length > 0),
  };
}
