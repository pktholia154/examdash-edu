'use client';

import React from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { makeCompositeKey } from '../../lib/registry/content-type-registry';
import { useAuth } from '../auth/auth-provider';

export interface BookChaptersListProps {
  bookId: string;
  urlSlug: string;
  chapters: string[];
}

/**
 * Server-rendered chapter index for Book Details pages (placed directly above
 * "About This Book & Coverage"). Each row displays a circular filled sequence
 * serial number, the chapter title, and live ownership-aware lock status.
 * Chapter 1 is always unlocked and links directly to the sample reader view.
 */
export function BookChaptersList({
  bookId,
  urlSlug,
  chapters,
}: BookChaptersListProps) {
  const { ownedCompositeKeys } = useAuth();

  if (!chapters || chapters.length === 0) {
    return null;
  }

  const isOwned = ownedCompositeKeys.has(makeCompositeKey('books', bookId));
  const sampleHref = `/read/${urlSlug}?mode=sample`;

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
          {chapters.length} {chapters.length === 1 ? 'Chapter' : 'Chapters'} ·{' '}
          {isOwned ? 'Unlocked in Library' : 'Chapter 1 Free Sample'}
        </p>
      </div>

      <ol className="border-y border-[var(--border-subtle)] bg-[var(--bg-canvas)] divide-y divide-[var(--border-subtle)]">
        {chapters.map((chapterTitle, index) => {
          const isFirstChapter = index === 0;
          const isUnlocked = isFirstChapter || isOwned;

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
                  isFirstChapter
                    ? 'flex-1 min-w-0 text-sm sm:text-[15px] font-medium text-[var(--text-main)] leading-snug break-words group-hover:underline underline-offset-4'
                    : 'flex-1 min-w-0 text-sm sm:text-[15px] font-medium text-[var(--text-main)] leading-snug break-words'
                }
              >
                {chapterTitle}
              </span>

              {/* Ownership-aware Lock Status */}
              {isUnlocked ? (
                <span
                  className="inline-flex items-center gap-1.5 shrink-0 text-xs font-semibold text-[var(--status-success)]"
                  aria-label={
                    isFirstChapter
                      ? 'Chapter 1 unlocked, open sample view'
                      : 'Chapter unlocked'
                  }
                >
                  <LockOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Unlocked</span>
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

          if (isFirstChapter) {
            return (
              <li key={`chapter-${index + 1}`}>
                <a
                  href={sampleHref}
                  rel="nofollow"
                  className="group flex items-center gap-3.5 sm:gap-4 px-2 sm:px-3 py-3.5 max-md:gap-2.5 max-md:px-0.5 max-md:py-2.5 min-h-[44px] hover:bg-[var(--bg-elevated)]/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-primary)]"
                >
                  {rowContent}
                </a>
              </li>
            );
          }

          return (
            <li
              key={`chapter-${index + 1}`}
              className="flex items-center gap-3.5 sm:gap-4 px-2 sm:px-3 py-3.5 max-md:gap-2.5 max-md:px-0.5 max-md:py-2.5"
            >
              {rowContent}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
