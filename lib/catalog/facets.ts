import type {
  BookAvailableFacets,
  BookFacetFilters,
  BookPriceBucket,
  CategoryChipDTO,
  SortOption,
} from '../types/catalog';
import { getDefaultCatalogPricing } from '../validity/pricing';

export const CATEGORY_HUB_PAGE_SIZE = 15;
export const BOOKS_HUB_PAGE_SIZE = 15;
export const INITIAL_VISIBLE_CATEGORY_CHIPS = 8;

export const BOOK_PRICE_BUCKETS: ReadonlyArray<{
  value: BookPriceBucket;
  label: string;
}> = [
  { value: 'all', label: 'All Prices' },
  { value: 'free', label: 'Free' },
  { value: 'under-150', label: 'Under ₹150' },
  { value: '150-300', label: '₹150 – ₹300' },
  { value: 'above-300', label: 'Above ₹300' },
];

export const BOOK_SORT_OPTIONS: ReadonlyArray<{
  value: SortOption;
  label: string;
}> = [
  { value: 'publishAt_desc', label: 'Newest First' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'publishAt_asc', label: 'Oldest First' },
];

const VALID_PRICE_BUCKETS = new Set<BookPriceBucket>([
  'all',
  'free',
  'under-150',
  '150-300',
  'above-300',
]);

const VALID_SORT_OPTIONS = new Set<SortOption>([
  'publishAt_desc',
  'publishAt_asc',
  'price_asc',
  'price_desc',
]);

export type StrictPageParamParseResult =
  | { kind: 'ok'; page: number }
  | { kind: 'redirect_page_1' }
  | { kind: 'invalid' };

/**
 * Strictly validates `?page=` query parameters for GSC-compliant hub pagination:
 * - Missing `page`: `{ kind: 'ok', page: 1 }`
 * - Explicit `?page=1`: `{ kind: 'redirect_page_1' }` (handled via single-hop 301)
 * - Positive integer `>= 2` (up to `5000`): `{ kind: 'ok', page: N }`
 * - Non-numeric, zero, negative, decimal, or array duplicates: `{ kind: 'invalid' }` (404)
 */
export function parseStrictPageParam(
  rawPage: string | string[] | undefined | null
): StrictPageParamParseResult {
  if (rawPage === undefined || rawPage === null) {
    return { kind: 'ok', page: 1 };
  }
  if (Array.isArray(rawPage)) {
    if (rawPage.length !== 1) return { kind: 'invalid' };
    return parseStrictPageParam(rawPage[0]);
  }
  const trimmed = rawPage.trim();
  if (!trimmed) return { kind: 'invalid' };
  if (!/^\d+$/.test(trimmed)) return { kind: 'invalid' };
  // Reject leading zeroes like `01` or `02`
  if (trimmed.length > 1 && trimmed.startsWith('0')) {
    return { kind: 'invalid' };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 5000) {
    return { kind: 'invalid' };
  }
  if (parsed === 1) {
    return { kind: 'redirect_page_1' };
  }
  return { kind: 'ok', page: parsed };
}

function firstParamValue(
  val: string | string[] | undefined
): string | undefined {
  if (Array.isArray(val)) return val[0];
  return val;
}

function sanitizeFacetToken(raw: string | undefined, maxLen = 64): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') return undefined;
  return trimmed.slice(0, maxLen);
}

/**
 * Parses URL search parameters into normalized `BookFacetFilters`.
 */
export function parseBookFacetParams(
  params:
    | URLSearchParams
    | Record<string, string | string[] | undefined>
    | null
    | undefined
): BookFacetFilters {
  if (!params) return {};

  const read = (key: string): string | undefined => {
    if (params instanceof URLSearchParams) {
      return params.get(key) ?? undefined;
    }
    return firstParamValue(params[key]);
  };

  const type = sanitizeFacetToken(read('type'), 64);
  const language = sanitizeFacetToken(read('language') ?? read('lang'), 64);

  const rawPrice = (read('price') || '').trim().toLowerCase() as BookPriceBucket;
  const price =
    rawPrice && rawPrice !== 'all' && VALID_PRICE_BUCKETS.has(rawPrice)
      ? rawPrice
      : undefined;

  const rawSort = (read('sort') || '').trim() as SortOption;
  const sort =
    rawSort && rawSort !== 'publishAt_desc' && VALID_SORT_OPTIONS.has(rawSort)
      ? rawSort
      : undefined;

  return {
    ...(type ? { type } : {}),
    ...(language ? { language } : {}),
    ...(price ? { price } : {}),
    ...(sort ? { sort } : {}),
  };
}

/**
 * Returns true if any facet filter (`type`, `language`, `price`) or non-default `sort` is active.
 */
export function hasActiveBookFacets(filters: BookFacetFilters | undefined | null): boolean {
  if (!filters) return false;
  return Boolean(
    filters.type ||
      filters.language ||
      (filters.price && filters.price !== 'all') ||
      (filters.sort && filters.sort !== 'publishAt_desc')
  );
}

/**
 * Evaluates a book's effective displayed price (`getDefaultCatalogPricing('books', buyPrice).discountedPrice`)
 * against a `BookPriceBucket` so card price badges and price filter labels match 1:1.
 */
