'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Search } from 'lucide-react';

const ANIMATED_SEARCH_PROMPTS = [
  'Search ebooks, chapter notes, or study guides...',
  'Search full-length mock exam series & CBT packs...',
  'Search by subject, author, language, or #tag...',
  'Search question banks & solved practice sets...',
];

export function HomeSearchBar({
  bookCount,
  examCount,
}: {
  bookCount: number;
  examCount: number;
}) {
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const [promptIdx, setPromptIdx] = useState(0);

  useEffect(() => {
    if (shouldReduceMotion) return;
    const timer = window.setInterval(() => {
      setPromptIdx((prev) => (prev + 1) % ANIMATED_SEARCH_PROMPTS.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [shouldReduceMotion]);

  return (
    <button
      type="button"
      onClick={() => router.push('/search')}
      aria-label="Search books, question banks, and mock exam packs"
      className="group w-full flex items-center justify-between gap-3 min-h-[56px] px-4 rounded-[var(--radius-card)] border-2 border-[var(--border-strong)] bg-[var(--bg-surface)] text-left text-sm text-[var(--text-muted)] hover:border-[var(--brand-primary)] focus-visible:border-[var(--brand-primary)] transition-colors"
    >
      <span className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
        <Search
          className="w-4 h-4 text-[var(--text-main)] shrink-0"
          aria-hidden="true"
        />
        <span className="relative flex-1 h-5 overflow-hidden">
          {shouldReduceMotion ? (
            <span className="block truncate text-[var(--text-muted)]">
              {ANIMATED_SEARCH_PROMPTS[0]}
            </span>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={promptIdx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="block truncate text-[var(--text-muted)] group-hover:text-[var(--text-main)] transition-colors"
              >
                {ANIMATED_SEARCH_PROMPTS[promptIdx]}
              </motion.span>
            </AnimatePresence>
          )}
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
