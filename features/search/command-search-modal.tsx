'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Search, X } from 'lucide-react';
import { MonogramThumbnail } from '../../components/ui/monogram-thumbnail';
import type { PublicBookDTO, PublicExamDTO } from '../../lib/types/catalog';
import { formatPrice } from '../../lib/registry/content-type-registry';
import { cn } from '../../lib/utils';

interface SearchModalContextValue {
  isOpen: boolean;
  openSearch: (initialQuery?: string) => void;
  closeSearch: () => void;
}

const SearchModalContext = createContext<SearchModalContextValue>({
  isOpen: false,
  openSearch: () => {},
  closeSearch: () => {},
});

export function SearchModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [books, setBooks] = useState<PublicBookDTO[]>([]);
  const [exams, setExams] = useState<PublicExamDTO[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  const openSearch = useCallback((initialQuery: string = '') => {
    setQueryText(initialQuery);
    setActiveIndex(0);
    setIsLoading(true);
    setIsOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => {
          if (!prev) {
            setIsLoading(true);
          }
          return !prev;
        });
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (!isOpen) return;
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 20);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  // Debounced cross-collection live query
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/v1/catalog/search?q=${encodeURIComponent(queryText.trim())}`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const data = (await res.json()) as {
            books?: PublicBookDTO[];
            exams?: PublicExamDTO[];
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
  }, [isOpen, queryText]);

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
      entries.push({
        key: `books:${b.id}`,
        href: `/books/${b.urlSlug}`,
        title: b.title,
        subtitle: `${b.authorName} · ${b.language}`,
        priceLabel:
          b.buyPrice === 0 ? 'Free' : formatPrice(b.buyPrice, b.currency),
        type: b.type,
        collectionName: 'books',
      });
    }

    for (const ex of exams) {
      entries.push({
        key: `ExamPackDocument:${ex.id}`,
        href: `/exams/${ex.urlSlug}`,
        title: ex.title,
        subtitle: `${ex.authorName} · ${ex.totalMocktest} Mock ${
          ex.totalMocktest === 1 ? 'Test' : 'Tests'
        }`,
        priceLabel:
          ex.buyPrice === 0 ? 'Free' : formatPrice(ex.buyPrice, ex.currency),
        type: ex.type,
        collectionName: 'ExamPackDocument',
      });
    }

    return entries;
  }, [books, exams]);

  const navigateToResult = useCallback(
    (href: string) => {
      setIsOpen(false);
      router.push(href);
    },
    [router]
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
    <SearchModalContext.Provider value={{ isOpen, openSearch, closeSearch }}>
      {children}

      {isOpen && (
        <div
          data-nosnippet=""
          role="dialog"
          aria-modal="true"
          aria-label="Global catalog search"
          className="fixed inset-0 z-50 flex items-start justify-center pt-[8svh] px-4"
        >
          <button
            type="button"
            aria-label="Close search dialog"
            onClick={closeSearch}
            className="fixed inset-0 h-[100lvh] bg-slate-950/50 backdrop-blur-[2px]"
          />

          <div className="relative z-10 w-full max-w-2xl rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-2xl overflow-hidden">
            {/* Search Input Header */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border-subtle)]">
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
                className="flex-1 bg-transparent text-base text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
              {queryText && (
                <button
                  type="button"
                  aria-label="Clear search query"
                  onClick={() => {
                    setIsLoading(true);
                    setQueryText('');
                  }}
                  className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={closeSearch}
                className="px-2.5 py-1 rounded border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                Esc
              </button>
            </div>

            {/* Grouped Results */}
            <div className="max-h-[62svh] overflow-y-auto p-3 space-y-4">
              {isLoading && flatResults.length === 0 ? (
                <div className="py-10 text-center text-sm text-[var(--text-muted)]">
                  Searching live catalog...
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
                              <MonogramThumbnail
                                title={b.title}
                                type={b.type}
                                collectionName="books"
                                size="sm"
                                showBadge={false}
                                className="w-11 h-11"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-[var(--text-main)] truncate">
                                  {b.title}
                                </p>
                                <p className="text-xs text-[var(--text-muted)] truncate">
                                  {b.authorName} · {b.language} · {b.type}
                                </p>
                              </div>
                              <span className="text-sm font-bold text-[var(--text-main)] tabular-nums shrink-0">
                                {b.buyPrice === 0
                                  ? 'Free'
                                  : formatPrice(b.buyPrice, b.currency)}
                              </span>
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
                              <MonogramThumbnail
                                title={ex.title}
                                type={ex.type}
                                collectionName="ExamPackDocument"
                                size="sm"
                                showBadge={false}
                                className="w-11 h-11"
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
                              <span className="text-sm font-bold text-[var(--text-main)] tabular-nums shrink-0">
                                {ex.buyPrice === 0
                                  ? 'Free'
                                  : formatPrice(ex.buyPrice, ex.currency)}
                              </span>
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

            {/* Keyboard Hint Footer */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs text-[var(--text-muted)]">
              <span>Navigate with ↑ ↓ · Enter to open</span>
              <span>Live Firestore Search</span>
            </div>
          </div>
        </div>
      )}
    </SearchModalContext.Provider>
  );
}

export function useSearchModal() {
  return useContext(SearchModalContext);
}
