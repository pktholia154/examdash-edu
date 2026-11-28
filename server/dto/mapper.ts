import type {
  CategoryChipDTO,
  ImageMetaDTO,
  MocktestTitleItem,
  PublicBookDTO,
  PublicCategoryDTO,
  PublicExamDTO,
} from '../../lib/types/catalog';

interface TimestampLike {
  toMillis?: () => number;
  seconds?: number;
  nanoseconds?: number;
}

const MAX_SAFE_DATE_MS = 8_640_000_000_000_000; // ECMAScript Date limit
const MAX_PLAUSIBLE_EPOCH_MS = 100_000_000_000_000; // Year 5138 ceiling separating ms from us/ns
const MIN_PLAUSIBLE_EPOCH_MS = 946_684_800_000; // 2000-01-01T00:00:00Z
const DEFAULT_FALLBACK_EPOCH_MS = 1_704_067_200_000; // 2024-01-01T00:00:00Z

function normalizeEpochUnits(msOrSec: number): number | null {
  if (!Number.isFinite(msOrSec) || msOrSec <= 0) return null;
  // Auto-convert 10-digit Unix seconds (e.g. 1700000000) to milliseconds
  let normalized =
    msOrSec >= 946_684_800 && msOrSec < 100_000_000_000
      ? Math.floor(msOrSec * 1000)
      : Math.floor(msOrSec);

  // Scale accidental microsecond (~1.7e15) or nanosecond (~1.7e18) timestamps to milliseconds
  if (normalized > MAX_PLAUSIBLE_EPOCH_MS) {
    if (normalized < MAX_PLAUSIBLE_EPOCH_MS * 1000) {
      normalized = Math.floor(normalized / 1000);
    } else if (normalized < MAX_PLAUSIBLE_EPOCH_MS * 1_000_000) {
      normalized = Math.floor(normalized / 1_000_000);
    } else {
      return null;
    }
  }

  return normalized <= MAX_SAFE_DATE_MS ? normalized : null;
}

export function safeTimestampToIso(
  ms: number | null | undefined,
  fallbackMs: number = DEFAULT_FALLBACK_EPOCH_MS
): string {
  const safeFallback =
    Number.isFinite(fallbackMs) &&
    fallbackMs >= 0 &&
    fallbackMs <= MAX_SAFE_DATE_MS
      ? fallbackMs
      : DEFAULT_FALLBACK_EPOCH_MS;

  const candidate =
    typeof ms === 'number' &&
    Number.isFinite(ms) &&
    ms >= MIN_PLAUSIBLE_EPOCH_MS &&
    ms <= MAX_SAFE_DATE_MS
      ? ms
      : safeFallback;

  try {
    return new Date(candidate).toISOString();
  } catch {
    return '2024-01-01T00:00:00.000Z';
  }
}

export function extractTimestampMs(val: unknown): number | null {
  if (!val) return null;
  if (typeof val === 'object') {
    const ts = val as TimestampLike;
    if (typeof ts.toMillis === 'function') {
      try {
        return normalizeEpochUnits(ts.toMillis());
      } catch {
        return null;
      }
    }
    if (typeof ts.seconds === 'number' && Number.isFinite(ts.seconds)) {
      const nanos =
        typeof ts.nanoseconds === 'number' && Number.isFinite(ts.nanoseconds)
          ? ts.nanoseconds
          : 0;
      return normalizeEpochUnits(
        ts.seconds * 1000 + Math.floor(nanos / 1_000_000)
      );
    }
  }
  if (typeof val === 'number') {
    return normalizeEpochUnits(val);
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    if (/^\d{10,19}$/.test(trimmed)) {
      if (trimmed.length >= 18) {
        return normalizeEpochUnits(Number(BigInt(trimmed) / BigInt(1_000_000)));
      }
      if (trimmed.length >= 15) {
        return normalizeEpochUnits(Number(BigInt(trimmed) / BigInt(1_000)));
      }
      return normalizeEpochUnits(Number(trimmed));
    }
    const parsed = new Date(trimmed).getTime();
    return normalizeEpochUnits(parsed);
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
  rawInput: Record<string, unknown>
): PublicBookDTO {
  const raw =
    rawInput && typeof rawInput === 'object' ? rawInput : ({} as Record<string, unknown>);
  const safeDocId = (docId || 'book').trim() || 'book';
  const nowMs = Date.now();
  const createdMs = extractTimestampMs(raw.createdAt) ?? nowMs;
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

  const rawCurrency =
    typeof raw.currency === 'string' ? raw.currency.trim().toUpperCase() : '';
  const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : 'INR';
  const rawSlug = typeof raw.urlSlug === 'string' ? raw.urlSlug.trim() : '';

  const rawCategory =
    typeof raw.category === 'string' && raw.category.trim()
      ? raw.category.trim()
      : undefined;
  const rawCategorySlugCandidate =
    typeof raw.categorySlug === 'string' && raw.categorySlug.trim()
      ? raw.categorySlug.trim()
      : rawCategory;
  const normalizedCategorySlug = rawCategorySlugCandidate
    ? normalizeCategorySlugValue(rawCategorySlugCandidate, '')
    : undefined;

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : safeDocId,
    collectionName: 'books',
    title,
    urlSlug: rawSlug || safeDocId,
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
    currency,
    listPrice,
    buyPrice,
    publishAtIso: safeTimestampToIso(publishMs, nowMs),
    updatedAtIso: safeTimestampToIso(updatedMs, publishMs),
    createdAtIso: safeTimestampToIso(createdMs, nowMs),
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
    ...(rawCategory ? { category: rawCategory } : {}),
    ...(normalizedCategorySlug ? { categorySlug: normalizedCategorySlug } : {}),
    ...(soldCount !== undefined ? { soldCount } : {}),
    ...(isBestseller ? { isBestseller: true } : {}),
  };
}

