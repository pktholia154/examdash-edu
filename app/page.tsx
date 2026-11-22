import React from 'react';
import {
  getLiveBooks,
  getLiveExams,
} from '../server/repositories/catalog-repository';
import { getPublishedReviewAggregates } from '../server/repositories/review-repository';
import { buildReviewTargetKey } from '../lib/reviews/validation';
import { toCatalogCardDTO, type ReviewAggregateBadge } from '../lib/types/catalog';
import { SearchHero } from '../features/catalog/search-hero';
import { KpiStrip } from '../features/catalog/kpi-strip';
import { CatalogSection } from '../features/catalog/catalog-section';
import { ErrorState } from '../components/ui/state-blocks';
import { HomeComplianceSection } from '../components/legal/home-compliance-section';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let fetchError: string | null = null;
  let books: Awaited<ReturnType<typeof getLiveBooks>> = [];
  let exams: Awaited<ReturnType<typeof getLiveExams>> = [];
  let reviewAggregates = new Map<string, ReviewAggregateBadge>();

  try {
    [books, exams, reviewAggregates] = await Promise.all([
      getLiveBooks(),
      getLiveExams(),
      getPublishedReviewAggregates(),
    ]);
  } catch (error) {
    fetchError =
      error instanceof Error
        ? error.message
        : 'Unable to reach Firestore catalog.';
  }

  const totalMocks = exams.reduce((acc, e) => acc + e.totalMocktest, 0);
  const potentialSavings =
    books.reduce((acc, b) => acc + Math.max(0, b.listPrice - b.buyPrice), 0) +
    exams.reduce((acc, e) => acc + Math.max(0, e.listPrice - e.buyPrice), 0);
  const primaryCurrency =
    books[0]?.currency || exams[0]?.currency || 'INR';

  const slimBooks = books.map((b) =>
    toCatalogCardDTO(b, reviewAggregates.get(buildReviewTargetKey('books', b.id)))
  );
  const slimExams = exams.map((e) =>
    toCatalogCardDTO(
      e,
      reviewAggregates.get(buildReviewTargetKey('ExamPackDocument', e.id))
    )
  );

  return (
    <>
      <SearchHero bookCount={books.length} examCount={exams.length} />

      <KpiStrip
        totalCatalogBooks={books.length}
        totalCatalogExams={exams.length}
        totalCatalogMocks={totalMocks}
        catalogPotentialSavings={potentialSavings}
        primaryCurrency={primaryCurrency}
      />

      {fetchError ? (
        <div className="ed-container py-10">
          <ErrorState
            title="Live catalog connection interrupted"
            message={fetchError}
          />
        </div>
      ) : (
        <>
          <CatalogSection
            id="books-catalog"
            heading="Books & Question Banks"
            subheading="Structured ebooks, chapter wise question banks, and free sample extracts."
            storageKey="home-books"
            items={slimBooks}
            viewAllHref="/books"
            viewAllLabel="All Books"
            showFilters={false}
          />

          <div className="ed-container">
            <hr className="border-[var(--border-subtle)]" />
          </div>

          <CatalogSection
            id="exams-catalog"
            heading="Exam Packs & Mock Test Series"
            subheading="Full-length timed test series with complete paper-wise syllabus breakdowns."
            storageKey="home-exams"
            items={slimExams}
            viewAllHref="/exams"
            viewAllLabel="All Exam Packs"
            showFilters={false}
          />
        </>
      )}

      <HomeComplianceSection />
    </>
  );
}
