'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';

export const FOCUS_SEARCH_EVENT = 'ed-focus-search';

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

/**
 * Full-width page navigation controller for Search (/search) and global Cmd/Ctrl+K shortcut.
 */
export function SearchModalProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const isOnSearchPage = pathname === '/search';

  const openSearch = useCallback(
    (query: string = '') => {
      const trimmed = query.trim();
      const target = trimmed
        ? `/search?q=${encodeURIComponent(trimmed)}`
        : '/search';

      if (pathname === '/search' && !trimmed) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT));
        }
        return;
      }

      router.push(target);
    },
    [pathname, router]
  );

  const closeSearch = useCallback(() => {
    if (pathname === '/search') {
      router.back();
    }
  }, [pathname, router]);

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [openSearch]);

  return (
    <SearchModalContext.Provider
      value={{ isOpen: isOnSearchPage, openSearch, closeSearch }}
    >
      {children}
    </SearchModalContext.Provider>
  );
}

export function useSearchModal() {
  return useContext(SearchModalContext);
}
