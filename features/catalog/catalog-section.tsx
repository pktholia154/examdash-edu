'use client';

import React, { useMemo, useState } from 'react';
import { ArrowUpDown, ChevronDown, Loader2, RotateCcw } from 'lucide-react';
import type {
  CatalogCardDTO,
  CatalogItemDTO,
  CollectionName,
  SortOption,
} from '../../lib/types/catalog';
import { EmptyState } from '../../components/ui/state-blocks';
import { CatalogCard } from './catalog-card';
import { apiUrl } from '../../lib/platform/api-base';
import { cn } from '../../lib/utils';

export interface CatalogSectionProps {
  id?: string;
  heading: string;
  subheading?: string;
  progressUnit?: string;
  storageKey?: string;
  items: Array<CatalogCardDTO | CatalogItemDTO>;
  viewAllHref?: string;
  viewAllLabel?: string;
  showFilters?: boolean;
  collectionName?: CollectionName;
  pageSize?: number;
  initialHasMore?: boolean;
  initialNextOffset?: number;
  totalCount?: number;
  loadMoreLabel?: string;
}

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'publishAt_desc', label: 'Newest' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
];

export function CatalogSection({
  id,
  heading,
  subheading,
  progressUnit,
  items,
  viewAllHref,
  viewAllLabel,
  showFilters = true,
  collectionName,
  pageSize = 10,
  initialHasMore = false,
  initialNextOffset,
  totalCount,
  loadMoreLabel = 'Load More',
}: CatalogSectionProps) {
  const [loadedItems, setLoadedItems] =
    useState<Array<CatalogCardDTO | CatalogItemDTO>>(items);
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore);
  const [nextOffset, setNextOffset] = useState<number>(
    typeof initialNextOffset === 'number' ? initialNextOffset : items.length
  );
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('ALL');
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('publishAt_desc');

  const facets = useMemo(() => {
    const types = Array.from(
      new Set(loadedItems.map((i) => i.type).filter(Boolean))
    ).sort();
    const languages = Array.from(
      new Set(loadedItems.map((i) => i.language).filter(Boolean))
    ).sort();
    const tags = Array.from(
      new Set(loadedItems.flatMap((i) => i.tags).filter(Boolean))
    )
      .sort()
      .slice(0, 10);

    return { types, languages, tags };
  }, [loadedItems]);

  const filteredAndSorted = useMemo(() => {
    if (!showFilters) {
      return loadedItems;
    }

    const filtered = loadedItems.filter((item) => {
      if (selectedType !== 'ALL' && item.type !== selectedType) return false;
      if (selectedLanguage !== 'ALL' && item.language !== selectedLanguage) {
        return false;
      }
      if (selectedTag !== 'ALL' && !item.tags.includes(selectedTag)) {
        return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (sortBy === 'price_asc') return a.buyPrice - b.buyPrice;
      if (sortBy === 'price_desc') return b.buyPrice - a.buyPrice;
      if (sortBy === 'publishAt_asc') {
        return (
          new Date(a.publishAtIso).getTime() - new Date(b.publishAtIso).getTime()
        );
      }
      return (
        new Date(b.publishAtIso).getTime() - new Date(a.publishAtIso).getTime()
      );
    });

    return filtered;
  }, [
    loadedItems,
    selectedLanguage,
    selectedTag,
    selectedType,
    showFilters,
    sortBy,
  ]);

  const hasActiveFilters =
    showFilters &&
    (selectedType !== 'ALL' ||
      selectedLanguage !== 'ALL' ||
      selectedTag !== 'ALL');

  const resetFilters = () => {
    setSelectedType('ALL');
    setSelectedLanguage('ALL');
    setSelectedTag('ALL');
  };

  const handleLoadMore = async () => {
    if (!collectionName || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    setLoadError(null);

    try {
      const safeLimit = Math.max(1, Math.min(24, Math.floor(pageSize) || 10));
      const endpoint = apiUrl(
        `/api/v1/catalog/items?collection=${encodeURIComponent(
          collectionName
        )}&limit=${encodeURIComponent(
          String(safeLimit)
        )}&offset=${encodeURIComponent(String(nextOffset))}`
      );
      const response = await fetch(endpoint, { cache: 'no-store' });
      const data = (await response.json()) as {
        items?: CatalogCardDTO[];
        hasMore?: boolean;
        nextOffset?: number;
        error?: string;
      };

      if (!response.ok) {
        setLoadError(
          data?.error || 'Unable to load more items. Please try again.'
        );
        return;
      }

      const incoming = Array.isArray(data.items) ? data.items : [];
      setLoadedItems((prev) => {
        const seen = new Set(prev.map((x) => `${x.collectionName}:${x.id}`));
        const unique = incoming.filter(
          (x) => !seen.has(`${x.collectionName}:${x.id}`)
        );
        return unique.length > 0 ? [...prev, ...unique] : prev;
      });
      setHasMore(Boolean(data.hasMore));
      setNextOffset(
        typeof data.nextOffset === 'number'
          ? data.nextOffset
          : nextOffset + incoming.length
      );
    } catch {
      setLoadError('Network error while loading more items. Please try again.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const effectiveTotal =
    typeof totalCount === 'number' && totalCount >= loadedItems.length
      ? totalCount
      : loadedItems.length;

  const badgeCount = hasActiveFilters
    ? filteredAndSorted.length
    : hasMore && typeof totalCount === 'number'
      ? effectiveTotal
      : loadedItems.length;

  const resolvedSubheading = progressUnit
    ? `Showing ${loadedItems.length}${
        effectiveTotal > loadedItems.length ? ` of ${effectiveTotal}` : ''
      } ${progressUnit}`
    : subheading;

  return (
    <section id={id} className="ed-container py-8 sm:py-10 max-md:py-5">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-[var(--border-subtle)] max-md:gap-2 max-md:pb-3.5">
        <div>
          <h2 className="text-[length:var(--text-h2)] font-extrabold tracking-tight text-[var(--text-main)]">
            {heading}{' '}
            <span className="text-sm font-medium text-[var(--text-muted)] tabular-nums">
              ({badgeCount})
            </span>
          </h2>
          {resolvedSubheading && (
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {resolvedSubheading}
            </p>
          )}
        </div>

        {viewAllHref && viewAllLabel && (
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <a
              href={viewAllHref}
              className="text-sm font-semibold text-[var(--text-main)] hover:underline underline-offset-4 whitespace-nowrap shrink-0 max-md:min-h-[44px] max-sm:-my-2 max-md:inline-flex max-md:items-center"
            >
              {viewAllLabel} →
            </a>
          </div>
        )}
      </div>

      {/* Button-Driven Filter & Sort Controls (Zero Crawlable Filter Query Links) */}
      {showFilters && loadedItems.length > 0 && (
        <div
          data-nosnippet=""
          className="mt-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-6 max-md:mt-3 max-md:pb-4 max-md:gap-2.5"
        >
          <div className="flex flex-wrap items-center gap-2 max-md:flex-nowrap ed-mobile-scroll-strip max-md:w-full max-md:pb-1">
            <button
              type="button"
              onClick={resetFilters}
              aria-pressed={!hasActiveFilters}
              className={cn(
                'min-h-[48px] max-md:min-h-[44px] px-3.5 max-md:px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0',
                !hasActiveFilters
                  ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                  : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
              )}
            >
              All ({loadedItems.length})
            </button>

            {facets.types.map((t) => (
              <button
                key={`type-${t}`}
                type="button"
                aria-pressed={selectedType === t}
                onClick={() =>
                  setSelectedType((prev) => (prev === t ? 'ALL' : t))
                }
                className={cn(
                  'min-h-[48px] max-md:min-h-[44px] px-3.5 max-md:px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0',
                  selectedType === t
                    ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] font-semibold'
                    : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
                )}
              >
                {t}
              </button>
            ))}

            {facets.languages.map((lang) => (
              <button
                key={`lang-${lang}`}
                type="button"
                aria-pressed={selectedLanguage === lang}
                onClick={() =>
                  setSelectedLanguage((prev) => (prev === lang ? 'ALL' : lang))
                }
                className={cn(
                  'min-h-[48px] max-md:min-h-[44px] px-3.5 max-md:px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0',
                  selectedLanguage === lang
                    ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] font-semibold'
                    : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
                )}
              >
                {lang}
              </button>
            ))}

            {facets.tags.map((tag) => (
              <button
                key={`tag-${tag}`}
                type="button"
                aria-pressed={selectedTag === tag}
                onClick={() =>
                  setSelectedTag((prev) => (prev === tag ? 'ALL' : tag))
                }
                className={cn(
                  'min-h-[48px] max-md:min-h-[44px] px-3.5 max-md:px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0',
                  selectedTag === tag
                    ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] font-semibold'
                    : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
                )}
              >
                #{tag}
              </button>
            ))}

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 min-h-[48px] max-md:min-h-[44px] px-3 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Reset</span>
              </button>
            )}
          </div>

          {/* Sort Segmented Buttons */}
          <div
            role="group"
            aria-label={`Sort ${heading}`}
            className="inline-flex items-center gap-1 min-h-[48px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 self-start lg:self-auto shrink-0 max-md:flex max-md:w-full max-md:max-w-full max-md:justify-between max-md:gap-1"
          >
            <ArrowUpDown
              className="w-3.5 h-3.5 text-[var(--text-muted)] ml-2 mr-1 shrink-0 max-md:hidden"
              aria-hidden="true"
            />
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={sortBy === opt.value}
                onClick={() => setSortBy(opt.value)}
                className={cn(
                  'min-h-[40px] px-3 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 max-md:flex-auto max-md:min-w-0 max-md:min-h-[44px] max-md:px-2 max-md:text-[11.5px] max-md:text-center',
                  sortBy === opt.value
                    ? 'bg-[var(--bg-surface)] text-[var(--text-main)] font-semibold border border-[var(--border-subtle)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)] border border-transparent'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Catalog Items or Empty State (List View Default) */}
      {loadedItems.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={`No ${heading.toLowerCase()} published yet`}
            description="New verified titles from the Firestore catalog will appear here automatically as soon as they are published."
          />
        </div>
      ) : filteredAndSorted.length === 0 ? (
        <EmptyState
          title="No items match the selected filters"
          description="Clear one or more active type, language, or tag filters to see all available resources."
          actionLabel="Reset Filters"
          onAction={resetFilters}
        />
      ) : (
        <>
          <div className={cn('flex flex-col gap-3', !showFilters && 'mt-6')}>
            {filteredAndSorted.map((item) => (
              <CatalogCard
                key={`${item.collectionName}:${item.id}`}
                item={item}
                viewMode="list"
              />
            ))}
          </div>

          {hasMore && collectionName && (
            <div
              data-nosnippet=""
              className="mt-6 flex flex-col items-center gap-2"
            >
              {loadError && (
                <p
                  role="alert"
                  className="text-xs font-medium text-[var(--semantic-danger)] text-center"
                >
                  {loadError}
                </p>
              )}

              <button
                type="button"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                aria-busy={isLoadingMore}
                className="min-h-[48px] w-full sm:w-auto sm:min-w-[220px] px-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] active:scale-[0.99] transition-all inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2
                      className="w-4 h-4 animate-spin"
                      aria-hidden="true"
                    />
                    <span>Loading...</span>
                  </>
                ) : (
                  <>
                    <span>{loadMoreLabel}</span>
                    <ChevronDown className="w-4 h-4" aria-hidden="true" />
                  </>
                )}
              </button>

              {typeof totalCount === 'number' &&
                totalCount > loadedItems.length && (
                  <p className="text-xs text-[var(--text-muted)] tabular-nums">
                    Showing {loadedItems.length} of {effectiveTotal}
                  </p>
                )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
