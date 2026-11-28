import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import React, { cache } from 'react';
import {
  getCachedLiveCollectionCount,
  getCachedLiveExamsPage,
  getCachedPublishedReviewAggregates,
} from '../../server/cache/catalog-cache';
import type { CatalogPageResult } from '../../server/repositories/catalog-repository';
import { Breadcrumbs } from '../../components/ui/breadcrumbs';
import { ServerPagination } from '../../components/ui/server-pagination';
import { CatalogSection } from '../../features/catalog/catalog-section';
import { ErrorState } from '../../components/ui/state-blocks';
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
  type PublicExamDTO,
  type ReviewAggregateBadge,
} from '../../lib/types/catalog';

const PAGE_SIZE = 20;

const loadExamsHubPage = cache(async (offset: number) => {
  return getCachedLiveExamsPage({ limit: PAGE_SIZE, offset });
});

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const rawPageParam = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const pageNum = Math.max(1, Math.floor(Number(rawPageParam) || 1));
  const offset = Math.min(50000, (pageNum - 1) * PAGE_SIZE);
  const isFilteredVariant = hasFacetFilterParams(sp);

  let itemCount = 1;
  try {
    const pageResult = await loadExamsHubPage(offset);
    itemCount = pageResult.items.length;
  } catch {
    // Allow transient error state in page body without throwing 404 on page 1
  }

  // Pillar 3 Anti-Soft-404 Gate: out-of-bounds pagination pages return genuine HTTP 404
  if (pageNum > 1 && itemCount === 0) {
    notFound();
  }

  const origin = getCanonicalOrigin();
  const relCanonical = pageNum > 1 ? `/exams?page=${pageNum}` : '/exams';
  const fullCanonical = `${origin}${relCanonical}`;
  const ogImg = buildSiteOgUrl();
  const title =
    pageNum > 1
      ? `Exam Packs & Mock Test Series (Page ${pageNum})`
      : 'Exam Packs & Mock Test Series Catalog';
  const description =
    'Explore full-length timed mock exam packs with complete paper-wise syllabus tables, question counts, and free trial sets on ExamDash.';

  if (itemCount === 0) {
    return {
      title,
      description,
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

export default async function ExamsCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rawPageParam = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const pageNum = Math.max(1, Math.floor(Number(rawPageParam) || 1));
  const offset = Math.min(50000, (pageNum - 1) * PAGE_SIZE);

  let examsPage: CatalogPageResult<PublicExamDTO> = {
    items: [],
    hasMore: false,
    nextOffset: offset,
  };
  let totalExamsCount: number | null = null;
  let reviewAggregates = new Map<string, ReviewAggregateBadge>();
  let fetchError: string | null = null;

  try {
    [examsPage, totalExamsCount] = await Promise.all([
      loadExamsHubPage(offset),
      getCachedLiveCollectionCount('ExamPackDocument'),
    ]);

    if (pageNum > 1 && examsPage.items.length === 0) {
      notFound();
    }

    const visibleKeys = examsPage.items.map((e) =>
      buildReviewTargetKey('ExamPackDocument', e.id)
    );
    reviewAggregates = await getCachedPublishedReviewAggregates(visibleKeys);
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'digest' in err &&
      String((err as { digest?: unknown }).digest).includes('NEXT_HTTP_ERROR_FALLBACK')
    ) {
      throw err;
    }
    fetchError =
      err instanceof Error ? err.message : 'Unable to fetch exam packs catalog.';
  }

  const pagedExams = examsPage.items.map((e) =>
    toCatalogCardDTO(
      e,
      reviewAggregates.get(buildReviewTargetKey('ExamPackDocument', e.id))
    )
  );
  const effectiveTotal =
    totalExamsCount !== null
      ? Math.max(totalExamsCount, offset + pagedExams.length)
      : undefined;

  const hubJsonLd = serializeSafeJsonLd(
    buildCollectionHubJsonLd({
      collection: 'exams',
      title:
        pageNum > 1
          ? `Online Exam Mock Tests — Page ${pageNum}`
          : 'Online Exam Mock Tests & CBT Series',
      description:
        'Full-length timed CBT mock exam packs, practice tests, and paper-wise syllabus series with free trial sets and performance analytics.',
      pageNum,
      items: examsPage.items,
    })
  );

  return (
    <div className="pt-8 max-md:pt-4">
      <script
        key={`exams-hub-jsonld-${pageNum}`}
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: hubJsonLd }}
      />

      <div className="ed-container">
        <Breadcrumbs
          items={
            pageNum > 1
              ? [
                  { label: 'Home', href: '/' },
                  { label: 'Exams', href: '/exams' },
                  { label: `Page ${pageNum}` },
                ]
              : [{ label: 'Home', href: '/' }, { label: 'Exams' }]
          }
        />
        <h1 className="text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)]">
          {pageNum > 1
            ? `Online Exam Mock Tests — Page ${pageNum}`
            : 'Online Exam Mock Tests'}
        </h1>
        <p className="mt-2 max-md:mt-1.5 text-base max-md:text-sm text-[var(--text-muted)] max-w-2xl">
          Attempt free trial mock sets, full-length online CBT exams, and structured practice test series. Boost your competitive exam preparation with instant scoring and detailed performance analysis.
        </p>
      </div>

      {fetchError ? (
        <div className="ed-container py-8">
          <ErrorState message={fetchError} />
        </div>
      ) : (
        <>
          <CatalogSection
            key={`exams-offset-${offset}`}
            heading="Published Exam Packs"
            progressUnit="available test series"
            storageKey="hub-exams"
            items={pagedExams}
            showFilters={false}
            collectionName="ExamPackDocument"
            pageSize={PAGE_SIZE}
            initialHasMore={examsPage.hasMore}
            initialNextOffset={examsPage.nextOffset}
            totalCount={effectiveTotal}
            loadMoreLabel="Load More Exam Packs"
          />

          <ServerPagination
            basePath="/exams"
            currentPage={pageNum}
            pageSize={PAGE_SIZE}
            hasMore={examsPage.hasMore}
            totalCount={effectiveTotal}
            ariaLabel="Exam packs catalog pagination"
          />
        </>
      )}
    </div>
  );
}