export function normalizeCategorySlugValue(
  rawSlug: unknown,
  fallbackIdOrTitle: string
): string {
  const candidate = typeof rawSlug === 'string' ? rawSlug.trim() : '';
  const source = candidate || fallbackIdOrTitle || 'category';
  const cleaned = source
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160)
    .replace(/-+$/g, '');
  return cleaned || 'general';
}

/**
 * Maps raw Firestore `category` document to slim `CategoryChipDTO` (never includes `fullDescription`).
 */
export function mapCategoryToChipDTO(
  docId: string,
  rawInput: Record<string, unknown>,
  liveBookCount: number = 0
): CategoryChipDTO {
  const raw =
    rawInput && typeof rawInput === 'object'
      ? rawInput
      : ({} as Record<string, unknown>);
  const safeDocId = (docId || 'category').trim() || 'category';
  const id =
    typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : safeDocId;
  const title =
    typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : id;
  const slug = normalizeCategorySlugValue(raw.slug ?? raw.urlSlug, title || id);

  const nowMs = Date.now();
  const createdMs = extractTimestampMs(raw.createdAt) ?? nowMs;
  const updatedMs = extractTimestampMs(raw.updatedAt) ?? createdMs;

  const metaDescription = normalizeProse(
    typeof raw.metaDescription === 'string' && raw.metaDescription.trim()
      ? raw.metaDescription
      : typeof raw.seoDescription === 'string'
      ? raw.seoDescription
      : ''
  );

  return {
    id,
    slug,
    title,
    metaDescription:
      metaDescription ||
      `Browse verified ${title} exam preparation books, solved papers, and question banks with free sample previews on ExamDash.`,
    updatedAtIso: safeTimestampToIso(updatedMs, createdMs),
    createdAtIso: safeTimestampToIso(createdMs, nowMs),
    liveBookCount: Math.max(0, Math.floor(liveBookCount)),
  };
}

/**
 * Maps raw Firestore `category` document to `PublicCategoryDTO` (`fullDescription` populated only when projected).
 */
export function mapCategoryToPublicDTO(
  docId: string,
  rawInput: Record<string, unknown>,
  liveBookCount: number = 0
): PublicCategoryDTO {
  const chip = mapCategoryToChipDTO(docId, rawInput, liveBookCount);
  const raw =
    rawInput && typeof rawInput === 'object'
      ? rawInput
      : ({} as Record<string, unknown>);
  return {
    ...chip,
    fullDescription: normalizeProse(raw.fullDescription),
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
  rawInput: Record<string, unknown>
): PublicExamDTO {
  const raw =
    rawInput && typeof rawInput === 'object' ? rawInput : ({} as Record<string, unknown>);
  const safeDocId = (docId || 'exam').trim() || 'exam';
  const nowMs = Date.now();
  const createdMs = extractTimestampMs(raw.createdAt) ?? nowMs;
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

  const rawCurrency =
    typeof raw.currency === 'string' ? raw.currency.trim().toUpperCase() : '';
  const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : 'INR';
  const rawSlug = typeof raw.urlSlug === 'string' ? raw.urlSlug.trim() : '';

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : safeDocId,
    collectionName: 'ExamPackDocument',
    title,
    urlSlug: rawSlug || safeDocId,
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
    currency,
    listPrice,
    buyPrice,
    publishAtIso: safeTimestampToIso(publishMs, nowMs),
    updatedAtIso: safeTimestampToIso(updatedMs, publishMs),
    createdAtIso: safeTimestampToIso(createdMs, nowMs),
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
