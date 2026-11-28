import { unstable_cache } from 'next/cache';
import type {
  BookAvailableFacets,
  BookFacetFilters,
  CategoryChipDTO,
  CollectionName,
  ItemReviewSummaryDTO,
  PublicBookDTO,
  PublicCategoryDTO,
  PublicExamDTO,
  ReviewAggregateBadge,
} from '../../lib/types/catalog';
import { buildBookFacetQueryString } from '../../lib/catalog/facets';
import {
  getBookBySlug,
  getCategoryBooksHubPage,
  getCategoryBySlug,
  getExamBySlug,
  getFilteredBooksCatalogPage,
  getLiveBooksExactCount,
  getLiveBooksPage,
  getLiveCategoryChips,
  getLiveCollectionCount,
  getLiveExamsPage,
  getSitemapCatalogEntries,
  getSitemapCategoryEntries,
  type CatalogPageResult,
  type CategoryBooksHubPageResult,
  type SitemapCatalogEntry,
  type SitemapCategoryEntry,
  type SlugLookupResult,
} from '../repositories/catalog-repository';
import {
  getItemReviewsSummary,
  getPublishedReviewAggregates,
} from '../repositories/review-repository';

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Bounded ISR Data Cache TTLs (60s) paired with event-driven `revalidatePath()` and `revalidateTag()`
 * in publishing and review routes. Direct Firebase additions, updates, and deletions automatically
 * synchronize within <= 60s without manual webhook calls, while minimizing Firestore read costs.
 */
const CATALOG_REVALIDATE_SECONDS = 60;
const SITEMAP_REVALIDATE_SECONDS = 60;

const cachedLiveBooksPageProd = unstable_cache(
  async (limit: number, offset: number): Promise<CatalogPageResult<PublicBookDTO>> =>
    getLiveBooksPage({ limit, offset }),
  ['ed-live-books-page-v2'],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: ['catalog', 'books'] }
);

const cachedLiveExamsPageProd = unstable_cache(
  async (limit: number, offset: number): Promise<CatalogPageResult<PublicExamDTO>> =>
    getLiveExamsPage({ limit, offset }),
  ['ed-live-exams-page-v2'],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: ['catalog', 'exams'] }
);

const cachedCollectionCountProd = unstable_cache(
  async (collectionName: CollectionName): Promise<number | null> =>
    collectionName === 'books'
      ? getLiveBooksExactCount()
      : getLiveCollectionCount(collectionName),
  ['ed-collection-count-v2'],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: ['catalog', 'books', 'exams'] }
);

const cachedSitemapEntriesProd = unstable_cache(
  async (collectionName: CollectionName): Promise<SitemapCatalogEntry[]> =>
    getSitemapCatalogEntries(collectionName),
  ['ed-sitemap-entries-v2'],
  { revalidate: SITEMAP_REVALIDATE_SECONDS, tags: ['catalog', 'sitemaps'] }
);

const cachedLiveCategoryChipsProd = unstable_cache(
  async (): Promise<CategoryChipDTO[]> => getLiveCategoryChips(),
  ['ed-live-category-chips-v2'],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: ['catalog', 'books', 'categories'] }
);

const cachedSitemapCategoryEntriesProd = unstable_cache(
  async (): Promise<SitemapCategoryEntry[]> => getSitemapCategoryEntries(),
  ['ed-sitemap-category-entries-v2'],
  {
    revalidate: SITEMAP_REVALIDATE_SECONDS,
    tags: ['catalog', 'books', 'categories', 'sitemaps'],
  }
);

export async function getCachedLiveBooksPage(options?: {
  limit?: number;
  offset?: number;
}): Promise<CatalogPageResult<PublicBookDTO>> {
  const limit = options?.limit ?? 10;
  const offset = options?.offset ?? 0;
  if (!IS_PROD) {
    return getLiveBooksPage({ limit, offset });
  }
  return cachedLiveBooksPageProd(limit, offset);
}

export async function getCachedLiveExamsPage(options?: {
  limit?: number;
  offset?: number;
}): Promise<CatalogPageResult<PublicExamDTO>> {
  const limit = options?.limit ?? 10;
  const offset = options?.offset ?? 0;
  if (!IS_PROD) {
    return getLiveExamsPage({ limit, offset });
  }
  return cachedLiveExamsPageProd(limit, offset);
}

export async function getCachedLiveCollectionCount(
  collectionName: CollectionName
): Promise<number | null> {
  if (!IS_PROD) {
    return collectionName === 'books'
      ? getLiveBooksExactCount()
      : getLiveCollectionCount(collectionName);
  }
  return cachedCollectionCountProd(collectionName);
}

export async function getCachedLiveCategoryChips(): Promise<CategoryChipDTO[]> {
  if (!IS_PROD) {
    return getLiveCategoryChips();
  }
  return cachedLiveCategoryChipsProd();
}

export async function getCachedSitemapCategoryEntries(): Promise<
  SitemapCategoryEntry[]
> {
  if (!IS_PROD) {
    return getSitemapCategoryEntries();
  }
  return cachedSitemapCategoryEntriesProd();
}

export async function getCachedCategoryBySlug(
  slug: string,
  options?: { includeFullDescription?: boolean }
): Promise<SlugLookupResult<PublicCategoryDTO>> {
  const cleanSlug = (slug || '').trim().toLowerCase();
  const includeFull = options?.includeFullDescription !== false;
  if (!cleanSlug || !IS_PROD) {
    return getCategoryBySlug(slug, { includeFullDescription: includeFull });
  }
  const fn = unstable_cache(
    async () => getCategoryBySlug(cleanSlug, { includeFullDescription: includeFull }),
    ['ed-category-by-slug-v2', cleanSlug, includeFull ? 'full' : 'slim'],
    {
      revalidate: CATALOG_REVALIDATE_SECONDS,
      tags: ['catalog', 'categories', `category:${cleanSlug}`],
    }
  );
  return fn();
}

