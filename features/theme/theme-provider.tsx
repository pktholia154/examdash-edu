'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react';
import { syncNativeSystemBars } from '../../lib/platform/capacitor-bridge';

export type ThemeMode = 'light' | 'dark';

export const DARK_THEME_HEX = '#0B1120';
export const LIGHT_THEME_HEX = '#F8FAFC';

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

function subscribeTheme(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

function getThemeSnapshot(): ThemeMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function getServerThemeSnapshot(): ThemeMode {
  return 'light';
}

function syncMetaThemeColor(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const hex = mode === 'dark' ? DARK_THEME_HEX : LIGHT_THEME_HEX;
  document.documentElement.style.colorScheme = mode;
  let metaTheme = document.querySelector('meta[name="theme-color"]');
  if (!metaTheme) {
    metaTheme = document.createElement('meta');
    metaTheme.setAttribute('name', 'theme-color');
    document.head.appendChild(metaTheme);
  }
  metaTheme.setAttribute('content', hex);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot
  );

  // Mirror active theme to <meta name="theme-color"> & Capacitor StatusBar/SystemBars on boot and change
  useEffect(() => {
    syncMetaThemeColor(theme);
    void syncNativeSystemBars(theme);
  }, [theme]);

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
