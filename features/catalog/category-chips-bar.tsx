'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { CategoryChipDTO } from '../../lib/types/catalog';
import {
  INITIAL_VISIBLE_CATEGORY_CHIPS,
  partitionCategoryChipsForDisplay,
} from '../../lib/catalog/facets';
import { cn } from '../../lib/utils';

export interface CategoryChipsBarProps {
  categories: CategoryChipDTO[];
  activeSlug?: string;
  initialLimit?: number;
}

/**
 * SEO-First Category Chips Bar (Rendered Exclusively on `/books`):
 * Renders 100% of non-deleted Firestore `category` hubs as real `<a href="/books/category/[slug]">`
 * links in first-byte server HTML so Googlebot, Bingbot, and AI crawlers discover every Category Hub
 * immediately, while providing a progressive "See more" / "Show less" `<button>` toggle for visual users.
 */
export function CategoryChipsBar({
  categories,
  activeSlug,
  initialLimit = INITIAL_VISIBLE_CATEGORY_CHIPS,
}: CategoryChipsBarProps) {
  const [expanded, setExpanded] = useState(false);

  if (!Array.isArray(categories) || categories.length === 0) {
    return null;
  }

  const { hasOverflow, overflowCount } = partitionCategoryChipsForDisplay(
    categories,
    initialLimit
  );

  return (
    <section
      aria-labelledby="book-categories-heading"
      className="mt-6 max-md:mt-4 pt-5 max-md:pt-4 border-t border-[var(--border-subtle)]"
    >
      <div className="flex items-center justify-between gap-3 mb-3 max-md:mb-2.5">
        <h2
          id="book-categories-heading"
          className="text-sm font-bold tracking-tight text-[var(--text-main)]"
        >
          Browse by Exam Category
        </h2>

        {hasOverflow && (
          <button
            type="button"
            data-nosnippet=""
            aria-expanded={expanded}
            aria-controls="book-category-chips-list"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 min-h-12 -my-2 px-2.5 rounded-lg text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0"
          >
            <span>
              {expanded ? 'Show less' : `See more (+${overflowCount})`}
            </span>
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      <nav aria-label="Book categories">
        <ul
          id="book-category-chips-list"
          className="flex flex-wrap items-center gap-2 max-md:gap-1.5"
        >
          <li className="shrink-0">
            <a
              href="/books"
              aria-current={!activeSlug ? 'page' : undefined}
              className={cn(
                'inline-flex items-center justify-center min-h-12 px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0',
                !activeSlug
                  ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                  : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]'
              )}
            >
              All Books
            </a>
          </li>

          {categories.map((cat, idx) => {
            const isActive = activeSlug === cat.slug;
            const isOverflowChip = idx >= initialLimit;

            return (
              <li
                key={cat.slug}
                className={cn(
                  'shrink-0',
                  isOverflowChip && !expanded && !isActive && 'hidden'
                )}
              >
                <a
                  href={`/books/category/${encodeURIComponent(cat.slug)}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center justify-center min-h-12 px-3.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0',
                    isActive
                      ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] font-semibold'
                      : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]'
                  )}
                >
                  <span>{cat.title}</span>
                </a>
              </li>
            );
          })}

          {hasOverflow && !expanded && (
            <li className="shrink-0 sm:hidden" data-nosnippet="">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded(true)}
                className="inline-flex items-center justify-center gap-1 min-h-12 px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap shrink-0"
              >
                <span>+{overflowCount} more</span>
                <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              </button>
            </li>
          )}
        </ul>
      </nav>
    </section>
  );
}
