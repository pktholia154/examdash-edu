'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import dynamic from 'next/dynamic';

const LazyCommandSearchDialog = dynamic(
  () => import('./command-search-dialog').then((m) => m.CommandSearchDialog),
  { ssr: false }
);

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
  const [initialQuery, setInitialQuery] = useState('');

  const openSearch = useCallback((query: string = '') => {
    setInitialQuery(query);
    setIsOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [isOpen]);

  return (
    <SearchModalContext.Provider value={{ isOpen, openSearch, closeSearch }}>
      {children}
      {isOpen && (
        <LazyCommandSearchDialog
          initialQuery={initialQuery}
          onClose={closeSearch}
        />
      )}
    </SearchModalContext.Provider>
  );
}

export function useSearchModal() {
  return useContext(SearchModalContext);
}
