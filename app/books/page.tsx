import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import React, { cache } from 'react';
import { Breadcrumbs } from '../../components/ui/breadcrumbs';
import { ServerPagination } from '../../components/ui/server-pagination';
import { EmptyState, ErrorState } from '../../components/ui/state-blocks';
import { BookFacetBar } from '../../features/catalog/book-facet-bar';
import { CatalogCard } from '../../features/catalog/catalog-card';
import { CategoryChipsBar } from '../../features/catalog/category-chips-bar';
import {
  BOOKS_HUB_PAGE_SIZE,
  buildBookFacetQueryString,
  hasActiveBookFacets,
  parseBookFacetParams,
  parseStrictPageParam,
} from '../../lib/catalog/facets';
import { buildReviewTargetKey } from '../../lib/reviews/validation';
import {
  buildCanonicalAlternates,
  buildCollectionHubJsonLd,
  buildSiteOgUrl,
  getCanonicalOrigin,
  hasFacetFilterParams,
  serializeSafeJsonLd,
} from '../../lib/seo/schema';
import {
  toCatalogCardDTO,
  type BookAvailableFacets,
  type BookFacetFilters,
  type CategoryChipDTO,
  type PublicBookDTO,
  type ReviewAggregateBadge,
} from '../../lib/types/catalog';
import {
  getCachedFilteredBooksCatalogPage,
  getCachedLiveCategoryChips,
  getCachedPublishedReviewAggregates,
} from '../../server/cache/catalog-cache';

const loadFilteredBooksHub = cache(
  async (page: number, filters: BookFacetFilters) =>
    getCachedFilteredBooksCatalogPage({
      page,
      pageSize: BOOKS_HUB_PAGE_SIZE,
      filters,
    })
);

function isNextInternalControlFlowError(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('digest' in err)) return false;
  const digest = String((err as { digest?: unknown }).digest);
  return (
    digest.includes('NEXT_HTTP_ERROR_FALLBACK') ||
    digest.includes('NEXT_REDIRECT')
  );
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const pageParse = parseStrictPageParam(sp.page);
  if (pageParse.kind === 'invalid') {
    notFound();
  }

  const facetFilters = parseBookFacetParams(sp);
  const isFilteredVariant =
    hasFacetFilterParams(sp) || hasActiveBookFacets(facetFilters);

  if (pageParse.kind === 'redirect_page_1') {
    const cleanQs = buildBookFacetQueryString(facetFilters, 1);
    permanentRedirect(`/books${cleanQs}`);
  }

  const pageNum = pageParse.page;

  let itemCount = 1;
  let unfilteredTotal = 1;
  try {
    const pageResult = await loadFilteredBooksHub(pageNum, facetFilters);
    itemCount = pageResult.items.length;
    unfilteredTotal = pageResult.unfilteredTotalCount;
  } catch {
    // Allow transient error state in page body without throwing 404 on page 1
  }

  // Out-of-bounds pagination pages return genuine HTTP 404
  if (pageNum > 1 && itemCount === 0) {
    notFound();
  }

  const origin = getCanonicalOrigin();
  const relCanonical =
    !isFilteredVariant && pageNum > 1 ? `/books?page=${pageNum}` : '/books';
  const fullCanonical = `${origin}${relCanonical}`;
  const ogImg = buildSiteOgUrl();
  const title =
    !isFilteredVariant && pageNum > 1
      ? `Books & Question Banks (Page ${pageNum})`
      : 'Books & Question Banks Catalog';
  const description =
    'Browse verified ebooks, topic-wise question banks, exam categories, and downloadable sample chapters on ExamDash.';

  if (unfilteredTotal === 0) {
    return {
      title,
      description,
      alternates: buildCanonicalAlternates('/books', { includeRssFeed: true }),
      robots: {
        index: false,
        follow: true,
      },
    };
  }

  return {
    title,
    description,
    alternates: buildCanonicalAlternates(relCanonical, { includeRssFeed: true }),
    robots: {
      index: !isFilteredVariant,
      follow: true,
    },
    openGraph: {
      title: `${title} | ExamDash`,
      description,
      url: fullCanonical,
      siteName: 'ExamDash',
      type: 'website',
      images: [
        {
          url: ogImg,
          width: 512,
          height: 512,
          alt: title,
          type: 'image/png',
        },
      ],
    },
    twitter: {
      card: 'summary',
      title: `${title} | ExamDash`,
      description,
      images: [ogImg],
    },
  };
}

