import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import React, { cache } from 'react';
import { DescriptionMarkdown } from '../../../../components/editorial/description-markdown';
import { Breadcrumbs } from '../../../../components/ui/breadcrumbs';
import { CatalogThumbnail } from '../../../../components/ui/catalog-thumbnail';
import { ServerPagination } from '../../../../components/ui/server-pagination';
import { EmptyState, ErrorState } from '../../../../components/ui/state-blocks';
import { BookFacetBar } from '../../../../features/catalog/book-facet-bar';
import { CatalogCard } from '../../../../features/catalog/catalog-card';
import {
  buildBookFacetQueryString,
  CATEGORY_HUB_PAGE_SIZE,
  hasActiveBookFacets,
  parseBookFacetParams,
  parseStrictPageParam,
} from '../../../../lib/catalog/facets';
import { formatPrice } from '../../../../lib/registry/content-type-registry';
import { buildReviewTargetKey } from '../../../../lib/reviews/validation';
import {
  buildCanonicalAlternates,
  buildCategoryHubJsonLd,
  buildSiteOgUrl,
  getCanonicalOrigin,
  hasFacetFilterParams,
  serializeSafeJsonLd,
} from '../../../../lib/seo/schema';
import {
  toCatalogCardDTO,
  type BookFacetFilters,
  type CategoryChipDTO,
  type PublicExamDTO,
  type ReviewAggregateBadge,
} from '../../../../lib/types/catalog';
import { getDefaultCatalogPricing } from '../../../../lib/validity/pricing';
import {
  getCachedCategoryBooksHubPage,
  getCachedCategoryBySlug,
  getCachedLiveCategoryChips,
  getCachedLiveExamsPage,
  getCachedPublishedReviewAggregates,
} from '../../../../server/cache/catalog-cache';
import type { CategoryBooksHubPageResult } from '../../../../server/repositories/catalog-repository';

export const dynamicParams = true;

const loadCategoryDoc = cache(
  async (slug: string, includeFullDescription: boolean) =>
    getCachedCategoryBySlug(slug, { includeFullDescription })
);

