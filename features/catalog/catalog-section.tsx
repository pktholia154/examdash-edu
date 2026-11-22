'use client';

import React, { useMemo, useState } from 'react';
import { ArrowUpDown, RotateCcw } from 'lucide-react';
import type {
  CatalogCardDTO,
  CatalogItemDTO,
  SortOption,
} from '../../lib/types/catalog';
import { EmptyState } from '../../components/ui/state-blocks';
import { CatalogCard } from './catalog-card';
import { cn } from '../../lib/utils';

export interface CatalogSectionProps {
  id?: string;
  heading: string;
  subheading: string;
  storageKey?: string;
  items: Array<CatalogCardDTO | CatalogItemDTO>;
  viewAllHref?: string;
  viewAllLabel?: string;
  showFilters?: boolean;
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
  items,
  viewAllHref,
  viewAllLabel,
  showFilters = true,
}: CatalogSectionProps) {
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('ALL');
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('publishAt_desc');

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
    const filtered = showFilters
      ? items.filter((item) => {
          if (selectedType !== 'ALL' && item.type !== selectedType) return false;
          if (selectedLanguage !== 'ALL' && item.language !== selectedLanguage) {
            return false;
          }
          if (selectedTag !== 'ALL' && !item.tags.includes(selectedTag)) {
            return false;
          }
          return true;
        })
      : [...items];

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
  }, [items, selectedLanguage, selectedTag, selectedType, showFilters, sortBy]);

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

  return (
    <section id={id} className="ed-container py-8 sm:py-10 max-md:py-5">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-[var(--border-subtle)] max-md:gap-2 max-md:pb-3.5">
        <div>
          <h2 className="text-[length:var(--text-h2)] font-extrabold tracking-tight text-[var(--text-main)]">
            {heading}{' '}
            <span className="text-sm font-medium text-[var(--text-muted)] tabular-nums">
              ({filteredAndSorted.length})
            </span>
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{subheading}</p>
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
      {showFilters && items.length > 0 && (
        <div className="mt-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-6 max-md:mt-3 max-md:pb-4 max-md:gap-2.5">
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
      ) : (
        <div className={cn('flex flex-col gap-3', !showFilters && 'mt-6')}>
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