export default async function BooksCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const pageParse = parseStrictPageParam(sp.page);
  if (pageParse.kind === 'invalid') {
    notFound();
  }

  const facetFilters = parseBookFacetParams(sp);
  const isFilteredVariant =
    hasFacetFilterParams(sp) || hasActiveBookFacets(facetFilters);

  if (pageParse.kind === 'redirect_page_1') {
    const cleanQs = buildBookFacetQueryString(facetFilters, 1);
    permanentRedirect(`/books${cleanQs}`);
  }

  const pageNum = pageParse.page;

  let booksPage: {
    items: PublicBookDTO[];
    totalCount: number;
    unfilteredTotalCount: number;
    hasMore: boolean;
    facets: BookAvailableFacets;
  } = {
    items: [],
    totalCount: 0,
    unfilteredTotalCount: 0,
    hasMore: false,
    facets: { types: [], languages: [], priceBuckets: [] },
  };
  let categoryChips: CategoryChipDTO[] = [];
  let reviewAggregates = new Map<string, ReviewAggregateBadge>();
  let fetchError: string | null = null;

  try {
    [booksPage, categoryChips] = await Promise.all([
      loadFilteredBooksHub(pageNum, facetFilters),
      getCachedLiveCategoryChips().catch(() => [] as CategoryChipDTO[]),
    ]);

    if (pageNum > 1 && booksPage.items.length === 0) {
      notFound();
    }

    if (booksPage.items.length > 0) {
      const visibleKeys = booksPage.items.map((b) =>
        buildReviewTargetKey('books', b.id)
      );
      reviewAggregates = await getCachedPublishedReviewAggregates(visibleKeys);
    }
  } catch (err) {
    if (isNextInternalControlFlowError(err)) {
      throw err;
    }
    fetchError =
      err instanceof Error ? err.message : 'Unable to fetch books catalog.';
  }

  const pagedBooks = booksPage.items.map((b) =>
    toCatalogCardDTO(b, reviewAggregates.get(buildReviewTargetKey('books', b.id)))
  );

  const hubJsonLd = serializeSafeJsonLd(
    buildCollectionHubJsonLd({
      collection: 'books',
      title:
        !isFilteredVariant && pageNum > 1
          ? `Exam Books PDFs — Page ${pageNum}`
          : 'Exam Books PDFs & Question Banks',
      description:
        'Verified digital exam books, topic-wise question banks, previous papers, and revision notes with free sample chapters.',
      pageNum,
      pageSize: BOOKS_HUB_PAGE_SIZE,
      isFiltered: isFilteredVariant,
      items: booksPage.items,
    })
  );

  const filterQueryWithoutPage = buildBookFacetQueryString(facetFilters, 1);

  return (
    <div className="pt-8 max-md:pt-4 pb-10 max-md:pb-6">
      <script
        key={`books-hub-jsonld-${pageNum}`}
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: hubJsonLd }}
      />

      <div className="ed-container">
        <Breadcrumbs
          items={
            !isFilteredVariant && pageNum > 1
              ? [
                  { label: 'Home', href: '/' },
                  { label: 'Books', href: '/books' },
                  { label: `Page ${pageNum}` },
                ]
              : [{ label: 'Home', href: '/' }, { label: 'Books' }]
          }
        />
        <h1 className="text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)] text-balance">
          {!isFilteredVariant && pageNum > 1
            ? `Exam Books Pdfs — Page ${pageNum}`
            : 'Exam Books Pdfs'}
        </h1>
        <p className="mt-2 max-md:mt-1.5 text-base max-md:text-sm text-[var(--text-muted)] max-w-2xl">
          Download free sample chapters, verified exam books PDFs, previous papers, study guides, and revision notes. Boost your competitive test preparation with instant access to structured study materials.
        </p>

        {/* Category Chips Bar — Displayed Exclusively on Main `/books` Page with Full Crawler DOM Access */}
        <CategoryChipsBar categories={categoryChips} />
      </div>

      {fetchError ? (
        <div className="ed-container py-8">
          <ErrorState message={fetchError} />
        </div>
      ) : (
        <>
          {booksPage.unfilteredTotalCount > 0 && (
            <div className="ed-container mt-6 max-md:mt-4">
              <BookFacetBar
                basePath="/books"
                availableFacets={booksPage.facets}
                activeFilters={facetFilters}
                totalCount={booksPage.totalCount}
                unfilteredTotalCount={booksPage.unfilteredTotalCount}
              />
            </div>
          )}

          <section
            aria-labelledby="published-books-heading"
            className="ed-container py-6 sm:py-8 max-md:py-5"
          >
            <div className="flex items-end justify-between gap-4 pb-4 border-b border-[var(--border-subtle)] mb-5 max-md:mb-4">
              <h2
                id="published-books-heading"
                className="text-[length:var(--text-h2)] font-extrabold tracking-tight text-[var(--text-main)]"
              >
                Published Books{' '}
                <span className="text-sm font-medium text-[var(--text-muted)] tabular-nums">
                  ({booksPage.totalCount})
                </span>
              </h2>
            </div>

            {booksPage.unfilteredTotalCount === 0 ? (
              <EmptyState
                title="No published books yet"
                description="New verified titles from the Firestore catalog will appear here automatically as soon as they are published."
              />
            ) : pagedBooks.length === 0 ? (
              <EmptyState
                title="No books match the selected filters"
                description="Adjust or reset your format, language, or price range filters to view all published books."
                actionLabel="Reset All Books"
                actionHref="/books"
              />
            ) : (
              <div className="flex flex-col gap-3">
                {pagedBooks.map((item) => (
                  <CatalogCard
                    key={`${item.collectionName}:${item.id}`}
                    item={item}
                    viewMode="list"
                  />
                ))}
              </div>
            )}
          </section>

          <ServerPagination
            basePath="/books"
            currentPage={pageNum}
            pageSize={BOOKS_HUB_PAGE_SIZE}
            hasMore={booksPage.hasMore}
            totalCount={booksPage.totalCount}
            ariaLabel="Books catalog pagination"
            isFiltered={isFilteredVariant}
            filterQueryWithoutPage={filterQueryWithoutPage}
          />
        </>
      )}
    </div>
  );
}
