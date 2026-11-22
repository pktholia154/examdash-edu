'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, Search, X } from 'lucide-react';
import { EmptyState } from '../../components/ui/state-blocks';
import type { CatalogCardDTO } from '../../lib/types/catalog';
import { cn } from '../../lib/utils';
import { CatalogCard } from '../catalog/catalog-card';
import { FOCUS_SEARCH_EVENT } from './command-search-modal';

type SearchScope = 'all' | 'books' | 'exams';

const ANIMATED_PLACEHOLDERS = [
  'Search ebooks, chapter notes, or study guides...',
  'Search full-length mock exam series & CBT sets...',
  'Search by author, subject, language, or #tag...',
  'Search question banks & solved practice papers...',
];

export function FullSearchPage({
  initialItems,
  initialQuery = '',
}: {
  initialItems: CatalogCardDTO[];
  initialQuery?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const shouldReduceMotion = useReducedMotion();

  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState<SearchScope>('all');
  const [isFocused, setIsFocused] = useState(true);
  const [promptIdx, setPromptIdx] = useState(0);

  // Auto-focus full-width search bar on arrival and when Cmd+K is pressed while on /search
  useEffect(() => {
    const focusInput = () => {
      inputRef.current?.focus();
    };
    const raf = window.requestAnimationFrame(focusInput);
    window.addEventListener(FOCUS_SEARCH_EVENT, focusInput);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener(FOCUS_SEARCH_EVENT, focusInput);
    };
  }, []);

  // Animate placeholder label while query is empty
  useEffect(() => {
    if (shouldReduceMotion || query.length > 0) return;
    const timer = window.setInterval(() => {
      setPromptIdx((prev) => (prev + 1) % ANIMATED_PLACEHOLDERS.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [query.length, shouldReduceMotion]);

  const popularTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of initialItems) {
      for (const tag of item.tags) {
        const clean = tag.trim();
        if (!clean) continue;
        counts.set(clean, (counts.get(clean) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([tag]) => tag);
  }, [initialItems]);

  const filteredResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    return initialItems.filter((item) => {
      if (scope === 'books' && item.collectionName !== 'books') return false;
      if (scope === 'exams' && item.collectionName !== 'ExamPackDocument') {
        return false;
      }
      if (!q) return true;
      const haystack = [
        item.title,
        item.authorName,
        item.type,
        item.language,
        ...item.tags,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [initialItems, query, scope]);

  const bookCount = useMemo(
    () =>
      filteredResults.filter((i) => i.collectionName === 'books').length,
    [filteredResults]
  );
  const examCount = useMemo(
    () =>
      filteredResults.filter((i) => i.collectionName === 'ExamPackDocument')
        .length,
    [filteredResults]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (query) {
        setQuery('');
      } else {
        router.back();
      }
    }
  };

  return (
    <div className="ed-container py-6 sm:py-8 space-y-6">
      {/* Top Bar: Back + Heading + Result Counter */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Go back"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-[var(--text-main)]">
              Search Catalog
            </h1>
            <p className="text-xs text-[var(--text-muted)] tabular-nums">
              {filteredResults.length}{' '}
              {filteredResults.length === 1 ? 'resource' : 'resources'} available
            </p>
          </div>
        </div>
      </div>

      {/* Full-Width Aesthetic Search Input with Active Border */}
      <div
        className={cn(
          'relative w-full flex items-center gap-3 min-h-[58px] px-4 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border-2 transition-all duration-150',
          isFocused
            ? 'border-[var(--accent-active)] ring-4 ring-[var(--accent-active)]/12'
            : 'border-[var(--border-strong)] hover:border-[var(--text-muted)]'
        )}
      >
        <Search
          className={cn(
            'w-5 h-5 shrink-0 transition-colors',
            isFocused ? 'text-[var(--accent-active)]' : 'text-[var(--text-muted)]'
          )}
          aria-hidden="true"
        />

        <div className="relative flex-1 min-w-0 flex items-center">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
            aria-label="Search books, question banks, and mock exam packs"
            className="w-full min-h-[48px] bg-transparent border-0 text-base text-[var(--text-main)] outline-none! outline-offset-0! focus:outline-none! focus-visible:outline-none! appearance-none z-10"
          />

          {/* Animated Placeholder Overlay when query is empty */}
          {query.length === 0 && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center overflow-hidden"
            >
              {shouldReduceMotion ? (
                <span className="truncate text-sm sm:text-base text-[var(--text-muted)]">
                  {ANIMATED_PLACEHOLDERS[0]}
                </span>
              ) : (
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={promptIdx}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                    className="truncate text-sm sm:text-base text-[var(--text-muted)]"
                  >
                    {ANIMATED_PLACEHOLDERS[promptIdx]}
                  </motion.span>
                </AnimatePresence>
              )}
            </div>
          )}
        </div>

        {query.length > 0 && (
          <button
            type="button"
            aria-label="Clear search query"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Scope Tabs + Quick Topic Suggestions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Filter search results by type"
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 self-start tabular-nums"
        >
          {(
            [
              { id: 'all', label: `All (${filteredResults.length})` },
              { id: 'books', label: `Books (${bookCount})` },
              { id: 'exams', label: `Exams (${examCount})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={scope === tab.id}
              onClick={() => setScope(tab.id)}
              className={cn(
                'min-h-[40px] px-3.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap',
                scope === tab.id
                  ? 'bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-subtle)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] border border-transparent'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {popularTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[var(--text-muted)] mr-1">
              Topics:
            </span>
            {popularTags.map((tag) => {
              const active = query.trim().toLowerCase() === tag.toLowerCase();
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setQuery(active ? '' : tag)}
                  className={cn(
                    'min-h-[36px] px-2.5 rounded-md border text-xs font-medium transition-colors whitespace-nowrap',
                    active
                      ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--border-strong)]'
                  )}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Results List (Always List View) */}
      {filteredResults.length === 0 ? (
        <EmptyState
          title={`No matches for "${query.trim()}"`}
          description="Try another book title, exam name, author, language, or clear your search filter."
          actionLabel="Reset Search"
          onAction={() => {
            setQuery('');
            setScope('all');
            inputRef.current?.focus();
          }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filteredResults.map((item) => (
            <CatalogCard
              key={`${item.collectionName}:${item.id}`}
              item={item}
              viewMode="list"
            />
          ))}
        </div>
      )}
    </div>
  );
}