export function getEffectiveBookPayablePrice(baseBuyPrice: number): number {
  return getDefaultCatalogPricing('books', baseBuyPrice).discountedPrice;
}

export function classifyBookPriceBucket(
  baseBuyPrice: number
): Exclude<BookPriceBucket, 'all'> {
  const effective = getEffectiveBookPayablePrice(baseBuyPrice);
  if (effective <= 0) return 'free';
  if (effective <= 150) return 'under-150';
  if (effective <= 300) return '150-300';
  return 'above-300';
}

export function matchesBookPriceBucket(
  baseBuyPrice: number,
  bucket: BookPriceBucket | undefined
): boolean {
  if (!bucket || bucket === 'all') return true;
  return classifyBookPriceBucket(baseBuyPrice) === bucket;
}

/**
 * Derives available facet options (`types`, `languages`, `priceBuckets`) from a set of book manifest rows.
 */
export function deriveAvailableBookFacets(
  rows: ReadonlyArray<{ type: string; language: string; buyPrice: number }>
): BookAvailableFacets {
  const typeSet = new Set<string>();
  const langSet = new Set<string>();
  const bucketSet = new Set<Exclude<BookPriceBucket, 'all'>>();

  for (const row of rows) {
    if (row.type && row.type.trim()) {
      typeSet.add(row.type.trim());
    }
    if (row.language && row.language.trim()) {
      langSet.add(row.language.trim());
    }
    bucketSet.add(classifyBookPriceBucket(row.buyPrice));
  }

  const orderedBuckets: BookPriceBucket[] = (
    ['free', 'under-150', '150-300', 'above-300'] as const
  ).filter((b) => bucketSet.has(b));

  return {
    types: Array.from(typeSet).sort((a, b) => a.localeCompare(b)),
    languages: Array.from(langSet).sort((a, b) => a.localeCompare(b)),
    priceBuckets: orderedBuckets,
  };
}

/**
 * Builds a deterministic, minimal query string for client-side URL syncing (`<button>` / `<select>`),
 * omitting default values and `?page=1`.
 */
export function buildBookFacetQueryString(
  filters: BookFacetFilters,
  pageNum: number = 1
): string {
  const qs = new URLSearchParams();
  if (filters.type) qs.set('type', filters.type);
  if (filters.language) qs.set('language', filters.language);
  if (filters.price && filters.price !== 'all') qs.set('price', filters.price);
  if (filters.sort && filters.sort !== 'publishAt_desc') {
    qs.set('sort', filters.sort);
  }
  if (pageNum > 1) {
    qs.set('page', String(pageNum));
  }
  const str = qs.toString();
  return str ? `?${str}` : '';
}

/**
 * Computes initial vs overflow category chips while ensuring 100% of categories remain
 * rendered in the server HTML DOM so search crawlers index every category hub link.
 */
export function partitionCategoryChipsForDisplay(
  categories: readonly CategoryChipDTO[],
  initialLimit: number = INITIAL_VISIBLE_CATEGORY_CHIPS
): {
  primary: CategoryChipDTO[];
  overflow: CategoryChipDTO[];
  hasOverflow: boolean;
  overflowCount: number;
} {
  const safeLimit = Math.max(1, Math.floor(initialLimit));
  const primary = categories.slice(0, safeLimit);
  const overflow = categories.slice(safeLimit);
  return {
    primary,
    overflow,
    hasOverflow: overflow.length > 0,
    overflowCount: overflow.length,
  };
}

/**
 * Deterministic Firestore read-unit estimator for Category Hub page states (used for FinOps verification & tests):
 * - CDN / Next.js `unstable_cache` warm hit: 0 reads
 * - Cold unfiltered Page 1 (`N` items, `<= 15`): 1 category doc (`.select()` w/ `fullDescription`) + 1 aggregation `.count()` (1 read per <=1000 index entries) + `N` card docs + review summary = `2 + N` catalog reads
 * - Cold unfiltered Page 2+ (warm cursor manifest): 1 category doc (`.select()` WITHOUT `fullDescription`) + `N` card docs = `1 + N` catalog reads
 * - Cold filtered state (warm cursor manifest): 1 category doc (`.select()` WITHOUT `fullDescription`) + `N` matching card docs = `1 + N` catalog reads
 * - Missing / `isDeleted` category slug: 1 read
 */
export function estimateCategoryHubCatalogReads(params: {
  cacheHit: boolean;
  categoryFound: boolean;
  manifestWarm: boolean;
  totalCategoryDocs: number;
  returnedPageItems: number;
}): number {
  if (params.cacheHit) return 0;
  if (!params.categoryFound) return 1;

  const categoryRead = 1;
  const countAggregationReads = params.manifestWarm
    ? 0
    : Math.max(1, Math.ceil(Math.max(1, params.totalCategoryDocs) / 1000));
  const manifestReads = params.manifestWarm
    ? 0
    : Math.max(1, params.totalCategoryDocs);
  const cardReads = Math.max(0, params.returnedPageItems);

  // When manifest is cold and <= 15 total items exist, card projection and manifest share the cursor batch
  if (!params.manifestWarm && params.totalCategoryDocs <= CATEGORY_HUB_PAGE_SIZE) {
    return categoryRead + countAggregationReads + Math.max(1, params.returnedPageItems);
  }

  return categoryRead + countAggregationReads + manifestReads + cardReads;
}
