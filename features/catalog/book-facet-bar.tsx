'use client';

import React, { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import type {
  BookAvailableFacets,
  BookFacetFilters,
  BookPriceBucket,
  SortOption,
} from '../../lib/types/catalog';
import {
  BOOK_PRICE_BUCKETS,
  BOOK_SORT_OPTIONS,
  buildBookFacetQueryString,
  hasActiveBookFacets,
} from '../../lib/catalog/facets';
import { cn } from '../../lib/utils';

export interface BookFacetBarProps {
  basePath: string;
  availableFacets: BookAvailableFacets;
  activeFilters: BookFacetFilters;
  totalCount: number;
  unfilteredTotalCount: number;
}

/**
 * Crawl-Proof Faceted Filter & Sort Bar (`<select>` + `<button>`, Zero `<a>` Tags):
 * Filters books by `type`, `language`, and `price` (from Firestore `books` collection) and syncs
 * state to URL query parameters (`noindex, follow`, canonicalized to base Hub URL).
 */
export function BookFacetBar({
  basePath,
  availableFacets,
  activeFilters,
  totalCount,
  unfilteredTotalCount,
}: BookFacetBarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isFiltered = hasActiveBookFacets(activeFilters);

  const applyFilterUpdate = (patch: Partial<BookFacetFilters>) => {
    const nextFilters: BookFacetFilters = {
      ...activeFilters,
      ...patch,
    };
    if (!nextFilters.type || nextFilters.type === 'ALL') {
      delete nextFilters.type;
    }
    if (!nextFilters.language || nextFilters.language === 'ALL') {
      delete nextFilters.language;
    }
    if (!nextFilters.price || nextFilters.price === 'all') {
      delete nextFilters.price;
    }
    if (!nextFilters.sort || nextFilters.sort === 'publishAt_desc') {
      delete nextFilters.sort;
    }

    const qs = buildBookFacetQueryString(nextFilters, 1);
    startTransition(() => {
      router.replace(`${basePath}${qs}`, { scroll: false });
    });
  };

  const resetAllFilters = () => {
    startTransition(() => {
      router.replace(basePath, { scroll: false });
    });
  };

  // Merge active selection even if current filter narrowed available options to 0
  const typeOptions = Array.from(
    new Set([
      ...availableFacets.types,
      ...(activeFilters.type ? [activeFilters.type] : []),
    ])
  ).sort((a, b) => a.localeCompare(b));

  const languageOptions = Array.from(
    new Set([
      ...availableFacets.languages,
      ...(activeFilters.language ? [activeFilters.language] : []),
    ])
  ).sort((a, b) => a.localeCompare(b));

  const availablePriceSet = new Set<BookPriceBucket>([
    'all',
    ...availableFacets.priceBuckets,
    ...(activeFilters.price ? [activeFilters.price] : []),
  ]);
  const priceBucketOptions = BOOK_PRICE_BUCKETS.filter((bucket) =>
    availablePriceSet.has(bucket.value)
  );

  return (
    <div
      data-nosnippet=""
      aria-busy={isPending}
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 max-md:p-3 transition-opacity',
        isPending && 'opacity-70'
      )}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 max-md:gap-2.5">
        {/* 1. Type Facet (`books.type`) */}
        <div className="flex flex-col gap-1 min-w-0">
          <label
            htmlFor={`facet-type-${basePath}`}
            className="text-xs font-semibold text-[var(--text-muted)] truncate"
          >
            Format / Type
          </label>
          <select
            id={`facet-type-${basePath}`}
            value={activeFilters.type || 'ALL'}
            onChange={(e) =>
              applyFilterUpdate({
                type: e.target.value === 'ALL' ? undefined : e.target.value,
              })
            }
            className="min-h-12 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 max-md:px-2.5 text-sm max-md:text-[16px] font-medium text-[var(--text-main)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            <option value="ALL">All Types</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* 2. Language Facet (`books.language`) */}
        <div className="flex flex-col gap-1 min-w-0">
          <label
            htmlFor={`facet-lang-${basePath}`}
            className="text-xs font-semibold text-[var(--text-muted)] truncate"
          >
            Language
          </label>
          <select
            id={`facet-lang-${basePath}`}
            value={activeFilters.language || 'ALL'}
            onChange={(e) =>
              applyFilterUpdate({
                language: e.target.value === 'ALL' ? undefined : e.target.value,
              })
            }
            className="min-h-12 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 max-md:px-2.5 text-sm max-md:text-[16px] font-medium text-[var(--text-main)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            <option value="ALL">All Languages</option>
            {languageOptions.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Price Facet (`books.buyPrice`) */}
        <div className="flex flex-col gap-1 min-w-0">
          <label
            htmlFor={`facet-price-${basePath}`}
            className="text-xs font-semibold text-[var(--text-muted)] truncate"
          >
            Price Range
          </label>
          <select
            id={`facet-price-${basePath}`}
            value={activeFilters.price || 'all'}
            onChange={(e) =>
              applyFilterUpdate({
                price: e.target.value as BookPriceBucket,
              })
            }
            className="min-h-12 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 max-md:px-2.5 text-sm max-md:text-[16px] font-medium text-[var(--text-main)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            {priceBucketOptions.map((bucket) => (
              <option key={bucket.value} value={bucket.value}>
                {bucket.label}
              </option>
            ))}
          </select>
        </div>

        {/* 4. Sort Control */}
        <div className="flex flex-col gap-1 min-w-0">
          <label
            htmlFor={`facet-sort-${basePath}`}
            className="text-xs font-semibold text-[var(--text-muted)] truncate"
          >
            Sort By
          </label>
          <select
            id={`facet-sort-${basePath}`}
            value={activeFilters.sort || 'publishAt_desc'}
            onChange={(e) =>
              applyFilterUpdate({
                sort: e.target.value as SortOption,
              })
            }
            className="min-h-12 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 max-md:px-2.5 text-sm max-md:text-[16px] font-medium text-[var(--text-main)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            {BOOK_SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Status + Reset Row */}
      <div className="mt-3 max-md:mt-2.5 pt-2.5 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)] tabular-nums">
          {isFiltered ? (
            <>
              Showing <strong className="font-semibold text-[var(--text-main)]">{totalCount}</strong>{' '}
              of {unfilteredTotalCount}{' '}
              {unfilteredTotalCount === 1 ? 'book' : 'books'}
            </>
          ) : (
            <>
              <strong className="font-semibold text-[var(--text-main)]">
                {unfilteredTotalCount}
              </strong>{' '}
              published {unfilteredTotalCount === 1 ? 'book' : 'books'} available
            </>
          )}
        </p>

        {isFiltered && (
          <button
            type="button"
            onClick={resetAllFilters}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-1.5 min-h-12 -my-2 px-3 rounded-lg text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Reset filters</span>
          </button>
        )}
      </div>
    </div>
  );
}
