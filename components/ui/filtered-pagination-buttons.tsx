'use client';

import React, { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface FilteredPaginationButtonsProps {
  basePath: string;
  filterQueryWithoutPage: string;
  currentPage: number;
  visibleTokens: Array<number | 'ellipsis-start' | 'ellipsis-end'>;
  hasPrev: boolean;
  hasNext: boolean;
  ariaLabel: string;
}

function buildFilteredTargetUrl(
  basePath: string,
  filterQueryWithoutPage: string,
  targetPage: number
): string {
  const cleanQuery = filterQueryWithoutPage.replace(/^\?/, '');
  const params = new URLSearchParams(cleanQuery);
  if (targetPage > 1) {
    params.set('page', String(targetPage));
  } else {
    params.delete('page');
  }
  const qs = params.toString();
  return `${basePath}${qs ? `?${qs}` : ''}`;
}

/**
 * Crawl-proof `<button>` pagination island used strictly when facet/sort query parameters are active.
 * Emits zero `<a href>` tags so crawlers never discover combinatorial filtered pagination URLs.
 */
export function FilteredPaginationButtons({
  basePath,
  filterQueryWithoutPage,
  currentPage,
  visibleTokens,
  hasPrev,
  hasNext,
  ariaLabel,
}: FilteredPaginationButtonsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const navigateToPage = (targetPage: number) => {
    const nextUrl = buildFilteredTargetUrl(
      basePath,
      filterQueryWithoutPage,
      targetPage
    );
    startTransition(() => {
      router.replace(nextUrl, { scroll: true });
    });
  };

  return (
    <nav
      aria-label={ariaLabel}
      aria-busy={isPending}
      data-nosnippet=""
      className={cn(
        'ed-container pb-8 pt-2 flex flex-wrap items-center justify-center gap-1.5 transition-opacity',
        isPending && 'opacity-70'
      )}
    >
      <button
        type="button"
        disabled={!hasPrev || isPending}
        onClick={() => navigateToPage(currentPage - 1)}
        className="inline-flex items-center justify-center gap-1 min-h-12 px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap shrink-0"
      >
        <ChevronLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>Previous</span>
      </button>

      {visibleTokens.map((token) => {
        if (token === 'ellipsis-start' || token === 'ellipsis-end') {
          return (
            <span
              key={token}
              aria-hidden="true"
              className="inline-flex items-center justify-center min-h-12 min-w-9 text-xs font-semibold text-[var(--text-muted)] select-none"
            >
              …
            </span>
          );
        }

        const isCurrent = token === currentPage;
        return (
          <button
            key={`filtered-page-${token}`}
            type="button"
            disabled={isPending}
            onClick={() => navigateToPage(token)}
            aria-current={isCurrent ? 'page' : undefined}
            aria-label={`Page ${token}`}
            className={cn(
              'inline-flex items-center justify-center min-h-12 min-w-12 px-3 rounded-lg text-xs font-semibold tabular-nums transition-colors whitespace-nowrap shrink-0',
              isCurrent
                ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]'
            )}
          >
            {token}
          </button>
        );
      })}

      <button
        type="button"
        disabled={!hasNext || isPending}
        onClick={() => navigateToPage(currentPage + 1)}
        className="inline-flex items-center justify-center gap-1 min-h-12 px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap shrink-0"
      >
        <span>Next</span>
        <ChevronRight className="w-4 h-4 shrink-0" aria-hidden="true" />
      </button>
    </nav>
  );
}
