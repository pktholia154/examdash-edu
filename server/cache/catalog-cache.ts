import { unstable_cache } from 'next/cache';
import type {
  CollectionName,
  ItemReviewSummaryDTO,
  PublicBookDTO,
  PublicExamDTO,
  ReviewAggregateBadge,
} from '../../lib/types/catalog';
import {
  getBookBySlug,
  getExamBySlug,
  getLiveBooksPage,
  getLiveCollectionCount,
  getLiveExamsPage,
  getSitemapCatalogEntries,
  type CatalogPageResult,
  type SitemapCatalogEntry,
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
