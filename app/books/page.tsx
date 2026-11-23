import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import React, { cache } from 'react';
import {
  getLiveBooksPage,
  getLiveCollectionCount,
  type CatalogPageResult,
} from '../../server/repositories/catalog-repository';
import { getPublishedReviewAggregates } from '../../server/repositories/review-repository';
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
  serializeSafeJsonLd,
} from '../../lib/seo/schema';
import {
  toCatalogCardDTO,
  type PublicBookDTO,
  type ReviewAggregateBadge,
} from '../../lib/types/catalog';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

const loadBooksHubPage = cache(async (offset: number) => {
  return getLiveBooksPage({ limit: PAGE_SIZE, offset });
});

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const pageNum = Math.max(1, Math.floor(Number(sp.page) || 1));
  const offset = Math.min(50000, (pageNum - 1) * PAGE_SIZE);

  let itemCount = 1;
  try {
    const pageResult = await loadBooksHubPage(offset);
    itemCount = pageResult.items.length;
  } catch {
    // Allow transient error state in page body without throwing 404 on page 1
  }

  // Pillar 3 Anti-Soft-404 Gate: out-of-bounds pagination pages return genuine HTTP 404
  if (pageNum > 1 && itemCount === 0) {
    notFound();
  }

  const origin = getCanonicalOrigin();
  const relCanonical = pageNum > 1 ? `/books?page=${pageNum}` : '/books';
  const fullCanonical = `${origin}${relCanonical}`;
  const ogImg = buildSiteOgUrl('books');
  const title =
    pageNum > 1
      ? `Books & Question Banks (Page ${pageNum})`
      : 'Books & Question Banks Catalog';
  const description =
    'Browse verified ebooks, topic-wise question banks, and downloadable sample chapters on ExamDash.';

  // Zero-result hub gate: if page 1 has 0 published books, emit noindex, follow without cross-URL canonical
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
      index: true,
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
          width: 1200,
          height: 675,
          alt: title,
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

export default async function BooksCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const pageNum = Math.max(1, Math.floor(Number(sp.page) || 1));
  const offset = Math.min(50000, (pageNum - 1) * PAGE_SIZE);

  let booksPage: CatalogPageResult<PublicBookDTO> = {
    items: [],
    hasMore: false,
    nextOffset: offset,
  };
  let totalBooksCount: number | null = null;
  let reviewAggregates = new Map<string, ReviewAggregateBadge>();
  let fetchError: string | null = null;

  try {
    [booksPage, totalBooksCount] = await Promise.all([
      loadBooksHubPage(offset),
      getLiveCollectionCount('books'),
    ]);

    if (pageNum > 1 && booksPage.items.length === 0) {
      notFound();
    }

    const visibleKeys = booksPage.items.map((b) =>
      buildReviewTargetKey('books', b.id)
    );
    reviewAggregates = await getPublishedReviewAggregates(visibleKeys);
  } catch (err) {
    // Re-throw Next.js notFound() digest if triggered above
    if (
      err &&
      typeof err === 'object' &&
      'digest' in err &&
      String((err as { digest?: unknown }).digest).includes('NEXT_HTTP_ERROR_FALLBACK')
    ) {
      throw err;
    }
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

  const hubJsonLd = serializeSafeJsonLd(
    buildCollectionHubJsonLd({
      collection: 'books',
      title:
        pageNum > 1
          ? `Exam Books PDFs — Page ${pageNum}`
          : 'Exam Books PDFs & Question Banks',
      description:
        'Verified digital exam books, topic-wise question banks, previous papers, and revision notes with free sample chapters.',
      pageNum,
      items: booksPage.items,
    })
  );

  return (
    <div className="pt-8 max-md:pt-4">
      <script
        key={`books-hub-jsonld-${pageNum}`}
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
                  { label: 'Books', href: '/books' },
                  { label: `Page ${pageNum}` },
                ]
              : [{ label: 'Home', href: '/' }, { label: 'Books' }]
          }
        />
        <h1 className="text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)]">
          {pageNum > 1 ? `Exam Books Pdfs — Page ${pageNum}` : 'Exam Books Pdfs'}
        </h1>
        <p className="mt-2 max-md:mt-1.5 text-base max-md:text-sm text-[var(--text-muted)] max-w-2xl">
          Download free sample chapters, verified exam books PDFs, previous papers, study guides, and revision notes. Boost your competitive test preparation with instant access to structured study materials.
        </p>
      </div>

      {fetchError ? (
        <div className="ed-container py-8">
          <ErrorState message={fetchError} />
        </div>
      ) : (
        <>
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

          <ServerPagination
            basePath="/books"
            currentPage={pageNum}
            pageSize={PAGE_SIZE}
            hasMore={booksPage.hasMore}
            totalCount={effectiveTotal}
            ariaLabel="Books catalog pagination"
          />
        </>
      )}
    </div>
  );
}
