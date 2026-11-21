import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import React from 'react';
import Markdown from 'react-markdown';
import {
  getExamBySlug,
  getLiveBooks,
  getLiveExams,
} from '../../../server/repositories/catalog-repository';
import { Breadcrumbs } from '../../../components/ui/breadcrumbs';
import { MonogramThumbnail } from '../../../components/ui/monogram-thumbnail';
import { DetailBuyCard } from '../../../features/catalog/detail-buy-card';
import { SyllabusTable } from '../../../features/catalog/syllabus-table';
import {
  buildExamDetailJsonLd,
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
  const lookup = await getExamBySlug(urlSlug);

  if (lookup.status !== 'ok') {
    notFound();
  }

  const exam = lookup.data;
  const description =
    exam.seoDescription ||
    exam.fullDescription.slice(0, 155) ||
    `${exam.title} (${exam.totalMocktest} Mock Tests) on ExamDash.`;

  return {
    title: exam.title,
    description,
    alternates: {
      canonical: `/exams/${exam.urlSlug}`,
    },
    openGraph: {
      title: `${exam.title} | ExamDash`,
      description,
      type: 'website',
      url: `/exams/${exam.urlSlug}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${exam.title} | ExamDash`,
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

export default async function ExamDetailPage({
  params,
}: {
  params: Promise<{ urlSlug: string }>;
}) {
  const { urlSlug } = await params;
  const [lookup, allExams, allBooks] = await Promise.all([
    getExamBySlug(urlSlug),
    getLiveExams(),
    getLiveBooks(),
  ]);

  if (lookup.status !== 'ok') {
    notFound();
  }

  const exam = lookup.data;
  const jsonLd = serializeSafeJsonLd(buildExamDetailJsonLd(exam));

  const siblingExams = allExams
    .filter((e) => e.urlSlug !== exam.urlSlug)
    .slice(0, 3);
  const companionBooks = allBooks.slice(0, 3);

  const totalQuestionsSum = exam.MocktestTitles.reduce(
    (acc, m) => acc + m.totalQuestions,
    0
  );
  const totalMarksSum = exam.MocktestTitles.reduce(
    (acc, m) => acc + m.totalMarks,
    0
  );

  return (
    <div className="ed-container py-8 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />

      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Exams', href: '/exams' },
          { label: exam.title },
        ]}
      />

      <article className="w-full">
        {/* Header Block */}
        <div className="flex flex-col sm:flex-row items-start gap-5 pb-6 border-b border-[var(--border-subtle)]">
          <MonogramThumbnail
            title={exam.title}
            type={exam.type}
            collectionName="ExamPackDocument"
            size="lg"
            className="w-28 h-28 sm:w-32 sm:h-32 shrink-0"
          />

          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-[var(--text-muted)]">
              {exam.type} · {exam.language} · Published by {exam.publisher}
            </p>
            <h1 className="mt-1.5 text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)] leading-tight text-balance">
              {exam.title}
            </h1>

            {exam.seoDescription && (
              <p className="mt-2.5 text-base text-[var(--text-muted)] leading-relaxed">
                {exam.seoDescription}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--text-muted)] tabular-nums">
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
            </div>

            {exam.tags.length > 0 && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Topics: {exam.tags.join(' · ')}
              </p>
            )}
          </div>
        </div>

        {/* Seamless Purchase & Sample Action Bar */}
        <DetailBuyCard item={exam} />

        {/* Sortable MocktestTitles Syllabus Table */}
        <SyllabusTable
          items={exam.MocktestTitles}
          totalMocktest={exam.totalMocktest}
          examSlug={exam.urlSlug}
          examId={exam.id}
          buyPrice={exam.buyPrice}
          hasSample={Boolean(exam.sampleJsonStoragePath)}
        />

        {/* Full Description */}
        <section aria-labelledby="exam-description-heading" className="mt-10">
          <h2
            id="exam-description-heading"
            className="text-lg font-bold text-[var(--text-main)] mb-3"
          >
            Exam Series Overview & Instructions
          </h2>
          <div className="text-sm sm:text-base leading-relaxed text-[var(--text-main)]">
            <div className="markdown-body space-y-3">
              <Markdown>
                {exam.fullDescription ||
                  exam.seoDescription ||
                  'Full-length mock test pack aligned with latest exam pattern.'}
              </Markdown>
            </div>
          </div>
        </section>

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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {companionBooks.map((b) => (
                <a
                  key={`comp-book-${b.id}`}
                  href={`/books/${b.urlSlug}`}
                  className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-transparent p-3.5 hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]/50 transition-colors"
                >
                  <MonogramThumbnail
                    title={b.title}
                    type={b.type}
                    collectionName="books"
                    size="sm"
                    showBadge={false}
                    className="w-12 h-12"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--text-main)] truncate">
                      {b.title}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] tabular-nums">
                      {b.type} ·{' '}
                      {b.buyPrice === 0
                        ? 'Free'
                        : formatPrice(b.buyPrice, b.currency)}
                    </p>
                  </div>
                </a>
              ))}

              {siblingExams.map((ex) => (
                <a
                  key={`sib-exam-${ex.id}`}
                  href={`/exams/${ex.urlSlug}`}
                  className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-transparent p-3.5 hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]/50 transition-colors"
                >
                  <MonogramThumbnail
                    title={ex.title}
                    type={ex.type}
                    collectionName="ExamPackDocument"
                    size="sm"
                    showBadge={false}
                    className="w-12 h-12"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--text-main)] truncate">
                      {ex.title}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] tabular-nums">
                      {ex.totalMocktest} Mock Tests ·{' '}
                      {ex.buyPrice === 0
                        ? 'Free'
                        : formatPrice(ex.buyPrice, ex.currency)}
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
