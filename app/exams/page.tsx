import type { Metadata } from 'next';
import React from 'react';
import { getLiveExams } from '../../server/repositories/catalog-repository';
import { getPublishedReviewAggregates } from '../../server/repositories/review-repository';
import { Breadcrumbs } from '../../components/ui/breadcrumbs';
import { CatalogSection } from '../../features/catalog/catalog-section';
import { ErrorState } from '../../components/ui/state-blocks';
import { buildReviewTargetKey } from '../../lib/reviews/validation';
import { getCanonicalOrigin } from '../../lib/seo/schema';
import { toCatalogCardDTO, type ReviewAggregateBadge } from '../../lib/types/catalog';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;

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
  const pageNum = Math.max(1, Number(sp.page) || 1);

  let exams: Awaited<ReturnType<typeof getLiveExams>> = [];
  let reviewAggregates = new Map<string, ReviewAggregateBadge>();
  let fetchError: string | null = null;

  try {
    [exams, reviewAggregates] = await Promise.all([
      getLiveExams(),
      getPublishedReviewAggregates(),
    ]);
  } catch (err) {
    fetchError =
      err instanceof Error ? err.message : 'Unable to fetch exam packs catalog.';
  }

  const totalPages = Math.max(1, Math.ceil(exams.length / PAGE_SIZE));
  const clampedPage = Math.min(pageNum, totalPages);
  const startIdx = (clampedPage - 1) * PAGE_SIZE;
  const pagedExams = exams
    .slice(startIdx, startIdx + PAGE_SIZE)
    .map((e) =>
      toCatalogCardDTO(
        e,
        reviewAggregates.get(buildReviewTargetKey('ExamPackDocument', e.id))
      )
    );

  return (
    <div className="pt-8">
      <div className="ed-container">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Exams' }]} />
        <h1 className="text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)]">
          Exam Packs & Mock Test Series
        </h1>
        <p className="mt-2 text-base text-[var(--text-muted)] max-w-2xl">
          Practice with exam-grade test packs featuring structured paper durations, transparent mark distributions, and free sample sets.
        </p>
      </div>

      {fetchError ? (
        <div className="ed-container py-8">
          <ErrorState message={fetchError} />
        </div>
      ) : (
        <>
          <CatalogSection
            heading="Published Exam Packs"
            subheading={`Showing ${pagedExams.length} of ${exams.length} available test series`}
            storageKey="hub-exams"
            items={pagedExams}
          />

          {totalPages > 1 && (
            <nav
              aria-label="Exam packs pagination"
              className="ed-container pb-8 flex items-center justify-center gap-2"
            >
              {Array.from({ length: totalPages }).map((_, idx) => {
                const p = idx + 1;
                const href = p === 1 ? '/exams' : `/exams?page=${p}`;
                const active = p === clampedPage;
                return (
                  <a
                    key={p}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={
                      active
                        ? 'min-h-[48px] min-w-[48px] px-3 inline-flex items-center justify-center rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold tabular-nums'
                        : 'min-h-[48px] min-w-[48px] px-3 inline-flex items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm font-medium text-[var(--text-main)] hover:bg-[var(--bg-elevated)] tabular-nums'
                    }
                  >
                    {p}
                  </a>
                );
              })}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
