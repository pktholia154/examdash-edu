import type {
  ImageMetaDTO,
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

const IMAGE_META_KEYS = new Set<keyof ImageMetaDTO>([
  'alt',
  'slug',
  'title',
  'caption',
  'description',
  'filename',
  'keywords',
]);

/**
 * Parses Firestore `imageMeta` stored either as:
 * 1) an array of `"key: value"` strings (e.g. `["alt: ...", "caption: ...", "title: ..."]`), or
 * 2) a plain map object `{ alt, slug, title, caption, description, filename, keywords }`.
 */
export function parseImageMeta(raw: unknown): ImageMetaDTO | undefined {
  if (!raw) return undefined;

  const out: ImageMetaDTO = {};

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'string') continue;
      const colonIdx = entry.indexOf(':');
      if (colonIdx <= 0) continue;
      const key = entry.slice(0, colonIdx).trim().toLowerCase() as keyof ImageMetaDTO;
      const value = entry.slice(colonIdx + 1).trim();
      if (value && IMAGE_META_KEYS.has(key)) {
        out[key] = value;
      }
    }
  } else if (typeof raw === 'object') {
    for (const [rawKey, rawVal] of Object.entries(raw as Record<string, unknown>)) {
      const key = rawKey.trim().toLowerCase() as keyof ImageMetaDTO;
      if (!IMAGE_META_KEYS.has(key)) continue;
      if (typeof rawVal === 'string' && rawVal.trim()) {
        out[key] = rawVal.trim();
      } else if (Array.isArray(rawVal) && key === 'keywords') {
        const joined = rawVal
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .map((v) => v.trim())
          .join(', ');
        if (joined) out.keywords = joined;
      }
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

const DEFAULT_STORAGE_BUCKET =
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ||
  'examdash-ed.firebasestorage.app';

/**
 * Resolves thumbnail image URL from Firestore `imageUrl` (preferred) with fallback to `bookCover`.
 * Supports full HTTPS URLs as well as `gs://bucket/path` or relative Firebase Storage paths.
 */
export function normalizeImageUrl(
  rawPrimary: unknown,
  rawFallback?: unknown
): string {
  const candidates = [rawPrimary, rawFallback];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;

    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          return parsed.toString();
        }
      } catch {
        continue;
      }
    }

    if (trimmed.startsWith('gs://')) {
      const withoutScheme = trimmed.slice(5);
      const slashIdx = withoutScheme.indexOf('/');
      if (slashIdx > 0 && slashIdx < withoutScheme.length - 1) {
        const bucket = withoutScheme.slice(0, slashIdx);
        const objectPath = withoutScheme.slice(slashIdx + 1);
        return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
          bucket
        )}/o/${encodeURIComponent(objectPath)}?alt=media`;
      }
      continue;
    }

    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
      return trimmed;
    }

    // Relative Firebase Storage object path (e.g. `public/covers/B3.png`)
    if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      const cleanPath = trimmed.replace(/^\/+/, '');
      if (cleanPath) {
        return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
          DEFAULT_STORAGE_BUCKET
        )}/o/${encodeURIComponent(cleanPath)}?alt=media`;
      }
    }
  }

  return '';
}

export function normalizeBookChapters(rawChapters: unknown): string[] {
  if (!Array.isArray(rawChapters)) return [];
  const chapters: string[] = [];
  for (const entry of rawChapters) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) chapters.push(trimmed);
    } else if (entry && typeof entry === 'object' && 'title' in entry) {
      const title = (entry as { title?: unknown }).title;
      if (typeof title === 'string' && title.trim()) {
        chapters.push(title.trim());
      }
    }
    if (chapters.length >= 250) break;
  }
  return chapters;
}

/**
 * GSC Merchant Hygiene: Never allow standalone "Free" in `title` when `buyPrice > 0`
 * so Google never flags misleading Offer pricing against Product titles.
 */
