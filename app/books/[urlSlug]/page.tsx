import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import React, { cache } from 'react';
import { Star } from 'lucide-react';
import { DescriptionMarkdown } from '../../../components/editorial/description-markdown';
import { Breadcrumbs } from '../../../components/ui/breadcrumbs';
import { CatalogThumbnail } from '../../../components/ui/catalog-thumbnail';
import { BookChaptersList } from '../../../features/catalog/book-chapters-list';
import { DetailBuyCard } from '../../../features/catalog/detail-buy-card';
import { ItemReviewsSection } from '../../../features/reviews/item-reviews-section';
import { formatPrice } from '../../../lib/registry/content-type-registry';
import { getDefaultCatalogPricing } from '../../../lib/validity/pricing';
import {
  buildBookDetailJsonLd,
  buildCanonicalAlternates,
  buildSiteOgUrl,
  getCanonicalOrigin,
  serializeSafeJsonLd,
} from '../../../lib/seo/schema';
import {
  getBookBySlug,
  getLiveBooksPage,
  getLiveExamsPage,
} from '../../../server/repositories/catalog-repository';
import { getItemReviewsSummary } from '../../../server/repositories/review-repository';

export const dynamic = 'force-dynamic';

const loadBookBySlug = cache(async (slug: string) => getBookBySlug(slug));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ urlSlug: string }>;
}): Promise<Metadata> {
  const { urlSlug } = await params;
  const lookup = await loadBookBySlug(urlSlug);

  if (lookup.status !== 'ok') {
    notFound();
  }

  const book = lookup.data;
  const origin = getCanonicalOrigin();
  const canonicalUrl = `${origin}/books/${book.urlSlug}`;
  const coverUrl = book.imageUrl || buildSiteOgUrl();
  const coverAlt = book.imageMeta?.alt || `${book.title} book cover`;

  const description =
    book.seoDescription ||
    book.imageMeta?.description ||
    book.fullDescription.slice(0, 155) ||
    `${book.title} by ${book.authorName} on ExamDash.`;

  const seoKeywords = book.imageMeta?.keywords
    ? book.imageMeta.keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : book.tags.length > 0
    ? book.tags
    : undefined;

  return {
    title: book.title,
    description,
    ...(seoKeywords ? { keywords: seoKeywords } : {}),
    alternates: buildCanonicalAlternates(`/books/${book.urlSlug}`),
    openGraph: {
      title: book.imageMeta?.title || `${book.title} | ExamDash`,
      description,
      type: 'book',
      url: canonicalUrl,
      images: [
        {
          url: coverUrl,
          alt: coverAlt,
          type: 'image/png',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: book.imageMeta?.title || `${book.title} | ExamDash`,
      description,
      images: [
        {
          url: coverUrl,
          alt: coverAlt,
        },
      ],
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
  const [lookup, booksSample, examsSample] = await Promise.all([
    loadBookBySlug(urlSlug),
    getLiveBooksPage({ limit: 5, offset: 0 }).catch(() => ({
      items: [],
      hasMore: false,
      nextOffset: 0,
    })),
    getLiveExamsPage({ limit: 2, offset: 0 }).catch(() => ({
      items: [],
      hasMore: false,
      nextOffset: 0,
    })),
  ]);

  if (lookup.status !== 'ok') {
    notFound();
  }

  const book = lookup.data;
  const reviewSummary = await getItemReviewsSummary('books', book.id);
  const jsonLd = serializeSafeJsonLd(buildBookDetailJsonLd(book, reviewSummary));

  // Up to 6 cross-taxonomy related <a href> links using bounded card reads (O(1) Firestore FinOps)
  const siblingBooks = booksSample.items
    .filter((b) => b.urlSlug !== book.urlSlug)
    .slice(0, 4);
  const relatedExams = examsSample.items.slice(0, 2);

  return (
    <div className="ed-container pt-8 sm:pt-10 max-md:pt-4 pb-24 max-md:pb-4 lg:pb-10">
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

      <article className="w-full min-w-0">
        {/* Header Block: Side-by-Side 4:3 Cover Thumbnail (Left) + Title (Right) on All Screens */}
        <div className="flex flex-row items-center gap-4 sm:gap-6 max-md:gap-3.5 pb-5 max-md:pb-4 border-b border-[var(--border-subtle)]">
          <figure className="shrink-0">
            <CatalogThumbnail
              title={book.title}
              collectionName="books"
              imageUrl={book.imageUrl}
              imageMeta={book.imageMeta}
              size="lg"
              priority
            />
            {book.imageMeta?.caption && (
              <figcaption className="sr-only">
                {book.imageMeta.caption}
              </figcaption>
            )}
          </figure>

          <div className="min-w-0 flex-1">
            <h1 className="text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)] leading-tight text-balance break-words">
              {book.title}
            </h1>
            <p className="mt-1.5 max-md:mt-1 text-xs font-medium text-[var(--text-muted)] break-words">
              {book.type} · {book.language} · Published by {book.publisher}
            </p>
          </div>
        </div>

        {/* Primitive-Only Client Island (Zero fullDescription duplication in self.__next_f) */}
        <DetailBuyCard
          id={book.id}
          collectionName="books"
          title={book.title}
          urlSlug={book.urlSlug}
          type={book.type}
          authorName={book.authorName}
          language={book.language}
          currency={book.currency}
          buyPrice={book.buyPrice}
          listPrice={book.listPrice}
          imageUrl={book.imageUrl || undefined}
          imageAlt={book.imageMeta?.alt || undefined}
          samplePdfUrl={book.samplePdfUrl || undefined}
          sampleMarkdownUrl={book.sampleMarkdownUrl || undefined}
        />

        {/* Summary below Install App Banner */}
        {book.seoDescription && (
          <div className="mt-5 max-md:mt-4 pb-5 max-md:pb-4 border-b border-[var(--border-subtle)]">
            <p className="text-base max-md:text-sm text-[var(--text-muted)] leading-relaxed break-words">
              {book.seoDescription}
            </p>
          </div>
        )}

        {/* Book Chapters List directly above About This Book & Coverage */}
        <BookChaptersList
          bookId={book.id}
          urlSlug={book.urlSlug}
          chapters={book.bookChapters}
        />

        {/* Full Description (Server-Rendered, # -> <h2>, ## -> <h3>) */}
        <section aria-labelledby="book-description-heading" className="mt-8 max-md:mt-6">
          <h2
            id="book-description-heading"
            className="text-lg max-md:text-base font-bold text-[var(--text-main)] mb-3 max-md:mb-2.5"
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

        {/* Author, Date Metadata & Topics placed just above Ratings & Learner Reviews */}
        <div className="mt-7 pt-5 max-md:mt-5 max-md:pt-4 border-t border-[var(--border-subtle)]">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--text-muted)] tabular-nums">
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
            {reviewSummary.reviewCount > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <a
                  href="#learner-reviews"
                  className="inline-flex items-center gap-1 font-semibold text-[var(--text-main)] hover:underline underline-offset-4"
                >
                  <Star
                    className="w-3.5 h-3.5 fill-[var(--status-warning)] text-[var(--status-warning)] shrink-0"
                    aria-hidden="true"
                  />
                  <span>{reviewSummary.averageRating.toFixed(1)}</span>
                  <span className="font-normal text-[var(--text-muted)]">
                    ({reviewSummary.reviewCount}{' '}
                    {reviewSummary.reviewCount === 1 ? 'review' : 'reviews'})
                  </span>
                </a>
              </>
            ) : (
              <>
                <span aria-hidden="true">·</span>
                <a
                  href="#write-review"
                  className="font-medium text-[var(--text-main)] hover:underline underline-offset-4"
                >
                  Write the first review
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
            <div className="flex flex-col gap-2.5">
              {siblingBooks.map((rel) => {
                const relPricing = getDefaultCatalogPricing('books', rel.buyPrice);
                return (
                  <a
                    key={`rel-book-${rel.id}`}
                    href={`/books/${rel.urlSlug}`}
                    className="flex items-center gap-3.5 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 hover:border-[var(--border-strong)] transition-colors"
                  >
                    <CatalogThumbnail
                      title={rel.title}
                      collectionName="books"
                      imageUrl={rel.imageUrl}
                      imageMeta={rel.imageMeta}
                      size="xs"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--text-main)] truncate">
                        {rel.title}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] tabular-nums">
                        {rel.type} ·{' '}
                        {relPricing.isFree
                          ? 'Free'
                          : formatPrice(relPricing.discountedPrice, rel.currency)}
                        {relPricing.discountPct > 0
                          ? ` (${relPricing.discountPct}% OFF)`
                          : ''}
                      </p>
                    </div>
                  </a>
                );
              })}

              {relatedExams.map((relEx) => {
                const relPricing = getDefaultCatalogPricing(
                  'ExamPackDocument',
                  relEx.buyPrice
                );
                return (
                  <a
                    key={`rel-exam-${relEx.id}`}
                    href={`/exams/${relEx.urlSlug}`}
                    className="flex items-center gap-3.5 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 hover:border-[var(--border-strong)] transition-colors"
                  >
                    <CatalogThumbnail
                      title={relEx.title}
                      collectionName="ExamPackDocument"
                      imageUrl={relEx.imageUrl}
                      imageMeta={relEx.imageMeta}
                      size="xs"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--text-main)] truncate">
                        {relEx.title}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] tabular-nums">
                        {relEx.totalMocktest} Mock Tests ·{' '}
                        {relPricing.isFree
                          ? 'Free'
                          : formatPrice(relPricing.discountedPrice, relEx.currency)}
                        {relPricing.discountPct > 0
                          ? ` (${relPricing.discountPct}% OFF)`
                          : ''}
                      </p>
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        )}
      </article>
    </div>
  );
}
