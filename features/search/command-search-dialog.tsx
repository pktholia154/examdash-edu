'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Search, X } from 'lucide-react';
import { CatalogThumbnail } from '../../components/ui/catalog-thumbnail';
import { apiUrl } from '../../lib/platform/api-base';
import { formatPrice } from '../../lib/registry/content-type-registry';
import { getDefaultCatalogPricing } from '../../lib/validity/pricing';
import type { CatalogCardDTO } from '../../lib/types/catalog';
import { cn } from '../../lib/utils';

export function CommandSearchDialog({
  initialQuery,
  onClose,
}: {
  initialQuery: string;
  onClose: () => void;
}) {
  const [queryText, setQueryText] = useState(initialQuery);
  const [books, setBooks] = useState<CatalogCardDTO[]>([]);
  const [exams, setExams] = useState<CatalogCardDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 20);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `${apiUrl('/api/v1/search')}?q=${encodeURIComponent(queryText.trim())}`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const data = (await res.json()) as {
            books?: CatalogCardDTO[];
            exams?: CatalogCardDTO[];
          };
          setBooks(Array.isArray(data.books) ? data.books : []);
          setExams(Array.isArray(data.exams) ? data.exams : []);
          setActiveIndex(0);
        }
      } catch {
        // Ignore aborted requests
      } finally {
        setIsLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [queryText]);

  const flatResults = useMemo(() => {
    const entries: Array<{
      key: string;
      href: string;
      title: string;
      subtitle: string;
      priceLabel: string;
      type: string;
      collectionName: 'books' | 'ExamPackDocument';
    }> = [];

    for (const b of books) {
      const pricing = getDefaultCatalogPricing('books', b.buyPrice);
      entries.push({
        key: `books:${b.id}`,
        href: `/books/${b.urlSlug}`,
        title: b.title,
        subtitle: `${b.authorName} · ${b.language}`,
        priceLabel: pricing.isFree
          ? 'Free'
          : formatPrice(pricing.discountedPrice, b.currency),
        type: b.type,
        collectionName: 'books',
      });
    }

    for (const ex of exams) {
      const pricing = getDefaultCatalogPricing('ExamPackDocument', ex.buyPrice);
      entries.push({
        key: `ExamPackDocument:${ex.id}`,
        href: `/exams/${ex.urlSlug}`,
        title: ex.title,
        subtitle: `${ex.authorName} · ${ex.totalMocktest} Mock ${
          ex.totalMocktest === 1 ? 'Test' : 'Tests'
        }`,
        priceLabel: pricing.isFree
          ? 'Free'
          : formatPrice(pricing.discountedPrice, ex.currency),
        type: ex.type,
        collectionName: 'ExamPackDocument',
      });
    }

    return entries;
  }, [books, exams]);

  const navigateToResult = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router]
  );

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (flatResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % flatResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + flatResults.length) % flatResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = flatResults[activeIndex];
      if (target) {
        navigateToResult(target.href);
      }
    }
  };

  return (
    <div
      data-nosnippet=""
      role="dialog"
      aria-modal="true"
      aria-label="Global catalog search"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8svh] px-4 max-md:pt-[max(0.75rem,var(--safe-area-inset-top))] max-md:px-2.5"
    >
      <button
        type="button"
        aria-label="Close search dialog"
        onClick={onClose}
        className="fixed inset-0 h-[100lvh] bg-slate-950/50 backdrop-blur-[2px]"
      />

      <div className="relative z-10 w-full max-w-2xl rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border-subtle)] max-md:gap-2 max-md:px-3 max-md:py-2.5">
          <Search
            className="w-5 h-5 text-[var(--text-muted)] shrink-0"
            aria-hidden="true"
          />
          <label htmlFor="ed-command-search-input" className="sr-only">
            Search books, mock exams, authors, or tags
          </label>
          <input
            ref={inputRef}
            id="ed-command-search-input"
            type="search"
            value={queryText}
            onChange={(e) => {
              setIsLoading(true);
              setQueryText(e.target.value);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search books, mock exams, authors, or syllabus tags..."
            className="flex-1 min-w-0 bg-transparent text-base text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          {queryText && (
            <button
              type="button"
              aria-label="Clear search query"
              onClick={() => {
                setIsLoading(true);
                setQueryText('');
              }}
              className="min-h-[48px] min-w-[48px] max-md:min-h-[44px] max-md:min-w-[44px] inline-flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] shrink-0"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] max-md:min-h-[44px] px-3.5 max-md:px-2.5 rounded-lg border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] shrink-0"
          >
            Esc
          </button>
        </div>

        <div className="max-h-[62svh] max-md:max-h-[72dvh] overflow-y-auto p-3 max-md:p-2 space-y-4">
          {isLoading && flatResults.length === 0 ? (
            <div className="py-10 text-center text-sm text-[var(--text-muted)]">
              Searching catalog...
            </div>
          ) : flatResults.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-semibold text-[var(--text-main)]">
                No matching books or exam packs found
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Try searching by subject, exam code, author name, or language.
              </p>
            </div>
          ) : (
            <>
              {books.length > 0 && (
                <div>
                  <p className="px-2.5 pb-1.5 text-xs font-semibold text-[var(--text-muted)]">
                    Books ({books.length})
                  </p>
                  <div className="space-y-1">
                    {books.map((b, bIdx) => {
                      const isSelected = activeIndex === bIdx;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => navigateToResult(`/books/${b.urlSlug}`)}
                          onMouseEnter={() => setActiveIndex(bIdx)}
                          className={cn(
                            'w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors',
                            isSelected
                              ? 'bg-[var(--bg-elevated)]'
                              : 'hover:bg-[var(--bg-elevated)]/60'
                          )}
                        >
                          <CatalogThumbnail
                            title={b.title}
                            collectionName="books"
                            imageUrl={b.imageUrl}
                            imageAlt={b.imageAlt}
                            imageTitle={b.imageTitle}
                            size="xs"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[var(--text-main)] truncate">
                              {b.title}
                            </p>
                            <p className="text-xs text-[var(--text-muted)] truncate">
                              {b.authorName} · {b.language} · {b.type}
                            </p>
                          </div>
                          <div className="flex items-baseline gap-1.5 tabular-nums shrink-0">
                            {(() => {
                              const pricing = getDefaultCatalogPricing(
                                'books',
                                b.buyPrice
                              );
                              return (
                                <>
                                  <span className="text-sm font-bold text-[var(--text-main)]">
                                    {pricing.isFree
                                      ? 'Free'
                                      : formatPrice(
                                          pricing.discountedPrice,
                                          b.currency
                                        )}
                                  </span>
                                  {pricing.discountPct > 0 && (
                                    <span className="text-[11px] font-semibold text-[var(--status-success)]">
                                      {pricing.discountPct}% OFF
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                          <ArrowUpRight
                            className="w-4 h-4 text-[var(--text-muted)] shrink-0"
                            aria-hidden="true"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {exams.length > 0 && (
                <div>
                  <p className="px-2.5 pb-1.5 text-xs font-semibold text-[var(--text-muted)]">
                    Exam Packs ({exams.length})
                  </p>
                  <div className="space-y-1">
                    {exams.map((ex, eIdx) => {
                      const globalIdx = books.length + eIdx;
                      const isSelected = activeIndex === globalIdx;
                      return (
                        <button
                          key={ex.id}
                          type="button"
                          onClick={() => navigateToResult(`/exams/${ex.urlSlug}`)}
                          onMouseEnter={() => setActiveIndex(globalIdx)}
                          className={cn(
                            'w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors',
                            isSelected
                              ? 'bg-[var(--bg-elevated)]'
                              : 'hover:bg-[var(--bg-elevated)]/60'
                          )}
                        >
                          <CatalogThumbnail
                            title={ex.title}
                            collectionName="ExamPackDocument"
                            imageUrl={ex.imageUrl}
                            imageAlt={ex.imageAlt}
                            imageTitle={ex.imageTitle}
                            size="xs"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[var(--text-main)] truncate">
                              {ex.title}
                            </p>
                            <p className="text-xs text-[var(--text-muted)] truncate">
                              {ex.authorName} · {ex.totalMocktest} Mock{' '}
                              {ex.totalMocktest === 1 ? 'Test' : 'Tests'} · {ex.language}
                            </p>
                          </div>
                          <div className="flex items-baseline gap-1.5 tabular-nums shrink-0">
                            {(() => {
                              const pricing = getDefaultCatalogPricing(
                                'ExamPackDocument',
                                ex.buyPrice
                              );
                              return (
                                <>
                                  <span className="text-sm font-bold text-[var(--text-main)]">
                                    {pricing.isFree
                                      ? 'Free'
                                      : formatPrice(
                                          pricing.discountedPrice,
                                          ex.currency
                                        )}
                                  </span>
                                  {pricing.discountPct > 0 && (
                                    <span className="text-[11px] font-semibold text-[var(--status-success)]">
                                      {pricing.discountPct}% OFF
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                          <ArrowUpRight
                            className="w-4 h-4 text-[var(--text-muted)] shrink-0"
                            aria-hidden="true"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="max-md:hidden flex items-center justify-between px-4 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs text-[var(--text-muted)]">
          <span>Navigate with ↑ ↓ · Enter to open</span>
          <span>Catalog Search</span>
        </div>
      </div>
    </div>
  );
}
