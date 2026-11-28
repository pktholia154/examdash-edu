import type { Metadata } from 'next';
import React from 'react';
import {
  getCachedLiveBooksPage,
  getCachedLiveCollectionCount,
  getCachedLiveExamsPage,
  getCachedPublishedReviewAggregates,
} from '../server/cache/catalog-cache';
import type { CatalogPageResult } from '../server/repositories/catalog-repository';
import { buildReviewTargetKey } from '../lib/reviews/validation';
import { buildCanonicalAlternates } from '../lib/seo/schema';
import {
  toCatalogCardDTO,
  type PublicBookDTO,
  type PublicExamDTO,
  type ReviewAggregateBadge,
} from '../lib/types/catalog';
import { HomeSearchBar } from '../features/catalog/search-hero';
import { InstallAppCallout } from '../features/pwa/install-banner';
import { KpiStrip } from '../features/catalog/kpi-strip';
import { BookCarouselSection } from '../features/catalog/book-carousel';
import { CatalogSection } from '../features/catalog/catalog-section';
import { ErrorState } from '../components/ui/state-blocks';
import { HomeComplianceSection } from '../components/legal/home-compliance-section';
import {
  buildBestsellerBooksShelf,
  buildLatestBooksShelf,
} from '../lib/catalog/carousel-shelves';

export const revalidate = false;

export const metadata: Metadata = {
  alternates: buildCanonicalAlternates('/', { includeRssFeed: true }),
};

const HOME_LIST_LIMIT = 5;
const HOME_CAROUSEL_LIMIT = 16;

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
    [booksPage, examsPage, booksTotalCount, examsTotalCount] =
      await Promise.all([
        getCachedLiveBooksPage({ limit: HOME_CAROUSEL_LIMIT, offset: 0 }),
        getCachedLiveExamsPage({ limit: HOME_LIST_LIMIT, offset: 0 }),
        getCachedLiveCollectionCount('books'),
        getCachedLiveCollectionCount('ExamPackDocument'),
      ]);

    const visibleKeys = [
      ...booksPage.items.map((b) => buildReviewTargetKey('books', b.id)),
      ...examsPage.items.map((e) =>
        buildReviewTargetKey('ExamPackDocument', e.id)
      ),
    ];
    reviewAggregates = await getCachedPublishedReviewAggregates(visibleKeys);
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

  const allSlimBooks = books.map((b) =>
    toCatalogCardDTO(b, reviewAggregates.get(buildReviewTargetKey('books', b.id)))
  );
  const latestCarouselBooks = buildLatestBooksShelf(
    allSlimBooks,
    HOME_CAROUSEL_LIMIT
  );
  const bestsellerCarouselBooks = buildBestsellerBooksShelf(
    allSlimBooks,
    HOME_CAROUSEL_LIMIT
  );

  const slimBooksList = allSlimBooks.slice(0, HOME_LIST_LIMIT);
  const booksListHasMore =
    allSlimBooks.length > HOME_LIST_LIMIT || booksPage.hasMore;
  const booksListNextOffset = Math.min(HOME_LIST_LIMIT, allSlimBooks.length);

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

      <KpiStrip />

      {fetchError ? (
        <div className="ed-container py-10">
          <ErrorState
            title="Live catalog connection interrupted"
            message={fetchError}
          />
        </div>
      ) : (
        <>
          {latestCarouselBooks.length > 0 && (
            <BookCarouselSection
              id="latest-books-carousel"
              heading="Latest Books"
              subheading="Newly published study editions and chapterwise question banks"
              items={latestCarouselBooks}
              viewAllHref="/books"
              viewAllLabel="All Books"
              prioritizeFirstCount={4}
            />
          )}

          {bestsellerCarouselBooks.length > 0 && (
            <BookCarouselSection
              id="bestsellers-carousel"
              heading="Bestsellers"
              subheading="Top-value practice books and high-demand exam editions"
              items={bestsellerCarouselBooks}
              viewAllHref="/books"
              viewAllLabel="Explore All"
            />
          )}

          {latestCarouselBooks.length > 0 && (
            <div className="ed-container">
              <hr className="border-[var(--border-subtle)]" />
            </div>
          )}

          <CatalogSection
            id="books-catalog"
            heading="Books & Question Banks"
            storageKey="home-books"
            items={slimBooksList}
            viewAllHref="/books"
            viewAllLabel="All Books"
            showFilters={false}
            collectionName="books"
            pageSize={HOME_LIST_LIMIT}
            initialHasMore={booksListHasMore}
            initialNextOffset={booksListNextOffset}
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