const loadCategorySpokesPage = cache(
  async (categorySlug: string, page: number, filters: BookFacetFilters) =>
    getCachedCategoryBooksHubPage({
      categorySlug,
      page,
      pageSize: CATEGORY_HUB_PAGE_SIZE,
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
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);

  const pageParse = parseStrictPageParam(sp.page);
  if (pageParse.kind === 'invalid') {
    notFound();
  }

  const facetFilters = parseBookFacetParams(sp);
  const isFilteredVariant =
    hasFacetFilterParams(sp) || hasActiveBookFacets(facetFilters);

  if (pageParse.kind === 'redirect_page_1') {
    const cleanQs = buildBookFacetQueryString(facetFilters, 1);
    permanentRedirect(
      `/books/category/${encodeURIComponent(slug)}${cleanQs}`
    );
  }

  const pageNum = pageParse.page;
  const includeFullDescription = pageNum === 1 && !isFilteredVariant;

  const categoryLookup = await loadCategoryDoc(slug, includeFullDescription);
  if (categoryLookup.status !== 'ok') {
    notFound();
  }

  const category = categoryLookup.data;
  const hubPage = await loadCategorySpokesPage(
    category.slug,
    pageNum,
    facetFilters
  );

  // Out-of-bounds pagination pages return genuine HTTP 404
  if (pageNum > 1 && hubPage.items.length === 0) {
    notFound();
  }

  const origin = getCanonicalOrigin();
  const encodedSlug = encodeURIComponent(category.slug);
  const baseHubRel = `/books/category/${encodedSlug}`;

  // Filtered variants always canonicalize to the clean Page 1 Category Hub URL;
  // Unfiltered Page 2+ uses self-referencing canonicals.
  const relCanonical =
    !isFilteredVariant && pageNum > 1
      ? `${baseHubRel}?page=${pageNum}`
      : baseHubRel;
  const fullCanonical = `${origin}${relCanonical}`;
  const ogImg = hubPage.items[0]?.imageUrl || buildSiteOgUrl();

  const title =
    !isFilteredVariant && pageNum > 1
      ? `${category.title} Books & Question Banks (Page ${pageNum})`
      : `${category.title} Books, PDFs & Question Banks`;

  const description =
    category.metaDescription ||
    `Download verified ${category.title} exam books, topic-wise question banks, previous papers, and free sample chapters on ExamDash.`;

  const isEmptyCategory = hubPage.unfilteredTotalCount === 0;
  const shouldIndex = !isEmptyCategory && !isFilteredVariant;

  return {
    title,
    description,
    alternates: buildCanonicalAlternates(relCanonical),
    robots: {
      index: shouldIndex,
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
          alt: `${category.title} Books on ExamDash`,
          type: 'image/png',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ExamDash`,
      description,
      images: [ogImg],
    },
  };
}

export default async function CategoryBooksHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);

  const pageParse = parseStrictPageParam(sp.page);
  if (pageParse.kind === 'invalid') {
    notFound();
  }

  const facetFilters = parseBookFacetParams(sp);
  const isFilteredVariant =
    hasFacetFilterParams(sp) || hasActiveBookFacets(facetFilters);

  if (pageParse.kind === 'redirect_page_1') {
    const cleanQs = buildBookFacetQueryString(facetFilters, 1);
    permanentRedirect(
      `/books/category/${encodeURIComponent(slug)}${cleanQs}`
    );
  }

  const pageNum = pageParse.page;
  const includeFullDescription = pageNum === 1 && !isFilteredVariant;

  const categoryLookup = await loadCategoryDoc(slug, includeFullDescription);
  if (categoryLookup.status !== 'ok') {
    notFound();
  }

  const category = categoryLookup.data;
  const baseHubPath = `/books/category/${encodeURIComponent(category.slug)}`;

  let hubPage: CategoryBooksHubPageResult = {
    items: [],
    totalCount: 0,
    unfilteredTotalCount: 0,
    hasMore: false,
    facets: { types: [], languages: [], priceBuckets: [] },
    latestUpdatedAtIso: category.updatedAtIso,
    firestoreReadsEstimate: 1,
  };
  let siblingCategories: CategoryChipDTO[] = [];
  let relatedExams: PublicExamDTO[] = [];
  let reviewAggregates = new Map<string, ReviewAggregateBadge>();
  let fetchError: string | null = null;

  try {
    const [resolvedHubPage, allCategoryChips, examsSample] = await Promise.all([
      loadCategorySpokesPage(category.slug, pageNum, facetFilters),
      getCachedLiveCategoryChips().catch(() => [] as CategoryChipDTO[]),
      getCachedLiveExamsPage({ limit: 3, offset: 0 }).catch(() => ({
        items: [] as PublicExamDTO[],
        hasMore: false,
        nextOffset: 0,
      })),
    ]);

    if (pageNum > 1 && resolvedHubPage.items.length === 0) {
      notFound();
    }

    hubPage = resolvedHubPage;
    siblingCategories = allCategoryChips
      .filter((c) => c.slug !== category.slug)
      .slice(0, 3);
    relatedExams = examsSample.items.slice(0, 2);

    if (hubPage.items.length > 0) {
      const visibleKeys = hubPage.items.map((b) =>
        buildReviewTargetKey('books', b.id)
      );
      reviewAggregates = await getCachedPublishedReviewAggregates(visibleKeys);
    }
  } catch (err) {
    if (isNextInternalControlFlowError(err)) {
      throw err;
    }
    fetchError =
      err instanceof Error
        ? err.message
        : 'Unable to load category books right now.';
  }

  const spokeCards = hubPage.items.map((book) =>
    toCatalogCardDTO(
      book,
      reviewAggregates.get(buildReviewTargetKey('books', book.id))
    )
  );

  const hubJsonLd = serializeSafeJsonLd(
    buildCategoryHubJsonLd({
      category: {
        slug: category.slug,
        title: category.title,
        metaDescription: category.metaDescription,
        updatedAtIso: category.updatedAtIso,
      },
      pageNum,
      pageSize: CATEGORY_HUB_PAGE_SIZE,
      isFiltered: isFilteredVariant,
      latestBookIso: hubPage.latestUpdatedAtIso,
      items: hubPage.items,
    })
  );

  const introSummary =
    category.metaDescription ||
    `Explore verified ${category.title} digital books, topic-wise question banks, previous year papers, and downloadable free sample chapters.`;

  const showFullEditorialBelowGrid =
    pageNum === 1 &&
    !isFilteredVariant &&
    Boolean(category.fullDescription && category.fullDescription.trim());

  const filterQueryWithoutPage = buildBookFacetQueryString(facetFilters, 1);

  return (
    <div className="pt-8 max-md:pt-4 pb-12 max-md:pb-6">
      <script
        key={`category-hub-jsonld-${category.slug}-${pageNum}`}
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: hubJsonLd }}
      />

      {/* Answer-First Hub Header */}
      <div className="ed-container">
        <Breadcrumbs
          items={
            !isFilteredVariant && pageNum > 1
              ? [
                  { label: 'Home', href: '/' },
                  { label: 'Books', href: '/books' },
                  { label: category.title, href: baseHubPath },
                  { label: `Page ${pageNum}` },
                ]
              : [
                  { label: 'Home', href: '/' },
                  { label: 'Books', href: '/books' },
                  { label: category.title },
                ]
          }
        />

        <h1 className="text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)] text-balance">
          {!isFilteredVariant && pageNum > 1
            ? `${category.title} — Page ${pageNum}`
            : category.title}
        </h1>
        <p className="mt-2 max-md:mt-1.5 text-base max-md:text-sm text-[var(--text-muted)] max-w-2xl leading-relaxed break-words">
          {introSummary}
        </p>
      </div>

      {fetchError ? (
        <div className="ed-container py-8">
          <ErrorState message={fetchError} />
        </div>
      ) : (
        <>
          {/* Crawl-Proof Faceted Filter Bar (`type`, `language`, `price`, `sort`) */}
          {hubPage.unfilteredTotalCount > 0 && (
            <div className="ed-container mt-6 max-md:mt-4">
              <BookFacetBar
                basePath={baseHubPath}
                availableFacets={hubPage.facets}
                activeFilters={facetFilters}
                totalCount={hubPage.totalCount}
                unfilteredTotalCount={hubPage.unfilteredTotalCount}
              />
            </div>
          )}

          {/* 15 Semantic Spoke Item Cards */}
          <section
            aria-labelledby="category-spokes-heading"
            className="ed-container py-6 sm:py-8 max-md:py-5"
          >
            <div className="flex items-end justify-between gap-4 pb-4 border-b border-[var(--border-subtle)] mb-5 max-md:mb-4">
              <h2
                id="category-spokes-heading"
                className="text-[length:var(--text-h2)] font-extrabold tracking-tight text-[var(--text-main)]"
              >
                {category.title} Study Books{' '}
                <span className="text-sm font-medium text-[var(--text-muted)] tabular-nums">
                  ({hubPage.totalCount})
                </span>
              </h2>
            </div>

            {hubPage.unfilteredTotalCount === 0 ? (
              <EmptyState
                title={`No books published in ${category.title} yet`}
                description="Verified ebooks and question banks for this category will appear here automatically once published."
                actionLabel="Browse All Books"
                actionHref="/books"
              />
            ) : spokeCards.length === 0 ? (
              <EmptyState
                title="No books match the selected filters"
                description="Adjust or reset your format, language, or price range filters to view all books in this category."
                actionLabel="View All Category Books"
                actionHref={baseHubPath}
              />
            ) : (
              <div className="flex flex-col gap-3">
                {spokeCards.map((item) => (
                  <CatalogCard
                    key={`${item.collectionName}:${item.id}`}
                    item={item}
                    viewMode="list"
                  />
                ))}
              </div>
            )}
          </section>

          {/* 15/Page Pagination (`<a>` on unfiltered pages; `<button>` when filtered) */}
          <ServerPagination
            basePath={baseHubPath}
            currentPage={pageNum}
            pageSize={CATEGORY_HUB_PAGE_SIZE}
            hasMore={hubPage.hasMore}
            totalCount={hubPage.totalCount}
            ariaLabel={`${category.title} books pagination`}
            isFiltered={isFilteredVariant}
            filterQueryWithoutPage={filterQueryWithoutPage}
          />

          {/* Editorial Full Description — Rendered Strictly Below the Grid on Unfiltered Page 1 Only */}
          {showFullEditorialBelowGrid && (
            <section
              aria-labelledby="category-editorial-guide-heading"
              className="ed-container mt-4 pt-8 max-md:pt-6 border-t border-[var(--border-subtle)]"
            >
              <h2
                id="category-editorial-guide-heading"
                className="text-lg max-md:text-base font-bold text-[var(--text-main)] mb-3 max-md:mb-2.5"
              >
                About {category.title} Preparation & Study Resources
              </h2>
              <div className="text-sm sm:text-base leading-relaxed text-[var(--text-main)] break-words">
                <DescriptionMarkdown
                  markdown={category.fullDescription}
                  heroTitle={category.title}
                />
              </div>
            </section>
          )}

          {/* Crawlable Hub-and-Spoke Related Links (<= 6 Canonical `<a href>` Links) */}
          <section
            aria-labelledby="category-related-hubs-heading"
            className="ed-container mt-10 pt-8 max-md:mt-8 max-md:pt-6 border-t border-[var(--border-subtle)]"
          >
            <h2
              id="category-related-hubs-heading"
              className="text-base font-bold text-[var(--text-main)] mb-4"
            >
              Related Categories & Companion Mock Test Packs
            </h2>

            <div className="flex flex-wrap items-center gap-2 mb-5">
              <a
                href="/books"
                className="inline-flex items-center justify-center min-h-12 px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0"
              >
                All Exam Books Catalog →
              </a>

              {siblingCategories.map((sib) => (
                <a
                  key={sib.slug}
                  href={`/books/category/${encodeURIComponent(sib.slug)}`}
                  className="inline-flex items-center justify-center gap-1.5 min-h-12 px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-medium text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0"
                >
                  <span>{sib.title}</span>
                  {sib.liveBookCount > 0 && (
                    <span className="tabular-nums text-[11px] text-[var(--text-muted)]">
                      ({sib.liveBookCount})
                    </span>
                  )}
                </a>
              ))}

              <a
                href="/exams"
                className="inline-flex items-center justify-center min-h-12 px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0"
              >
                Mock Exam Series →
              </a>
            </div>

            {relatedExams.length > 0 && (
              <div className="flex flex-col gap-2.5">
                {relatedExams.map((relEx) => {
                  const relPricing = getDefaultCatalogPricing(
                    'ExamPackDocument',
                    relEx.buyPrice
                  );
                  return (
                    <a
                      key={`cat-rel-exam-${relEx.id}`}
                      href={`/exams/${encodeURIComponent(relEx.urlSlug)}`}
                      className="flex items-center gap-3.5 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 hover:border-[var(--border-strong)] transition-colors"
                    >
                      <CatalogThumbnail
                        title={relEx.title}
                        collectionName="ExamPackDocument"
                        imageUrl={relEx.imageUrl}
                        imageMeta={relEx.imageMeta}
                        size="xs"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[var(--text-main)] truncate">
                          {relEx.title}
                        </p>
                        <p className="text-xs text-[var(--text-muted)] tabular-nums">
                          {relEx.totalMocktest} Mock Tests ·{' '}
                          {relPricing.isFree
                            ? 'Free'
                            : formatPrice(
                                relPricing.discountedPrice,
                                relEx.currency
                              )}
                          {relPricing.discountPct > 0
                            ? ` (${relPricing.discountPct}% OFF)`
                            : ''}
                        </p>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
