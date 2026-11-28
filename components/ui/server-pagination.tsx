import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { FilteredPaginationButtons } from './filtered-pagination-buttons';

export interface ServerPaginationProps {
  basePath: string;
  currentPage: number;
  pageSize: number;
  hasMore: boolean;
  totalCount?: number | null;
  ariaLabel: string;
  isFiltered?: boolean;
  filterQueryWithoutPage?: string;
}

export function buildPaginationHref(basePath: string, page: number): string {
  if (page <= 1) return basePath;
  return `${basePath}?page=${page}`;
}

export function buildVisiblePageNumbers(
  currentPage: number,
  totalPages: number
): Array<number | 'ellipsis-start' | 'ellipsis-end'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages: Array<number | 'ellipsis-start' | 'ellipsis-end'> = [1];
  const windowStart = Math.max(2, currentPage - 1);
  const windowEnd = Math.min(totalPages - 1, currentPage + 1);

  if (windowStart > 2) {
    pages.push('ellipsis-start');
  }
  for (let p = windowStart; p <= windowEnd; p++) {
    pages.push(p);
  }
  if (windowEnd < totalPages - 1) {
    pages.push('ellipsis-end');
  }
  pages.push(totalPages);
  return pages;
}

/**
 * Pure Server-Rendered Crawl Pagination (`<a href>` Zero-JS Graph):
 * Ensures Googlebot, Bingbot, and AI search citation bots discover every paginated
 * catalog & category hub archive (`/books/category/[slug]?page=2`, ...) without executing client JS,
 * while switching to crawl-proof `<button>` controls whenever facet filters are active.
 */
export function ServerPagination({
  basePath,
  currentPage,
  pageSize,
  hasMore,
  totalCount,
  ariaLabel,
  isFiltered = false,
  filterQueryWithoutPage = '',
}: ServerPaginationProps) {
  const computedTotalPages =
    typeof totalCount === 'number' && totalCount > 0
      ? Math.max(
          hasMore ? currentPage + 1 : currentPage,
          Math.ceil(totalCount / Math.max(1, pageSize))
        )
      : hasMore
      ? currentPage + 1
      : currentPage;

  if (computedTotalPages <= 1 && currentPage <= 1) {
    return null;
  }

  const hasPrev = currentPage > 1;
  const hasNext = hasMore || currentPage < computedTotalPages;
  const visibleTokens = buildVisiblePageNumbers(currentPage, computedTotalPages);

  if (isFiltered) {
    return (
      <FilteredPaginationButtons
        basePath={basePath}
        filterQueryWithoutPage={filterQueryWithoutPage}
        currentPage={currentPage}
        visibleTokens={visibleTokens}
        hasPrev={hasPrev}
        hasNext={hasNext}
        ariaLabel={ariaLabel}
      />
    );
  }

  return (
    <nav
      aria-label={ariaLabel}
      className="ed-container pb-8 pt-2 flex flex-wrap items-center justify-center gap-1.5"
    >
      {hasPrev ? (
        <a
          href={buildPaginationHref(basePath, currentPage - 1)}
          rel="prev"
          className="inline-flex items-center justify-center gap-1 min-h-[44px] px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0"
        >
          <ChevronLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Previous</span>
        </a>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex items-center justify-center gap-1 min-h-[44px] px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-muted)] opacity-50 select-none"
        >
          <ChevronLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Previous</span>
        </span>
      )}

      {visibleTokens.map((token) => {
        if (token === 'ellipsis-start' || token === 'ellipsis-end') {
          return (
            <span
              key={token}
              aria-hidden="true"
              className="inline-flex items-center justify-center min-h-[44px] min-w-[36px] text-xs font-semibold text-[var(--text-muted)] select-none"
            >
              …
            </span>
          );
        }

        const isCurrent = token === currentPage;
        return (
          <a
            key={`page-${token}`}
            href={buildPaginationHref(basePath, token)}
            aria-current={isCurrent ? 'page' : undefined}
            aria-label={`Page ${token}`}
            className={cn(
              'inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 rounded-lg text-xs font-semibold tabular-nums transition-colors',
              isCurrent
                ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]'
            )}
          >
            {token}
          </a>
        );
      })}

      {hasNext ? (
        <a
          href={buildPaginationHref(basePath, currentPage + 1)}
          rel="next"
          className="inline-flex items-center justify-center gap-1 min-h-[44px] px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] transition-colors"
        >
          <span>Next</span>
          <ChevronRight className="w-4 h-4 shrink-0" aria-hidden="true" />
        </a>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex items-center justify-center gap-1 min-h-[44px] px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-muted)] opacity-50 select-none"
        >
          <span>Next</span>
          <ChevronRight className="w-4 h-4 shrink-0" aria-hidden="true" />
        </span>
      )}
    </nav>
  );
}
