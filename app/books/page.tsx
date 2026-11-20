import type { Metadata } from 'next';
import React from 'react';
import { getLiveBooks } from '../../server/repositories/catalog-repository';
import { Breadcrumbs } from '../../components/ui/breadcrumbs';
import { CatalogSection } from '../../features/catalog/catalog-section';
import { ErrorState } from '../../components/ui/state-blocks';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const pageNum = Math.max(1, Number(sp.page) || 1);
  const canonicalPath = pageNum > 1 ? `/books?page=${pageNum}` : '/books';

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
  const pageNum = Math.max(1, Number(sp.page) || 1);

  let books: Awaited<ReturnType<typeof getLiveBooks>> = [];
  let fetchError: string | null = null;

  try {
    books = await getLiveBooks();
  } catch (err) {
    fetchError =
      err instanceof Error ? err.message : 'Unable to fetch books catalog.';
  }

  const totalPages = Math.max(1, Math.ceil(books.length / PAGE_SIZE));
  const clampedPage = Math.min(pageNum, totalPages);
  const startIdx = (clampedPage - 1) * PAGE_SIZE;
  const pagedBooks = books.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <div className="pt-8">
      <div className="ed-container">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Books' }]} />
        <h1 className="text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)]">
          Books & Question Banks
        </h1>
        <p className="mt-2 text-base text-[var(--text-muted)] max-w-2xl">
          Verified digital textbooks and MCQ banks published directly from the ExamDash curriculum repository, with instant chapter previews before purchase.
        </p>
      </div>

      {fetchError ? (
        <div className="ed-container py-8">
          <ErrorState message={fetchError} />
        </div>
      ) : (
        <>
          <CatalogSection
            heading="Published Books"
            subheading={`Showing ${pagedBooks.length} of ${books.length} available titles`}
            storageKey="hub-books"
            items={pagedBooks}
          />

          {totalPages > 1 && (
            <nav
              aria-label="Books catalog pagination"
              className="ed-container pb-8 flex items-center justify-center gap-2"
            >
              {Array.from({ length: totalPages }).map((_, idx) => {
                const p = idx + 1;
                const href = p === 1 ? '/books' : `/books?page=${p}`;
                const active = p === clampedPage;
                return (
                  <a
                    key={p}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={
                      active
                        ? 'min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold tabular-nums'
                        : 'min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm font-medium text-[var(--text-main)] hover:bg-[var(--bg-elevated)] tabular-nums'
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
