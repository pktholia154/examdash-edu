'use client';

import React, { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { ArrowUpDown, RotateCcw } from 'lucide-react';
import type { CatalogItemDTO, SortOption, ViewMode } from '../../lib/types/catalog';
import { ViewToggle } from '../../components/ui/view-toggle';
import { EmptyState } from '../../components/ui/state-blocks';
import { CatalogCard } from './catalog-card';
import { cn } from '../../lib/utils';

export interface CatalogSectionProps {
  id?: string;
  heading: string;
  subheading: string;
  storageKey: string;
  items: CatalogItemDTO[];
  viewAllHref?: string;
  viewAllLabel?: string;
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
  storageKey,
  items,
  viewAllHref,
  viewAllLabel,
}: CatalogSectionProps) {
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('ALL');
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('publishAt_desc');

  const lsKey = `ed-view-${storageKey}`;
  const lsEvent = `ed-view-event-${storageKey}`;

  const subscribeView = useCallback(
    (cb: () => void) => {
      if (typeof window === 'undefined') return () => {};
      window.addEventListener(lsEvent, cb);
      window.addEventListener('storage', cb);
      return () => {
        window.removeEventListener(lsEvent, cb);
        window.removeEventListener('storage', cb);
      };
    },
    [lsEvent]
  );

  const getViewSnapshot = useCallback((): ViewMode => {
    if (typeof window === 'undefined') return 'grid';
    try {
      const saved = localStorage.getItem(lsKey);
      return saved === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  }, [lsKey]);

  const viewMode = useSyncExternalStore(
    subscribeView,
    getViewSnapshot,
    (): ViewMode => 'grid'
  );

  const handleViewChange = (next: ViewMode) => {
    try {
      localStorage.setItem(lsKey, next);
    } catch {
      // Ignore storage error
    }
    window.dispatchEvent(new Event(lsEvent));
  };

  const facets = useMemo(() => {
    const types = Array.from(
      new Set(items.map((i) => i.type).filter(Boolean))
    ).sort();
    const languages = Array.from(
      new Set(items.map((i) => i.language).filter(Boolean))
    ).sort();
    const tags = Array.from(
      new Set(items.flatMap((i) => i.tags).filter(Boolean))
    )
      .sort()
      .slice(0, 10);

    return { types, languages, tags };
  }, [items]);

  const filteredAndSorted = useMemo(() => {
    const filtered = items.filter((item) => {
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
  }, [items, selectedLanguage, selectedTag, selectedType, sortBy]);

  const hasActiveFilters =
    selectedType !== 'ALL' ||
    selectedLanguage !== 'ALL' ||
    selectedTag !== 'ALL';

  const resetFilters = () => {
    setSelectedType('ALL');
    setSelectedLanguage('ALL');
    setSelectedTag('ALL');
  };

  return (
    <section id={id} className="ed-container py-8 sm:py-10">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-[var(--border-subtle)]">
        <div>
          <h2 className="text-[length:var(--text-h2)] font-extrabold tracking-tight text-[var(--text-main)]">
            {heading}{' '}
            <span className="text-sm font-medium text-[var(--text-muted)] tabular-nums">
              ({filteredAndSorted.length})
            </span>
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{subheading}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {viewAllHref && viewAllLabel && (
            <a
              href={viewAllHref}
              className="text-sm font-semibold text-[var(--text-main)] hover:underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              {viewAllLabel} →
            </a>
          )}
          <ViewToggle
            value={viewMode}
            onChange={handleViewChange}
            labelPrefix={heading}
          />
        </div>
      </div>

      {/* Button-Driven Filter & Sort Controls (Zero Crawlable Filter Query Links) */}
      {items.length > 0 && (
        <div className="mt-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-6">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={resetFilters}
              aria-pressed={!hasActiveFilters}
              className={cn(
                'min-h-[38px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0',
                !hasActiveFilters
                  ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                  : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
              )}
            >
              All ({items.length})
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
                  'min-h-[38px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0',
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
                  'min-h-[38px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0',
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
                  'min-h-[38px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0',
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
                className="inline-flex items-center gap-1 min-h-[38px] px-2.5 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] whitespace-nowrap shrink-0"
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
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 self-start lg:self-auto shrink-0"
          >
            <ArrowUpDown
              className="w-3.5 h-3.5 text-[var(--text-muted)] ml-2 mr-1 shrink-0"
              aria-hidden="true"
            />
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={sortBy === opt.value}
                onClick={() => setSortBy(opt.value)}
                className={cn(
                  'min-h-[34px] px-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0',
                  sortBy === opt.value
                    ? 'bg-[var(--bg-surface)] text-[var(--text-main)] font-semibold shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Catalog Items or Empty State */}
      {items.length === 0 ? (
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
      ) : viewMode === 'grid' ? (
        <div className="ed-catalog-grid">
          {filteredAndSorted.map((item) => (
            <CatalogCard
              key={`${item.collectionName}:${item.id}`}
              item={item}
              viewMode="grid"
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredAndSorted.map((item) => (
            <CatalogCard
              key={`${item.collectionName}:${item.id}`}
              item={item}
              viewMode="list"
            />
          ))}
        </div>
      )}
    </section>
  );
}