export function sanitizePaidTitle(rawTitle: string, buyPrice: number, fallback: string): string {
  const base = rawTitle.trim() || fallback;
  if (buyPrice <= 0) return base;

  const cleaned = base
    .replace(/\(\s*[^)]*\bfree\b[^)]*\)/gi, '')
    .replace(/\[\s*[^\]]*\bfree\b[^\]]*\]/gi, '')
    .replace(/\b(?<!ad-|error-|distraction-|royalty-|tax-|hassle-)free\b/gi, '')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\(\s*\)/g, '')
    .replace(/\s*[-–—|:]\s*$/g, '')
    .replace(/^\s*[-–—|:]\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleaned || fallback;
}

/**
 * GSC Merchant Hygiene: Strip misleading "Free" tags when `buyPrice > 0`.
 */
export function sanitizePaidTags(tags: string[], buyPrice: number): string[] {
  if (buyPrice <= 0) return tags;
  return tags.filter(
    (tag) => !/\b(?<!ad-|error-|distraction-)free\b/i.test(tag)
  );
}

/**
 * GSC Merchant Hygiene: Normalize paid descriptions so standalone "Free" claims
 * become accurate "Includes Free Sample" phrasing when sample files exist.
 */
export function sanitizePaidDescription(
  rawDesc: string,
  buyPrice: number,
  hasSample: boolean
): string {
  const trimmed = rawDesc.trim();
  if (buyPrice <= 0 || !trimmed) return trimmed;

  // Replace misleading phrases like "100% free", "free download", "(Free Sample Book)", or standalone "free"
  let normalized = trimmed
    .replace(
      /\(\s*free\s+sample(?:\s+(?:book|ebook|edition|pack|pdf))?\s*\)/gi,
      hasSample ? '(Includes Free Sample)' : ''
    )
    .replace(/\b(?:100%\s+free|free\s+download|download\s+for\s+free|completely\s+free)\b/gi, hasSample ? 'Includes Free Sample' : 'Instant digital access')
    .replace(
      /\b(?<!ad-|error-|distraction-|royalty-|tax-|hassle-|includes\s+)free\b(?!\s+(?:sample|preview|trial|chapter|mock|extract))/gi,
      hasSample ? 'Includes Free Sample' : 'Verified'
    )
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (hasSample && !/free\s+(?:sample|preview|trial)/i.test(normalized) && normalized.length <= 130) {
    normalized = `${normalized.replace(/\.*$/, '')}. Includes Free Sample.`;
  }

  return normalized;
}

