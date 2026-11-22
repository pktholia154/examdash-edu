'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { syncNativeSystemBars } from '../../lib/platform/capacitor-bridge';

export type ThemeMode = 'light' | 'dark';

export const DARK_THEME_HEX = '#141514';
export const LIGHT_THEME_HEX = '#F3F3EF';

interface ThemeContextValue {
  theme: ThemeMode;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => {},
});

const THEME_STORAGE_KEY = 'ed-theme';
const THEME_EVENT = 'ed-theme-change';

function getThemeSnapshot(): ThemeMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function syncMetaThemeColor(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const hex = mode === 'dark' ? DARK_THEME_HEX : LIGHT_THEME_HEX;
  const metaThemes = document.querySelectorAll('meta[name="theme-color"]');
  if (metaThemes.length === 0) {
    const metaTheme = document.createElement('meta');
    metaTheme.setAttribute('name', 'theme-color');
    metaTheme.setAttribute('content', hex);
    document.head.appendChild(metaTheme);
  } else {
    metaThemes.forEach((metaTheme) => {
      metaTheme.setAttribute('content', hex);
    });
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>('light');

  // Sync active theme post-hydration & mirror to <meta name="theme-color"> + Capacitor SystemBars
  useEffect(() => {
    const syncFromDom = () => {
      const current = getThemeSnapshot();
      setTheme(current);
      syncMetaThemeColor(current);
      void syncNativeSystemBars(current);
    };
    syncFromDom();
    window.addEventListener(THEME_EVENT, syncFromDom);
    window.addEventListener('storage', syncFromDom);
    return () => {
      window.removeEventListener(THEME_EVENT, syncFromDom);
      window.removeEventListener('storage', syncFromDom);
    };
  }, []);

  const applyTheme = useCallback((next: ThemeMode) => {
    const root = document.documentElement;
    if (next === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Ignore storage quota / private mode errors
    }
    syncMetaThemeColor(next);
    void syncNativeSystemBars(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  const toggleTheme = useCallback(() => {
    const current = getThemeSnapshot();
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }, [applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
