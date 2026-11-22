'use client';

import React from 'react';
import { Search } from 'lucide-react';
import { useSearchModal } from '../search/command-search-modal';

export function HomeSearchBar({
  bookCount,
  examCount,
}: {
  bookCount: number;
  examCount: number;
}) {
  const { openSearch } = useSearchModal();

  return (
    <button
      type="button"
      onClick={() => openSearch()}
      aria-label="Search books, question banks, and mock exam packs"
      className="w-full flex items-center justify-between gap-3 min-h-[52px] px-4 rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface)] text-left text-sm text-[var(--text-muted)] shadow-[var(--shadow-card)] hover:border-[var(--brand-primary)] transition-colors"
    >
      <span className="flex items-center gap-3 min-w-0">
        <Search
          className="w-4 h-4 text-[var(--text-main)] shrink-0"
          aria-hidden="true"
        />
        <span className="truncate">
          Search books, question banks, mock exam packs, or authors...
        </span>
      </span>

      <span className="flex items-center gap-2.5 shrink-0">
        {(bookCount > 0 || examCount > 0) && (
          <span className="hidden md:inline text-xs text-[var(--text-muted)] tabular-nums">
            {bookCount} {bookCount === 1 ? 'book' : 'books'} · {examCount}{' '}
            {examCount === 1 ? 'exam' : 'exams'}
          </span>
        )}
        <kbd className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] font-mono text-xs text-[var(--text-muted)] shrink-0">
          ⌘K
        </kbd>
      </span>
    </button>
  );
}
