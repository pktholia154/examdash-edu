import React from 'react';
import {
  getLiveBooksPage,
  getLiveCollectionCount,
  getLiveExamsPage,
  type CatalogPageResult,
} from '../server/repositories/catalog-repository';
import { getPublishedReviewAggregates } from '../server/repositories/review-repository';
import { buildReviewTargetKey } from '../lib/reviews/validation';
import {
  toCatalogCardDTO,
  type PublicBookDTO,
  type PublicExamDTO,
  type ReviewAggregateBadge,
} from '../lib/types/catalog';
import { HomeSearchBar } from '../features/catalog/search-hero';
import { InstallAppCallout } from '../features/pwa/install-banner';
import { KpiStrip } from '../features/catalog/kpi-strip';
import { CatalogSection } from '../features/catalog/catalog-section';
import { ErrorState } from '../components/ui/state-blocks';
import { HomeComplianceSection } from '../components/legal/home-compliance-section';

export const dynamic = 'force-dynamic';

const HOME_LIST_LIMIT = 5;

export default async function HomePage() {
  let fetchError: string | null = null;
  let booksPage: CatalogPageResult<PublicBookDTO> = {
    items: [],
    hasMore: false,
    nextOffset: 0,
  };
  let examsPage: CatalogPageResult<PublicExamDTO> = {
    items: [],
    hasMore: false,
    nextOffset: 0,
  };
  let booksTotalCount: number | null = null;
  let examsTotalCount: number | null = null;
  let reviewAggregates = new Map<string, ReviewAggregateBadge>();

  try {
    [booksPage, examsPage, booksTotalCount, examsTotalCount, reviewAggregates] =
      await Promise.all([
        getLiveBooksPage({ limit: HOME_LIST_LIMIT, offset: 0 }),
        getLiveExamsPage({ limit: HOME_LIST_LIMIT, offset: 0 }),
        getLiveCollectionCount('books'),
        getLiveCollectionCount('ExamPackDocument'),
        getPublishedReviewAggregates(),
      ]);
  } catch (error) {
    fetchError =
      error instanceof Error
        ? error.message
        : 'Unable to reach Firestore catalog.';
  }

  const books = booksPage.items;
  const exams = examsPage.items;

  const displayBookCount =
    booksTotalCount !== null
      ? Math.max(books.length, booksTotalCount)
      : books.length;
  const displayExamCount =
    examsTotalCount !== null
      ? Math.max(exams.length, examsTotalCount)
      : exams.length;

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
      <h1 className="sr-only">
        ExamDash — Verified Books, Question Banks &amp; Full-Length Mock Exam Packs
      </h1>

      <div className="ed-container pt-6 sm:pt-7 max-md:pt-3.5">
        <HomeSearchBar
          bookCount={displayBookCount}
          examCount={displayExamCount}
        />
        <InstallAppCallout variant="home" className="mt-3.5 max-md:mt-3" />
      </div>

      <KpiStrip
        totalCatalogBooks={displayBookCount}
        totalCatalogExams={displayExamCount}
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
            storageKey="home-books"
            items={slimBooks}
            viewAllHref="/books"
            viewAllLabel="All Books"
            showFilters={false}
            collectionName="books"
            pageSize={HOME_LIST_LIMIT}
            initialHasMore={booksPage.hasMore}
            initialNextOffset={booksPage.nextOffset}
            totalCount={booksTotalCount !== null ? displayBookCount : undefined}
            loadMoreLabel="Load More Books"
          />

          <div className="ed-container">
            <hr className="border-[var(--border-subtle)]" />
          </div>

          <CatalogSection
            id="exams-catalog"
            heading="Exam Packs & Mock Test Series"
            storageKey="home-exams"
            items={slimExams}
            viewAllHref="/exams"
            viewAllLabel="All Exam Packs"
            showFilters={false}
            collectionName="ExamPackDocument"
            pageSize={HOME_LIST_LIMIT}
            initialHasMore={examsPage.hasMore}
            initialNextOffset={examsPage.nextOffset}
            totalCount={examsTotalCount !== null ? displayExamCount : undefined}
            loadMoreLabel="Load More Exam Packs"
          />
        </>
      )}

      <HomeComplianceSection />
    </>
  );
}
