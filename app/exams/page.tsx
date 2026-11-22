import type { Metadata } from 'next';
import React from 'react';
import {
  getLiveCollectionCount,
  getLiveExamsPage,
  type CatalogPageResult,
} from '../../server/repositories/catalog-repository';
import { getPublishedReviewAggregates } from '../../server/repositories/review-repository';
import { Breadcrumbs } from '../../components/ui/breadcrumbs';
import { CatalogSection } from '../../features/catalog/catalog-section';
import { ErrorState } from '../../components/ui/state-blocks';
import { buildReviewTargetKey } from '../../lib/reviews/validation';
import { getCanonicalOrigin } from '../../lib/seo/schema';
import {
  toCatalogCardDTO,
  type PublicExamDTO,
  type ReviewAggregateBadge,
} from '../../lib/types/catalog';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 10;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const pageNum = Math.max(1, Number(sp.page) || 1);
  const origin = getCanonicalOrigin();
  const canonicalPath =
    pageNum > 1 ? `${origin}/exams?page=${pageNum}` : `${origin}/exams`;

  return {
    title:
      pageNum > 1
        ? `Exam Packs & Mock Test Series (Page ${pageNum})`
        : 'Exam Packs & Mock Test Series Catalog',
    description:
      'Explore full-length timed mock exam packs with complete paper-wise syllabus tables, question counts, and free trial sets on ExamDash.',
    alternates: {
      canonical: canonicalPath,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function ExamsCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const pageNum = Math.max(1, Math.floor(Number(sp.page) || 1));
  const offset = Math.min(5000, (pageNum - 1) * PAGE_SIZE);

  let examsPage: CatalogPageResult<PublicExamDTO> = {
    items: [],
    hasMore: false,
    nextOffset: offset,
  };
  let totalExamsCount: number | null = null;
  let reviewAggregates = new Map<string, ReviewAggregateBadge>();
  let fetchError: string | null = null;

  try {
    [examsPage, totalExamsCount, reviewAggregates] = await Promise.all([
      getLiveExamsPage({ limit: PAGE_SIZE, offset }),
      getLiveCollectionCount('ExamPackDocument'),
      getPublishedReviewAggregates(),
    ]);
  } catch (err) {
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

  return (
    <div className="pt-8 max-md:pt-4">
      <div className="ed-container">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Exams' }]} />
        <h1 className="text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)]">
          Online Exam Mock Tests
        </h1>
        <p className="mt-2 max-md:mt-1.5 text-base max-md:text-sm text-[var(--text-muted)] max-w-2xl">
          Attempt free online exams, mock tests, practice tests, and full-length test series. Boost your competitive exam preparation with instant results and detailed performance analysis.
        </p>
      </div>

      {fetchError ? (
        <div className="ed-container py-8">
          <ErrorState message={fetchError} />
        </div>
      ) : (
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
      )}
    </div>
  );
}
