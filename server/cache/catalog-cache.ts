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
 * Infinite Next.js Data Cache (`revalidate: false`) wrappers for server-rendered public routes.
 * Paired with event-driven `revalidatePath()` and `revalidateTag()` in publishing and review routes
 * so public HTML/RSC hits avoid redundant Firestore round-trips while updating immediately on publish.
 */
const cachedLiveBooksPageProd = unstable_cache(
  async (limit: number, offset: number): Promise<CatalogPageResult<PublicBookDTO>> =>
    getLiveBooksPage({ limit, offset }),
  ['ed-live-books-page-v1'],
  { revalidate: false, tags: ['catalog', 'books'] }
);

const cachedLiveExamsPageProd = unstable_cache(
  async (limit: number, offset: number): Promise<CatalogPageResult<PublicExamDTO>> =>
    getLiveExamsPage({ limit, offset }),
  ['ed-live-exams-page-v1'],
  { revalidate: false, tags: ['catalog', 'exams'] }
);

const cachedCollectionCountProd = unstable_cache(
  async (collectionName: CollectionName): Promise<number | null> =>
    getLiveCollectionCount(collectionName),
  ['ed-collection-count-v1'],
  { revalidate: false, tags: ['catalog', 'books', 'exams'] }
);

const cachedSitemapEntriesProd = unstable_cache(
  async (collectionName: CollectionName): Promise<SitemapCatalogEntry[]> =>
    getSitemapCatalogEntries(collectionName),
  ['ed-sitemap-entries-v1'],
  { revalidate: false, tags: ['catalog', 'sitemaps'] }
);

const cachedLiveCategoryChipsProd = unstable_cache(
  async (): Promise<CategoryChipDTO[]> => getLiveCategoryChips(),
  ['ed-live-category-chips-v1'],
  { revalidate: false, tags: ['catalog', 'books', 'categories'] }
);

const cachedSitemapCategoryEntriesProd = unstable_cache(
  async (): Promise<SitemapCategoryEntry[]> => getSitemapCategoryEntries(),
  ['ed-sitemap-category-entries-v1'],
  { revalidate: false, tags: ['catalog', 'books', 'categories', 'sitemaps'] }
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
    return getLiveCollectionCount(collectionName);
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
    ['ed-category-by-slug-v1', cleanSlug, includeFull ? 'full' : 'slim'],
    {
      revalidate: false,
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
    ['ed-category-books-hub-v1', cleanSlug, String(pageSize), filterKey],
    {
      revalidate: false,
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
  const pageSize = params.pageSize ?? 20;
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
    ['ed-filtered-books-hub-v1', String(pageSize), filterKey],
    {
      revalidate: false,
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
    ['ed-book-by-slug-v1', cleanSlug],
    { revalidate: false, tags: ['catalog', 'books', `book:${cleanSlug}`] }
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
    ['ed-exam-by-slug-v1', cleanSlug],
    { revalidate: false, tags: ['catalog', 'exams', `exam:${cleanSlug}`] }
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
    ['ed-item-reviews-v1', collectionName, cleanId],
    {
      revalidate: false,
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
    ['ed-review-aggregates-v1', cacheKey],
    { revalidate: false, tags: ['reviews', 'catalog'] }
  );
  const record = await fn();
  return new Map(Object.entries(record));
}
