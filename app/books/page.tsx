import type { Metadata } from 'next';
import React from 'react';
import {
  getLiveBooksPage,
  getLiveCollectionCount,
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
  type PublicBookDTO,
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
    pageNum > 1 ? `${origin}/books?page=${pageNum}` : `${origin}/books`;

  return {
    title:
      pageNum > 1
        ? `Books & Question Banks (Page ${pageNum})`
        : 'Books & Question Banks Catalog',
    description:
      'Browse verified ebooks, topic-wise question banks, and downloadable sample chapters on ExamDash.',
    alternates: {
      canonical: canonicalPath,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function BooksCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const pageNum = Math.max(1, Math.floor(Number(sp.page) || 1));
  const offset = Math.min(5000, (pageNum - 1) * PAGE_SIZE);

  let booksPage: CatalogPageResult<PublicBookDTO> = {
    items: [],
    hasMore: false,
    nextOffset: offset,
  };
  let totalBooksCount: number | null = null;
  let reviewAggregates = new Map<string, ReviewAggregateBadge>();
  let fetchError: string | null = null;

  try {
    [booksPage, totalBooksCount, reviewAggregates] = await Promise.all([
      getLiveBooksPage({ limit: PAGE_SIZE, offset }),
      getLiveCollectionCount('books'),
      getPublishedReviewAggregates(),
    ]);
  } catch (err) {
    fetchError =
      err instanceof Error ? err.message : 'Unable to fetch books catalog.';
  }

  const pagedBooks = booksPage.items.map((b) =>
    toCatalogCardDTO(b, reviewAggregates.get(buildReviewTargetKey('books', b.id)))
  );
  const effectiveTotal =
    totalBooksCount !== null
      ? Math.max(totalBooksCount, offset + pagedBooks.length)
      : undefined;

  return (
    <div className="pt-8 max-md:pt-4">
      <div className="ed-container">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Books' }]} />
        <h1 className="text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)]">
          Exam Books Pdfs
        </h1>
        <p className="mt-2 max-md:mt-1.5 text-base max-md:text-sm text-[var(--text-muted)] max-w-2xl">
          Download free exam books PDFs, previous papers, study guides, and revision notes. Boost your competitive test preparation with instant access to comprehensive study materials.
        </p>
      </div>

      {fetchError ? (
        <div className="ed-container py-8">
          <ErrorState message={fetchError} />
        </div>
      ) : (
        <CatalogSection
          key={`books-offset-${offset}`}
          heading="Published Books"
          progressUnit="available titles"
          storageKey="hub-books"
          items={pagedBooks}
          showFilters={false}
          collectionName="books"
          pageSize={PAGE_SIZE}
          initialHasMore={booksPage.hasMore}
          initialNextOffset={booksPage.nextOffset}
          totalCount={effectiveTotal}
          loadMoreLabel="Load More Books"
        />
      )}
    </div>
  );
}
