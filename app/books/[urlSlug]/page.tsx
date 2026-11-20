import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import React from 'react';
import Markdown from 'react-markdown';
import {
  getBookBySlug,
  getLiveBooks,
  getLiveExams,
} from '../../../server/repositories/catalog-repository';
import { Breadcrumbs } from '../../../components/ui/breadcrumbs';
import { MonogramThumbnail } from '../../../components/ui/monogram-thumbnail';
import { DetailBuyCard } from '../../../features/catalog/detail-buy-card';
import {
  buildBookDetailJsonLd,
  serializeSafeJsonLd,
} from '../../../lib/seo/schema';
import { formatPrice } from '../../../lib/registry/content-type-registry';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ urlSlug: string }>;
}): Promise<Metadata> {
  const { urlSlug } = await params;
  const lookup = await getBookBySlug(urlSlug);

  if (lookup.status !== 'ok') {
    notFound();
  }

  const book = lookup.data;
  const description =
    book.seoDescription ||
    book.fullDescription.slice(0, 155) ||
    `${book.title} by ${book.authorName} on ExamDash.`;

  return {
    title: book.title,
    description,
    alternates: {
      canonical: `/books/${book.urlSlug}`,
    },
    openGraph: {
      title: `${book.title} | ExamDash`,
      description,
      type: 'book',
      url: `/books/${book.urlSlug}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${book.title} | ExamDash`,
      description,
    },
  };
}

function formatReadableDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ urlSlug: string }>;
}) {
  const { urlSlug } = await params;
  const [lookup, allBooks, allExams] = await Promise.all([
    getBookBySlug(urlSlug),
    getLiveBooks(),
    getLiveExams(),
  ]);

  if (lookup.status !== 'ok') {
    notFound();
  }

  const book = lookup.data;
  const jsonLd = serializeSafeJsonLd(buildBookDetailJsonLd(book));

  // Up to 6 cross-taxonomy related <a href> links for shallow <= 3 click graph
  const siblingBooks = allBooks
    .filter((b) => b.urlSlug !== book.urlSlug)
    .slice(0, 4);
  const relatedExams = allExams.slice(0, 2);

  return (
    <div className="ed-container py-8 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />

      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Books', href: '/books' },
          { label: book.title },
        ]}
      />

      <article className="w-full">
        {/* Header Block */}
        <div className="flex flex-col sm:flex-row items-start gap-5 pb-6 border-b border-[var(--border-subtle)]">
          <MonogramThumbnail
            title={book.title}
            type={book.type}
            collectionName="books"
            size="lg"
            className="w-28 h-28 sm:w-32 sm:h-32 shrink-0"
          />

          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-[var(--text-muted)]">
              {book.type} · {book.language} · Published by {book.publisher}
            </p>
            <h1 className="mt-1.5 text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)] leading-tight text-balance">
              {book.title}
            </h1>

            {/* Answer-First Summary Beneath Heading */}
            {book.seoDescription && (
              <p className="mt-2.5 text-base text-[var(--text-muted)] leading-relaxed">
                {book.seoDescription}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--text-muted)] tabular-nums">
              <span>
                Author:{' '}
                <strong className="font-semibold text-[var(--text-main)]">
                  {book.authorName}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>Published {formatReadableDate(book.publishAtIso)}</span>
              <span aria-hidden="true">·</span>
              <span>Updated {formatReadableDate(book.updatedAtIso)}</span>
            </div>

            {book.tags.length > 0 && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Topics: {book.tags.join(' · ')}
              </p>
            )}
          </div>
        </div>

        {/* Seamless Purchase & Sample Action Bar */}
        <DetailBuyCard item={book} />

        {/* Full Description */}
        <section aria-labelledby="book-description-heading" className="mt-8">
          <h2
            id="book-description-heading"
            className="text-lg font-bold text-[var(--text-main)] mb-3"
          >
            About This Book & Coverage
          </h2>
          <div className="text-sm sm:text-base leading-relaxed text-[var(--text-main)]">
            <div className="markdown-body space-y-3">
              <Markdown>
                {book.fullDescription ||
                  book.seoDescription ||
                  'Comprehensive digital study material curated for exam preparation.'}
              </Markdown>
            </div>
          </div>
        </section>

        {/* Shallow Cross-Taxonomy Related Links (<= 6 canonical links) */}
        {(siblingBooks.length > 0 || relatedExams.length > 0) && (
          <section
            aria-labelledby="related-resources-heading"
            className="mt-10 pt-8 border-t border-[var(--border-subtle)]"
          >
            <h2
              id="related-resources-heading"
              className="text-base font-bold text-[var(--text-main)] mb-4"
            >
              Related Books & Companion Exam Packs
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {siblingBooks.map((rel) => (
                <a
                  key={`rel-book-${rel.id}`}
                  href={`/books/${rel.urlSlug}`}
                  className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-transparent p-3.5 hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]/50 transition-colors"
                >
                  <MonogramThumbnail
                    title={rel.title}
                    type={rel.type}
                    collectionName="books"
                    size="sm"
                    showBadge={false}
                    className="w-12 h-12"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--text-main)] truncate">
                      {rel.title}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] tabular-nums">
                      {rel.type} ·{' '}
                      {rel.buyPrice === 0
                        ? 'Free'
                        : formatPrice(rel.buyPrice, rel.currency)}
                    </p>
                  </div>
                </a>
              ))}

              {relatedExams.map((relEx) => (
                <a
                  key={`rel-exam-${relEx.id}`}
                  href={`/exams/${relEx.urlSlug}`}
                  className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-transparent p-3.5 hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]/50 transition-colors"
                >
                  <MonogramThumbnail
                    title={relEx.title}
                    type={relEx.type}
                    collectionName="ExamPackDocument"
                    size="sm"
                    showBadge={false}
                    className="w-12 h-12"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--text-main)] truncate">
                      {relEx.title}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] tabular-nums">
                      {relEx.totalMocktest} Mock Tests ·{' '}
                      {relEx.buyPrice === 0
                        ? 'Free'
                        : formatPrice(relEx.buyPrice, relEx.currency)}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}
      </article>
    </div>
  );
}
