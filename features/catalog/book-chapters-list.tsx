'use client';

import React, { useCallback } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { requestOpenBookSample } from '../../lib/reader/sample-overlay-events';
import { prefetchBookSampleOnIntent } from '../../lib/reader/sample-stream-loader';
import { makeCompositeKey } from '../../lib/registry/content-type-registry';
import { useAuth } from '../auth/auth-provider';

export interface BookChaptersListProps {
  bookId: string;
  urlSlug: string;
  chapters: string[];
  hasSamplePdf?: boolean;
  hasSampleMarkdown?: boolean;
}

/**
 * Server-rendered chapter index for Book Details pages (placed directly above
 * "About This Book & Coverage"). Each row displays a circular filled sequence
 * serial number, the chapter title, and live ownership-aware lock status.
 *
 * SEO & Dwell-Time Protection:
 * - For non-owned visitors (and Googlebot SSR HTML), Chapter 1 opens the Same-DOM
 *   Sample Overlay directly on `/books/[urlSlug]` via a native `<button>`—never
 *   emitting `<a href="/read/...">` links that leak visitors off the canonical URL.
 * - For authenticated buyers who already own the book, unlocked chapters continue
 *   linking to their private `/read/[slug]` reader view.
 */
export function BookChaptersList({
  bookId,
  urlSlug,
  chapters,
  hasSamplePdf = false,
  hasSampleMarkdown = false,
}: BookChaptersListProps) {
  const { ownedCompositeKeys } = useAuth();

  const hasAnySample = hasSamplePdf || hasSampleMarkdown;
  const preferredSampleFormat: 'pdf' | 'markdown' = hasSamplePdf
    ? 'pdf'
    : 'markdown';

  const handlePrefetchSample = useCallback(() => {
    if (!hasAnySample) return;
    prefetchBookSampleOnIntent({
      urlSlug,
      preferredFormat: preferredSampleFormat,
    });
  }, [hasAnySample, preferredSampleFormat, urlSlug]);

  if (!chapters || chapters.length === 0) {
    return null;
  }

  const isOwned = ownedCompositeKeys.has(makeCompositeKey('books', bookId));
  const fullReaderHref = `/read/${urlSlug}`;

  return (
    <section
      aria-labelledby="book-chapters-heading"
      className="mt-8 max-md:mt-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3 max-md:mb-2">
        <h2
          id="book-chapters-heading"
          className="text-lg max-md:text-base font-bold text-[var(--text-main)]"
        >
          Book Chapters
        </h2>
        <p className="text-xs text-[var(--text-muted)] tabular-nums">
          {chapters.length} {chapters.length === 1 ? 'Chapter' : 'Chapters'}
          {isOwned
            ? ' · Unlocked in Library'
            : hasAnySample
            ? ' · Chapter 1 Free Sample'
            : ''}
        </p>
      </div>

      <ol className="border-y border-[var(--border-subtle)] bg-[var(--bg-canvas)] divide-y divide-[var(--border-subtle)]">
        {chapters.map((chapterTitle, index) => {
          const isFirstChapter = index === 0;
          const canOpenInlineSample = !isOwned && isFirstChapter && hasAnySample;
          const isUnlocked = isOwned || canOpenInlineSample;

          const rowContent = (
            <>
              {/* Circular filled sequence serial number */}
              <span
                aria-hidden="true"
                className="w-7 h-7 sm:w-8 sm:h-8 max-md:w-6 max-md:h-6 rounded-full bg-[#b2b2b2] text-[var(--brand-primary-ink)] inline-flex items-center justify-center shrink-0 text-xs max-md:text-[11px] font-bold tabular-nums"
              >
                {index + 1}
              </span>

              {/* Chapter Title */}
              <span
                className={
                  isUnlocked
                    ? 'flex-1 min-w-0 text-sm sm:text-[15px] font-medium text-[var(--text-main)] leading-snug break-words group-hover:underline underline-offset-4'
                    : 'flex-1 min-w-0 text-sm sm:text-[15px] font-medium text-[var(--text-main)] leading-snug break-words'
                }
              >
                {chapterTitle}
              </span>

              {/* Ownership-aware Lock Status */}
              {isUnlocked ? (
                <span
                  className="inline-flex items-center justify-center shrink-0 text-[var(--status-success)]"
                  aria-label={
                    canOpenInlineSample
                      ? 'Chapter 1 unlocked, open free sample preview'
                      : 'Chapter unlocked'
                  }
                  title="Unlocked"
                >
                  <LockOpen
                    className="w-3.5 h-3.5 shrink-0 text-[#0f766e] [&>rect]:fill-[#0f766e]"
                    aria-hidden="true"
                  />
                </span>
              ) : (
                <span
                  className="inline-flex items-center justify-center shrink-0 text-[var(--text-muted)]"
                  aria-label="Chapter locked"
                  title="Locked"
                >
                  <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                </span>
              )}
            </>
          );

          if (canOpenInlineSample) {
            return (
              <li key={`chapter-${index + 1}`}>
                <button
                  type="button"
                  onPointerEnter={handlePrefetchSample}
                  onTouchStart={handlePrefetchSample}
                  onFocus={handlePrefetchSample}
                  onClick={() =>
                    requestOpenBookSample({
                      bookId,
                      format: preferredSampleFormat,
                      triggerSource: 'chapter_list',
                    })
                  }
                  aria-haspopup="dialog"
                  className="group w-full text-start flex items-center gap-3.5 sm:gap-4 px-2 sm:px-3 py-3.5 max-md:gap-2.5 max-md:px-0.5 max-md:py-2.5 min-h-[48px] hover:bg-[var(--bg-elevated)]/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-primary)]"
                >
                  {rowContent}
                </button>
              </li>
            );
          }

          if (isOwned) {
            return (
              <li key={`chapter-${index + 1}`}>
                <a
                  href={fullReaderHref}
                  rel="nofollow"
                  className="group flex items-center gap-3.5 sm:gap-4 px-2 sm:px-3 py-3.5 max-md:gap-2.5 max-md:px-0.5 max-md:py-2.5 min-h-[48px] hover:bg-[var(--bg-elevated)]/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-primary)]"
                >
                  {rowContent}
                </a>
              </li>
            );
          }

          return (
            <li
              key={`chapter-${index + 1}`}
              className="flex items-center gap-3.5 sm:gap-4 px-2 sm:px-3 py-3.5 max-md:gap-2.5 max-md:px-0.5 max-md:py-2.5 min-h-[48px]"
            >
              {rowContent}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
