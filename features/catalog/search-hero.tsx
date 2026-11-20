'use client';

import React from 'react';
import { Search } from 'lucide-react';
import { useSearchModal } from '../search/command-search-modal';
import { InstallAppCallout } from '../pwa/install-banner';

export function SearchHero({
  bookCount,
  examCount,
}: {
  bookCount: number;
  examCount: number;
}) {
  const { openSearch } = useSearchModal();

  return (
    <section className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] py-10 sm:py-14">
      <div className="ed-container">
        <div className="max-w-3xl">
          <h1 className="text-[length:var(--text-hero)] font-extrabold tracking-tight text-[var(--text-main)] leading-[1.15] text-balance">
            Verified Books, Question Banks & Full-Length Mock Exam Packs
          </h1>
          <p className="mt-3 text-base text-[var(--text-muted)] leading-relaxed max-w-2xl">
            Explore {bookCount} structured study {bookCount === 1 ? 'book' : 'books'} and{' '}
            {examCount} timed {examCount === 1 ? 'exam pack' : 'exam packs'} with instant sample previews, transparent syllabus breakdowns, and unified library access.
          </p>

          {/* Prominent Cmd+K Search Trigger */}
          <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              type="button"
              onClick={() => openSearch()}
              className="flex-1 flex items-center justify-between gap-3 min-h-[52px] px-4 rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-left text-sm text-[var(--text-muted)] hover:border-[var(--brand-primary)] transition-colors"
            >
              <span className="flex items-center gap-3 truncate">
                <Search
                  className="w-4 h-4 text-[var(--text-main)] shrink-0"
                  aria-hidden="true"
                />
                <span className="truncate">
                  Search titles, authors, exam series, or subject tags...
                </span>
              </span>
              <kbd className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] font-mono text-xs text-[var(--text-muted)] shrink-0">
                ⌘K
              </kbd>
            </button>

            <a
              href="#books-catalog"
              className="inline-flex items-center justify-center min-h-[52px] px-6 rounded-[var(--radius-card)] bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
            >
              Browse Catalog
            </a>
          </div>

          {/* Dismissible PWA Install Banner */}
          <InstallAppCallout />
        </div>
      </div>
    </section>
  );
}