export async function getCachedCategoryBooksHubPage(params: {
  categorySlug: string;
  page: number;
  pageSize?: number;
  filters?: BookFacetFilters;
}): Promise<CategoryBooksHubPageResult> {
  const cleanSlug = (params.categorySlug || '').trim().toLowerCase();
  const pageSize = params.pageSize ?? 15;
  const filterKey = buildBookFacetQueryString(params.filters ?? {}, params.page);

  if (!cleanSlug || !IS_PROD) {
    return getCategoryBooksHubPage({
      categorySlug: cleanSlug,
      page: params.page,
      pageSize,
      filters: params.filters,
    });
  }

  const fn = unstable_cache(
    async () =>
      getCategoryBooksHubPage({
        categorySlug: cleanSlug,
        page: params.page,
        pageSize,
        filters: params.filters,
      }),
    ['ed-category-books-hub-v2', cleanSlug, String(pageSize), filterKey],
    {
      revalidate: CATALOG_REVALIDATE_SECONDS,
      tags: ['catalog', 'books', 'categories', `category:${cleanSlug}`],
    }
  );
  return fn();
}

export async function getCachedFilteredBooksCatalogPage(params: {
  page: number;
  pageSize?: number;
  filters?: BookFacetFilters;
}): Promise<{
  items: PublicBookDTO[];
  totalCount: number;
  unfilteredTotalCount: number;
  hasMore: boolean;
  facets: BookAvailableFacets;
}> {
  const pageSize = params.pageSize ?? 15;
  const filterKey = buildBookFacetQueryString(params.filters ?? {}, params.page);

  if (!IS_PROD) {
    return getFilteredBooksCatalogPage({
      page: params.page,
      pageSize,
      filters: params.filters,
    });
  }

  const fn = unstable_cache(
    async () =>
      getFilteredBooksCatalogPage({
        page: params.page,
        pageSize,
        filters: params.filters,
      }),
    ['ed-filtered-books-hub-v2', String(pageSize), filterKey],
    {
      revalidate: CATALOG_REVALIDATE_SECONDS,
      tags: ['catalog', 'books'],
    }
  );
  return fn();
}

export async function getCachedBookBySlug(
  urlSlug: string
): Promise<SlugLookupResult<PublicBookDTO>> {
  const cleanSlug = (urlSlug || '').trim();
  if (!cleanSlug || !IS_PROD) {
    return getBookBySlug(cleanSlug);
  }
  const fn = unstable_cache(
    async () => getBookBySlug(cleanSlug),
    ['ed-book-by-slug-v2', cleanSlug],
    {
      revalidate: CATALOG_REVALIDATE_SECONDS,
      tags: ['catalog', 'books', `book:${cleanSlug}`],
    }
  );
  return fn();
}

export async function getCachedExamBySlug(
  urlSlug: string
): Promise<SlugLookupResult<PublicExamDTO>> {
  const cleanSlug = (urlSlug || '').trim();
  if (!cleanSlug || !IS_PROD) {
    return getExamBySlug(cleanSlug);
  }
  const fn = unstable_cache(
    async () => getExamBySlug(cleanSlug),
    ['ed-exam-by-slug-v2', cleanSlug],
    {
      revalidate: CATALOG_REVALIDATE_SECONDS,
      tags: ['catalog', 'exams', `exam:${cleanSlug}`],
    }
  );
  return fn();
}

export async function getCachedSitemapCatalogEntries(
  collectionName: CollectionName
): Promise<SitemapCatalogEntry[]> {
  if (!IS_PROD) {
    return getSitemapCatalogEntries(collectionName);
  }
  return cachedSitemapEntriesProd(collectionName);
}

export async function getCachedItemReviewsSummary(
  collectionName: CollectionName,
  itemId: string
): Promise<ItemReviewSummaryDTO> {
  const cleanId = (itemId || '').trim();
  if (!cleanId || !IS_PROD) {
    return getItemReviewsSummary(collectionName, cleanId);
  }
  const fn = unstable_cache(
    async () => getItemReviewsSummary(collectionName, cleanId),
    ['ed-item-reviews-v2', collectionName, cleanId],
    {
      revalidate: CATALOG_REVALIDATE_SECONDS,
      tags: ['reviews', `reviews:${collectionName}:${cleanId}`],
    }
  );
  return fn();
}

export async function getCachedPublishedReviewAggregates(
  targetKeys: string[]
): Promise<Map<string, ReviewAggregateBadge>> {
  if (targetKeys.length === 0) {
    return new Map();
  }
  if (!IS_PROD) {
    return getPublishedReviewAggregates(targetKeys);
  }
  const sortedKeys = [...new Set(targetKeys)].sort();
  const cacheKey = sortedKeys.join(',');
  const fn = unstable_cache(
    async (): Promise<Record<string, ReviewAggregateBadge>> => {
      const map = await getPublishedReviewAggregates(sortedKeys);
      return Object.fromEntries(map.entries());
    },
    ['ed-review-aggregates-v2', cacheKey],
    { revalidate: CATALOG_REVALIDATE_SECONDS, tags: ['reviews', 'catalog'] }
  );
  const record = await fn();
  return new Map(Object.entries(record));
}