function sanitizePaidFullProse(
  rawProse: string,
  buyPrice: number,
  hasSample: boolean
): string {
  const prose = normalizeProse(rawProse);
  if (buyPrice <= 0 || !prose) return prose;

  return prose
    .replace(
      /\(\s*free\s+sample(?:\s+(?:book|ebook|edition|pack|pdf))?\s*\)/gi,
      hasSample ? '(Includes Free Sample)' : ''
    )
    .replace(
      /\bthis\s+free\s+sample\s+edition\b/gi,
      hasSample ? 'this digital edition (with free sample preview)' : 'this digital edition'
    );
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
  const samplePdfUrl =
    typeof raw.samplePdfUrl === 'string' ? raw.samplePdfUrl.trim() : '';
  const sampleMarkdownUrl =
    typeof raw.sampleMarkdownUrl === 'string' ? raw.sampleMarkdownUrl.trim() : '';
  const hasSample = Boolean(samplePdfUrl || sampleMarkdownUrl);

  const rawTitle = typeof raw.title === 'string' ? raw.title : '';
  const title = sanitizePaidTitle(rawTitle, buyPrice, 'Untitled Book');
  const tags = sanitizePaidTags(normalizeTags(raw.tags), buyPrice);
  const seoDescription = sanitizePaidDescription(
    normalizeProse(raw.seoDescription),
    buyPrice,
    hasSample
  );

  const rawSold =
    raw.soldCount ?? raw.salesCount ?? raw.purchaseCount;
  const parsedSold =
    typeof rawSold === 'number' ? rawSold : Number(rawSold);
  const soldCount =
    Number.isFinite(parsedSold) && parsedSold > 0
      ? Math.floor(parsedSold)
      : undefined;
  const isBestseller =
    raw.isBestseller === true || raw.bestseller === true ? true : undefined;

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : docId,
    collectionName: 'books',
    title,
    urlSlug: typeof raw.urlSlug === 'string' ? raw.urlSlug.trim() : docId,
    seoDescription,
    fullDescription: sanitizePaidFullProse(
      typeof raw.fullDescription === 'string' ? raw.fullDescription : '',
      buyPrice,
      hasSample
    ),
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
    tags,
    currency:
      typeof raw.currency === 'string' && raw.currency.trim()
        ? raw.currency.trim().toUpperCase()
        : 'INR',
    listPrice,
    buyPrice,
    publishAtIso: new Date(publishMs).toISOString(),
    updatedAtIso: new Date(updatedMs).toISOString(),
    createdAtIso: new Date(createdMs).toISOString(),
    imageUrl: normalizeImageUrl(raw.imageUrl, raw.bookCover),
    ...(parseImageMeta(raw.imageMeta)
      ? { imageMeta: parseImageMeta(raw.imageMeta) }
      : {}),
    bookChapters: normalizeBookChapters(raw.bookChapters),
    samplePdfUrl,
    sampleMarkdownUrl,
    hasFullPdf:
      raw.hasFullPdf === true ||
      (typeof raw.fullPdfStoragePath === 'string' &&
        raw.fullPdfStoragePath.trim().length > 0),
    hasFullMarkdown:
      raw.hasFullMarkdown === true ||
      (typeof raw.fullMarkdownStoragePath === 'string' &&
        raw.fullMarkdownStoragePath.trim().length > 0),
    ...(soldCount !== undefined ? { soldCount } : {}),
    ...(isBestseller ? { isBestseller: true } : {}),
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
  const sampleJsonStoragePath =
    typeof raw.sampleJsonStoragePath === 'string'
      ? raw.sampleJsonStoragePath.trim()
      : '';
  const hasSample = Boolean(sampleJsonStoragePath);

  const rawTitle = typeof raw.title === 'string' ? raw.title : '';
  const title = sanitizePaidTitle(rawTitle, buyPrice, 'Untitled Exam Pack');
  const tags = sanitizePaidTags(normalizeTags(raw.tags), buyPrice);
  const seoDescription = sanitizePaidDescription(
    normalizeProse(raw.seoDescription),
    buyPrice,
    hasSample
  );

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : docId,
    collectionName: 'ExamPackDocument',
    title,
    urlSlug: typeof raw.urlSlug === 'string' ? raw.urlSlug.trim() : docId,
    seoDescription,
    fullDescription: sanitizePaidFullProse(
      typeof raw.fullDescription === 'string' ? raw.fullDescription : '',
      buyPrice,
      hasSample
    ),
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
    tags,
    currency:
      typeof raw.currency === 'string' && raw.currency.trim()
        ? raw.currency.trim().toUpperCase()
        : 'INR',
    listPrice,
    buyPrice,
    publishAtIso: new Date(publishMs).toISOString(),
    updatedAtIso: new Date(updatedMs).toISOString(),
    createdAtIso: new Date(createdMs).toISOString(),
    imageUrl: normalizeImageUrl(raw.imageUrl, raw.examCover),
    ...(parseImageMeta(raw.imageMeta)
      ? { imageMeta: parseImageMeta(raw.imageMeta) }
      : {}),
    totalMocktest,
    MocktestTitles: syllabus,
    sampleJsonStoragePath,
    hasFullJson:
      raw.hasFullJson === true ||
      (typeof raw.fullJsonStoragePath === 'string' &&
        raw.fullJsonStoragePath.trim().length > 0),
  };
}
