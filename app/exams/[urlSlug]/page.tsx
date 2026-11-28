import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import React, { cache } from 'react';
import { Star } from 'lucide-react';
import { DescriptionMarkdown } from '../../../components/editorial/description-markdown';
import { Breadcrumbs } from '../../../components/ui/breadcrumbs';
import { CatalogThumbnail } from '../../../components/ui/catalog-thumbnail';
import { DetailBuyCard } from '../../../features/catalog/detail-buy-card';
import { SyllabusTable } from '../../../features/catalog/syllabus-table';
import { ItemReviewsSection } from '../../../features/reviews/item-reviews-section';
import { formatPrice } from '../../../lib/registry/content-type-registry';
import { getDefaultCatalogPricing } from '../../../lib/validity/pricing';
import {
  buildCanonicalAlternates,
  buildExamDetailJsonLd,
  buildSiteOgUrl,
  getCanonicalOrigin,
  serializeSafeJsonLd,
} from '../../../lib/seo/schema';
import {
  getCachedExamBySlug,
  getCachedItemReviewsSummary,
  getCachedLiveBooksPage,
  getCachedLiveExamsPage,
} from '../../../server/cache/catalog-cache';

export const dynamicParams = true;
export const revalidate = 60;

export async function generateStaticParams() {
  return [];
}

