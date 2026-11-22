import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import React from 'react';
import { Star } from 'lucide-react';
import { DescriptionMarkdown } from '../../../components/editorial/description-markdown';
import { Breadcrumbs } from '../../../components/ui/breadcrumbs';
import { MonogramThumbnail } from '../../../components/ui/monogram-thumbnail';
import { DetailBuyCard } from '../../../features/catalog/detail-buy-card';
import { ItemReviewsSection } from '../../../features/reviews/item-reviews-section';
import { formatPrice } from '../../../lib/registry/content-type-registry';
import {
  buildBookDetailJsonLd,
  buildThumbUrls,
  getCanonicalOrigin,
  serializeSafeJsonLd,
} from '../../../lib/seo/schema';
import {
  getBookBySlug,
  getLiveBooks,
  getLiveExams,
} from '../../../server/repositories/catalog-repository';
import { getItemReviewsSummary } from '../../../server/repositories/review-repository';

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
  const origin = getCanonicalOrigin();
  const canonicalUrl = `${origin}/books/${book.urlSlug}`;
  const { sqPngUrl, ogPngUrl } = buildThumbUrls(
    'books',
    book.urlSlug,
    book.updatedAtIso
  );

  const description =
    book.seoDescription ||
    book.fullDescription.slice(0, 155) ||
    `${book.title} by ${book.authorName} on ExamDash.`;

  return {
    title: book.title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${book.title} | ExamDash`,
      description,
      type: 'book',
      url: canonicalUrl,
      images: [
        {
          url: ogPngUrl,
          width: 1200,
          height: 675,
          alt: book.title,
          type: 'image/png',
        },
        {
          url: sqPngUrl,
          width: 1200,
          height: 1200,
          alt: book.title,
          type: 'image/png',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${book.title} | ExamDash`,
      description,
      images: [ogPngUrl],
    },
  };
}

function formatReadableDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
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
  const reviewSummary = await getItemReviewsSummary('books', book.id);
  const jsonLd = serializeSafeJsonLd(buildBookDetailJsonLd(book, reviewSummary));

  // Up to 6 cross-taxonomy related <a href> links for shallow <= 3 click graph
  const siblingBooks = allBooks
    .filter((b) => b.urlSlug !== book.urlSlug)
    .slice(0, 4);
  const relatedExams = allExams.slice(0, 2);

  return (
    <div className="ed-container pt-8 sm:pt-10 pb-24 lg:pb-10">
      <script
        key={`book-jsonld-${book.id}`}
        type="application/ld+json"
        suppressHydrationWarning
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
        {/* Header Block (UI stays 100% zero-KB CSS/SVG MonogramThumbnail) */}
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
              {reviewSummary.reviewCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <a
                    href="#learner-reviews"
                    className="inline-flex items-center gap-1 font-semibold text-[var(--text-main)] hover:underline underline-offset-4"
                  >
                    <Star
                      className="w-3.5 h-3.5 fill-amber-400 text-amber-500 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{reviewSummary.averageRating.toFixed(1)}</span>
                    <span className="font-normal text-[var(--text-muted)]">
                      ({reviewSummary.reviewCount}{' '}
                      {reviewSummary.reviewCount === 1 ? 'review' : 'reviews'})
                    </span>
                  </a>
                </>
              )}
            </div>

            {book.tags.length > 0 && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Topics: {book.tags.join(' · ')}
              </p>
            )}
          </div>
        </div>

        {/* Primitive-Only Client Island (Zero fullDescription duplication in self.__next_f) */}
        <DetailBuyCard
          id={book.id}
          collectionName="books"
          title={book.title}
          urlSlug={book.urlSlug}
          currency={book.currency}
          buyPrice={book.buyPrice}
          listPrice={book.listPrice}
          samplePdfUrl={book.samplePdfUrl || undefined}
          sampleMarkdownUrl={book.sampleMarkdownUrl || undefined}
        />

        {/* Full Description (Server-Rendered, # -> <h2>, ## -> <h3>) */}
        <section aria-labelledby="book-description-heading" className="mt-8">
          <h2
            id="book-description-heading"
            className="text-lg font-bold text-[var(--text-main)] mb-3"
          >
            About This Book & Coverage
          </h2>
          <div className="text-sm sm:text-base leading-relaxed text-[var(--text-main)]">
            <DescriptionMarkdown
              markdown={
                book.fullDescription ||
                book.seoDescription ||
                'Comprehensive digital study material curated for exam preparation.'
              }
              heroTitle={book.title}
            />
          </div>
        </section>

        {/* Real Learner Ratings & Reviews (SSR-Hydrated + Capacitor-Ready API) */}
        <ItemReviewsSection
          key={`books_${book.id}`}
          collectionName="books"
          itemId={book.id}
          itemTitle={book.title}
          initialSummary={reviewSummary}
        />

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