const loadExamBySlug = cache(async (slug: string) => getCachedExamBySlug(slug));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ urlSlug: string }>;
}): Promise<Metadata> {
  const { urlSlug } = await params;
  const lookup = await loadExamBySlug(urlSlug);

  if (lookup.status !== 'ok') {
    notFound();
  }

  const exam = lookup.data;
  const origin = getCanonicalOrigin();
  const encodedSlug = encodeURIComponent(exam.urlSlug);
  const canonicalUrl = `${origin}/exams/${encodedSlug}`;
  const coverUrl = exam.imageUrl || buildSiteOgUrl();
  const coverAlt = exam.imageMeta?.alt || `${exam.title} exam pack cover`;

  const description =
    exam.seoDescription ||
    exam.imageMeta?.description ||
    exam.fullDescription.slice(0, 155) ||
    `${exam.title} (${exam.totalMocktest} Mock Tests) on ExamDash.`;

  return {
    title: exam.title,
    description,
    alternates: buildCanonicalAlternates(`/exams/${encodedSlug}`),
    openGraph: {
      title: exam.imageMeta?.title || `${exam.title} | ExamDash`,
      description,
      type: 'website',
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
      title: exam.imageMeta?.title || `${exam.title} | ExamDash`,
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

export default async function ExamDetailPage({
  params,
}: {
  params: Promise<{ urlSlug: string }>;
}) {
  const { urlSlug } = await params;
  const [lookup, examsSample, booksSample] = await Promise.all([
    loadExamBySlug(urlSlug),
    getCachedLiveExamsPage({ limit: 4, offset: 0 }).catch(() => ({
      items: [],
      hasMore: false,
      nextOffset: 0,
    })),
    getCachedLiveBooksPage({ limit: 3, offset: 0 }).catch(() => ({
      items: [],
      hasMore: false,
      nextOffset: 0,
    })),
  ]);

  if (lookup.status !== 'ok') {
    notFound();
  }

  const exam = lookup.data;
  const reviewSummary = await getCachedItemReviewsSummary('ExamPackDocument', exam.id);
  const jsonLd = serializeSafeJsonLd(buildExamDetailJsonLd(exam, reviewSummary));

  const siblingExams = examsSample.items
    .filter((e) => e.urlSlug !== exam.urlSlug)
    .slice(0, 3);
  const companionBooks = booksSample.items.slice(0, 3);

  const totalQuestionsSum = exam.MocktestTitles.reduce(
    (acc, m) => acc + m.totalQuestions,
    0
  );
  const totalMarksSum = exam.MocktestTitles.reduce(
    (acc, m) => acc + m.totalMarks,
    0
  );

  const firstExamSetId = exam.MocktestTitles[0]?.id || 'exam_set_1';
  const sampleTrialHref = exam.sampleJsonStoragePath
    ? `/attempt/${exam.urlSlug}/${encodeURIComponent(firstExamSetId)}?mode=trial`
    : undefined;

  return (
    <div className="ed-container pt-8 sm:pt-10 max-md:pt-4 pb-24 max-md:pb-4 lg:pb-10">
      <script
        key={`exam-jsonld-${exam.id}`}
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />

      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Exams', href: '/exams' },
          { label: exam.title },
        ]}
      />

      <article className="w-full min-w-0">
        {/* Header Block: Side-by-Side 4:3 Cover Thumbnail (Left) + Title (Right) on All Screens */}
        <div className="flex flex-row items-center gap-4 sm:gap-6 max-md:gap-3.5 pb-5 max-md:pb-4 border-b border-[var(--border-subtle)]">
          <figure className="shrink-0">
            <CatalogThumbnail
              title={exam.title}
              collectionName="ExamPackDocument"
              imageUrl={exam.imageUrl}
              imageAlt={exam.imageMeta?.alt}
              imageTitle={exam.imageMeta?.title}
              size="lg"
              priority
            />
            {exam.imageMeta?.caption && (
              <figcaption className="sr-only">
                {exam.imageMeta.caption}
              </figcaption>
            )}
          </figure>

          <div className="min-w-0 flex-1">
            <h1 className="text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)] leading-tight text-balance break-words">
              {exam.title}
            </h1>
            <p className="mt-1.5 max-md:mt-1 text-xs font-medium text-[var(--text-muted)] break-words">
              {exam.type} · {exam.language} · Published by {exam.publisher}
            </p>
          </div>
        </div>

        {/* Primitive-Only Client Island (Zero fullDescription duplication in self.__next_f) */}
        <DetailBuyCard
          id={exam.id}
          collectionName="ExamPackDocument"
          title={exam.title}
          urlSlug={exam.urlSlug}
          type={exam.type}
          authorName={exam.authorName}
          language={exam.language}
          totalMocktest={exam.totalMocktest}
          currency={exam.currency}
          buyPrice={exam.buyPrice}
          listPrice={exam.listPrice}
          imageUrl={exam.imageUrl || undefined}
          imageAlt={exam.imageMeta?.alt || undefined}
          sampleJsonUrl={sampleTrialHref}
        />

        {/* Summary below Install App Banner */}
        {exam.seoDescription && (
          <div className="mt-5 max-md:mt-4 pb-5 max-md:pb-4 border-b border-[var(--border-subtle)]">
            <p className="text-base max-md:text-sm text-[var(--text-muted)] leading-relaxed break-words">
              {exam.seoDescription}
            </p>
          </div>
        )}

        {/* Sortable MocktestTitles Syllabus Table */}
        <SyllabusTable
          items={exam.MocktestTitles}
          totalMocktest={exam.totalMocktest}
          hasSample={Boolean(exam.sampleJsonStoragePath)}
        />

        {/* Full Description (Server-Rendered, # -> <h2>, ## -> <h3>) */}
        <section aria-labelledby="exam-description-heading" className="mt-10 max-md:mt-7">
          <h2
            id="exam-description-heading"
            className="text-lg max-md:text-base font-bold text-[var(--text-main)] mb-3 max-md:mb-2.5"
          >
            Exam Series Overview & Instructions
          </h2>
          <div className="text-sm sm:text-base leading-relaxed text-[var(--text-main)]">
            <DescriptionMarkdown
              markdown={
                exam.fullDescription ||
                exam.seoDescription ||
                'Full-length mock test pack aligned with latest exam pattern.'
              }
              heroTitle={exam.title}
            />
          </div>
        </section>

        {/* Faculty, Stats Metadata & Topics placed just above Ratings & Learner Reviews */}
        <div className="mt-7 pt-5 max-md:mt-5 max-md:pt-4 border-t border-[var(--border-subtle)]">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--text-muted)] tabular-nums">
            <span>
              Faculty:{' '}
              <strong className="font-semibold text-[var(--text-main)]">
                {exam.authorName}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong className="font-semibold text-[var(--text-main)]">
                {exam.totalMocktest}
              </strong>{' '}
              Mock {exam.totalMocktest === 1 ? 'Test' : 'Tests'}
            </span>
            {totalQuestionsSum > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{totalQuestionsSum} Questions</span>
              </>
            )}
            {totalMarksSum > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{totalMarksSum} Marks</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>Updated {formatReadableDate(exam.updatedAtIso)}</span>
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

          {exam.tags.length > 0 && (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Topics: {exam.tags.join(' · ')}
            </p>
          )}
        </div>

        {/* Real Learner Ratings & Reviews (SSR-Hydrated + Capacitor-Ready API) */}
        <ItemReviewsSection
          key={`ExamPackDocument_${exam.id}`}
          collectionName="ExamPackDocument"
          itemId={exam.id}
          itemTitle={exam.title}
          initialSummary={reviewSummary}
        />

        {/* Shallow Cross-Taxonomy Related Links (<= 6 canonical links) */}
        {(siblingExams.length > 0 || companionBooks.length > 0) && (
          <section
            aria-labelledby="related-exam-links-heading"
            className="mt-10 pt-8 border-t border-[var(--border-subtle)]"
          >
            <h2
              id="related-exam-links-heading"
              className="text-base font-bold text-[var(--text-main)] mb-4"
            >
              Companion Study Books & Related Series
            </h2>
            <div className="flex flex-col gap-2.5">
              {companionBooks.map((b) => {
                const relPricing = getDefaultCatalogPricing('books', b.buyPrice);
                return (
                  <a
                    key={`comp-book-${b.id}`}
                    href={`/books/${b.urlSlug}`}
                    className="flex items-center gap-3.5 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 hover:border-[var(--border-strong)] transition-colors"
                  >
                    <CatalogThumbnail
                      title={b.title}
                      collectionName="books"
                      imageUrl={b.imageUrl}
                      imageAlt={b.imageMeta?.alt}
                      imageTitle={b.imageMeta?.title}
                      size="xs"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--text-main)] truncate">
                        {b.title}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] tabular-nums">
                        {b.type} ·{' '}
                        {relPricing.isFree
                          ? 'Free'
                          : formatPrice(relPricing.discountedPrice, b.currency)}
                        {relPricing.discountPct > 0
                          ? ` (${relPricing.discountPct}% OFF)`
                          : ''}
                      </p>
                    </div>
                  </a>
                );
              })}

              {siblingExams.map((ex) => {
                const relPricing = getDefaultCatalogPricing(
                  'ExamPackDocument',
                  ex.buyPrice
                );
                return (
                  <a
                    key={`sib-exam-${ex.id}`}
                    href={`/exams/${ex.urlSlug}`}
                    className="flex items-center gap-3.5 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 hover:border-[var(--border-strong)] transition-colors"
                  >
                    <CatalogThumbnail
                      title={ex.title}
                      collectionName="ExamPackDocument"
                      imageUrl={ex.imageUrl}
                      imageAlt={ex.imageMeta?.alt}
                      imageTitle={ex.imageMeta?.title}
                      size="xs"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--text-main)] truncate">
                        {ex.title}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] tabular-nums">
                        {ex.totalMocktest} Mock Tests ·{' '}
                        {relPricing.isFree
                          ? 'Free'
                          : formatPrice(relPricing.discountedPrice, ex.currency)}
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
