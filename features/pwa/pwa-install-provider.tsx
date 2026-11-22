'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { isCapacitorNative } from '../../lib/platform/capacitor-bridge';
import {
  buildOpenInAppHref,
  isAndroidUserAgent,
  isCrawlerUserAgent,
  resolvePWADeviceRoute,
  stripPwaLaunchParams,
} from '../../lib/pwa/detection';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface RelatedApplicationEntry {
  platform?: string;
  url?: string;
  id?: string;
}

interface NavigatorWithPWA extends Navigator {
  standalone?: boolean;
  getInstalledRelatedApps?: () => Promise<RelatedApplicationEntry[]>;
}

declare global {
  interface Window {
    __edBip?: BeforeInstallPromptEvent | null;
  }
}

export type PWAInstallStatus =
  | 'hidden'
  | 'ready-to-install'
  | 'installing'
  | 'installed-success'
  | 'open-in-app'
  | 'apple-ios'
  | 'apple-mac-safari'
  | 'in-app-webview'
  | 'iframe-preview';

import type { GuidedSheetKind } from './pwa-guided-sheets';

type GuidedSheetMode = null | GuidedSheetKind;

const LazyPWAGuidedSheets = dynamic(
  () => import('./pwa-guided-sheets').then((m) => m.PWAGuidedSheets),
  { ssr: false }
);

const STORAGE_INSTALLED_HINT = 'pwa_installed_hint';
const STORAGE_APPLE_DISMISSED = 'apple_pwa_dismissed';
const SESSION_BANNER_DISMISSED = 'ed_pwa_banner_dismissed';

interface PWAStoreSnapshot {
  status: PWAInstallStatus;
  progressLabel: string;
  progressPercent: number;
  currentSearch: string;
  isBannerDismissed: boolean;
}

const SERVER_SNAPSHOT: PWAStoreSnapshot = {
  status: 'hidden',
  progressLabel: '',
  progressPercent: 0,
  currentSearch: '',
  isBannerDismissed: false,
};

function checkStandaloneEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  if (isCapacitorNative()) return true;
  const standaloneDisplay =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches;
  const navStandalone = (window.navigator as NavigatorWithPWA).standalone === true;
  return standaloneDisplay || navStandalone;
}

async function checkIsInstalledOnOS(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as NavigatorWithPWA;
  if (typeof nav.getInstalledRelatedApps !== 'function') return false;
  try {
    const apps = await nav.getInstalledRelatedApps();
    return Array.isArray(apps) && apps.length > 0;
  } catch {
    return false;
  }
}

function readLocalFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeLocalFlag(key: string, enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(key, '1');
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore private browsing storage restrictions
  }
}

function readSessionFlag(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeSessionFlag(key: string, enabled: boolean): void {
  try {
    if (enabled) {
      sessionStorage.setItem(key, '1');
    } else {
      sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage restrictions
  }
}

/**
 * Singleton Production PWA Controller Store
 * Synchronizes OS capability detection, beforeinstallprompt, getInstalledRelatedApps() polling,
 * and stepped WebAPK verification across all mounted React components via useSyncExternalStore.
 */
function createPWAInstallerStore() {
  let snapshot: PWAStoreSnapshot = { ...SERVER_SNAPSHOT };
  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  let booted = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let completeTimeout: ReturnType<typeof setTimeout> | null = null;
  let fallbackHintTimeout: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  function emit(patch: Partial<PWAStoreSnapshot>) {
    const next: PWAStoreSnapshot = { ...snapshot, ...patch };
    if (
      next.status === snapshot.status &&
      next.progressLabel === snapshot.progressLabel &&
      next.progressPercent === snapshot.progressPercent &&
      next.currentSearch === snapshot.currentSearch &&
      next.isBannerDismissed === snapshot.isBannerDismissed
    ) {
      return;
    }
    snapshot = next;
    listeners.forEach((l) => l());
  }

  function clearTimers() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (completeTimeout) {
      clearTimeout(completeTimeout);
      completeTimeout = null;
    }
    if (fallbackHintTimeout) {
      clearTimeout(fallbackHintTimeout);
      fallbackHintTimeout = null;
    }
  }

  function verifyIconOnHomeScreen() {
    if (
      snapshot.status === 'installing' ||
      snapshot.status === 'installed-success'
    ) {
      return;
    }

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    let elapsed = 0;
    const isAndroid =
      typeof navigator !== 'undefined' && isAndroidUserAgent(navigator.userAgent);

    emit({
      status: 'installing',
      progressLabel: 'Building app package...',
      progressPercent: 45,
    });

    pollTimer = setInterval(() => {
      elapsed += 1000;
      if (elapsed === 3000) {
        emit({
          progressLabel: 'Adding icon to Home Screen...',
          progressPercent: 80,
        });
      }

      void (async () => {
        const installedOnOS = await checkIsInstalledOnOS();
        const standaloneNow = checkStandaloneEnvironment();
        const readyToComplete =
          standaloneNow ||
          (installedOnOS && (!isAndroid || elapsed >= 2000)) ||
          elapsed >= 8000;

        if (readyToComplete && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;

          writeLocalFlag(STORAGE_INSTALLED_HINT, true);
          writeSessionFlag(SESSION_BANNER_DISMISSED, false);

          emit({
            status: 'installed-success',
            progressLabel: 'Successfully Installed ✓',
            progressPercent: 100,
            isBannerDismissed: false,
          });

          completeTimeout = setTimeout(() => {
            if (checkStandaloneEnvironment()) {
              emit({ status: 'hidden' });
            } else {
              emit({ status: 'open-in-app' });
            }
          }, 1800);
        }
      })();
    }, 1000);
  }

  function bootIfNeeded() {
    if (booted || typeof window === 'undefined') return;
    booted = true;

    const ua = window.navigator.userAgent || '';
    if (isCrawlerUserAgent(ua)) {
      emit({ status: 'hidden' });
      return;
    }

    const bannerDismissed = readSessionFlag(SESSION_BANNER_DISMISSED);

    // Register pass-through Service Worker for Chromium WebAPK & Desktop PWA installability
    if (!isCapacitorNative() && 'serviceWorker' in window.navigator) {
      window.navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(() => {
          // Non-blocking if SW is restricted in private/sandboxed contexts
        });
    }

    const standaloneMql = window.matchMedia('(display-mode: standalone)');
    standaloneMql.addEventListener('change', (e: MediaQueryListEvent) => {
      if (e.matches || checkStandaloneEnvironment()) {
        writeLocalFlag(STORAGE_INSTALLED_HINT, true);
        clearTimers();
        emit({ status: 'hidden' });
      }
    });

    const route = resolvePWADeviceRoute({
      userAgent: ua,
      maxTouchPoints: window.navigator.maxTouchPoints || 0,
      isStandaloneDisplay: checkStandaloneEnvironment(),
      isNavigatorStandalone:
        (window.navigator as NavigatorWithPWA).standalone === true,
      isCapacitorNative: isCapacitorNative(),
    });

    // 1. Already inside installed app or Capacitor shell -> hide all install/open UI
    if (route === 'standalone') {
      writeLocalFlag(STORAGE_INSTALLED_HINT, true);
      emit({ status: 'hidden', isBannerDismissed: bannerDismissed });
      return;
    }

    // 2. Social / Messaging In-App WebViews -> prompt to open in Chrome / Safari
    if (route === 'in-app-webview') {
      emit({ status: 'in-app-webview', isBannerDismissed: bannerDismissed });
      return;
    }

    // 3. Apple iOS / iPadOS or macOS Safari -> guided Share / Add to Dock flows
    if (route === 'apple-ios' || route === 'apple-mac-safari') {
      if (readLocalFlag(STORAGE_APPLE_DISMISSED)) {
        emit({ status: 'hidden', isBannerDismissed: bannerDismissed });
      } else {
        emit({ status: route, isBannerDismissed: bannerDismissed });
      }
      return;
    }

    // 4. Non-Apple (Android, Windows, Linux, macOS Chrome/Edge)
    emit({ isBannerDismissed: bannerDismissed });

    let isEmbeddedIframe = false;
    try {
      isEmbeddedIframe = window.self !== window.top;
    } catch {
      isEmbeddedIframe = true;
    }

    const consumePromptEvent = (evt: BeforeInstallPromptEvent) => {
      deferredPrompt = evt;
      // Auto-heal if the user previously installed and later uninstalled the PWA
      writeLocalFlag(STORAGE_INSTALLED_HINT, false);
      if (
        snapshot.status !== 'installing' &&
        snapshot.status !== 'installed-success'
      ) {
        emit({ status: 'ready-to-install' });
      }
    };

    if (window.__edBip) {
      const earlyEvt = window.__edBip;
      window.__edBip = null;
      consumePromptEvent(earlyEvt);
    }

    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      window.__edBip = null;
      consumePromptEvent(e as BeforeInstallPromptEvent);
    });

    window.addEventListener('ed-bip-ready', () => {
      if (window.__edBip) {
        const captured = window.__edBip;
        window.__edBip = null;
        consumePromptEvent(captured);
      }
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      window.__edBip = null;
      verifyIconOnHomeScreen();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (
        snapshot.status === 'installing' ||
        snapshot.status === 'installed-success'
      ) {
        return;
      }
      void (async () => {
        if (checkStandaloneEnvironment()) {
          emit({ status: 'hidden' });
          return;
        }
        if (await checkIsInstalledOnOS()) {
          writeLocalFlag(STORAGE_INSTALLED_HINT, true);
          emit({ status: 'open-in-app' });
        }
      })();
    });

    void (async () => {
      const installedOnOS = await checkIsInstalledOnOS();
      if (installedOnOS) {
        writeLocalFlag(STORAGE_INSTALLED_HINT, true);
        emit({ status: 'open-in-app' });
        return;
      }

      if (deferredPrompt) {
        emit({ status: 'ready-to-install' });
        return;
      }

      fallbackHintTimeout = setTimeout(() => {
        if (
          snapshot.status === 'installing' ||
          snapshot.status === 'installed-success' ||
          snapshot.status === 'open-in-app' ||
          deferredPrompt
        ) {
          return;
        }
        if (readLocalFlag(STORAGE_INSTALLED_HINT)) {
          emit({ status: 'open-in-app' });
        } else if (isEmbeddedIframe) {
          emit({ status: 'iframe-preview' });
        }
      }, 1500);
    })();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      bootIfNeeded();
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): PWAStoreSnapshot {
      return snapshot;
    },
    getServerSnapshot(): PWAStoreSnapshot {
      return SERVER_SNAPSHOT;
    },
    hasDeferredPrompt(): boolean {
      return deferredPrompt !== null;
    },
    async triggerNativeInstall(): Promise<void> {
      const promptEvent = deferredPrompt;
      if (!promptEvent) return;
      try {
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        deferredPrompt = null;
        if (outcome === 'accepted') {
          verifyIconOnHomeScreen();
        }
      } catch {
        deferredPrompt = null;
      }
    },
    syncRouteSearch(pathname: string) {
      if (typeof window === 'undefined') return;
      const rawSearch = window.location.search || '';
      const cleanedUrl = stripPwaLaunchParams(pathname, rawSearch);
      if (cleanedUrl) {
        try {
          window.history.replaceState(window.history.state, '', cleanedUrl);
          const qIdx = cleanedUrl.indexOf('?');
          emit({ currentSearch: qIdx >= 0 ? cleanedUrl.slice(qIdx) : '' });
          return;
        } catch {
          // Fall through
        }
      }
      emit({ currentSearch: rawSearch });
    },
    dismissBanner() {
      writeSessionFlag(SESSION_BANNER_DISMISSED, true);
      emit({ isBannerDismissed: true });
    },
    dismissAppleForever() {
      writeLocalFlag(STORAGE_APPLE_DISMISSED, true);
      emit({ status: 'hidden' });
    },
  };
}

const pwaStore = createPWAInstallerStore();

export interface PWAInstallContextValue {
  status: PWAInstallStatus;
  progressLabel: string;
  progressPercent: number;
  openInAppHref: string;
  isBannerDismissed: boolean;
  triggerPrimaryAction: () => Promise<void>;
  dismissBanner: () => void;
  dismissAppleForever: () => void;
}

const PWAInstallContext = createContext<PWAInstallContextValue>({
  status: 'hidden',
  progressLabel: '',
  progressPercent: 0,
  openInAppHref: '/?from=browser',
  isBannerDismissed: false,
  triggerPrimaryAction: async () => {},
  dismissBanner: () => {},
  dismissAppleForever: () => {},
});

export function usePWAInstall(): PWAInstallContextValue {
  return useContext(PWAInstallContext);
}

export function PWAInstallProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';

  const {
    status,
    progressLabel,
    progressPercent,
    currentSearch,
    isBannerDismissed,
  } = useSyncExternalStore(
    pwaStore.subscribe,
    pwaStore.getSnapshot,
    pwaStore.getServerSnapshot
  );

  const [activeSheet, setActiveSheet] = useState<GuidedSheetMode>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Clean ephemeral launch query params (?source=pwa, ?from=browser) post-mount per route
  useEffect(() => {
    pwaStore.syncRouteSearch(pathname);
  }, [pathname]);

  // Close guided sheet on Escape key or if app transitions into standalone mode
  useEffect(() => {
    if (!activeSheet) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveSheet(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSheet]);

  const triggerPrimaryAction = useCallback(async () => {
    if (status === 'apple-ios') {
      setActiveSheet('apple-ios');
      return;
    }
    if (status === 'apple-mac-safari') {
      setActiveSheet('apple-mac-safari');
      return;
    }
    if (status === 'in-app-webview') {
      setCopiedLink(false);
      setActiveSheet('in-app-webview');
      return;
    }
    if (status === 'iframe-preview' && !pwaStore.hasDeferredPrompt()) {
      setActiveSheet('iframe-preview');
      return;
    }

    await pwaStore.triggerNativeInstall();
  }, [status]);

  const dismissBanner = useCallback(() => {
    pwaStore.dismissBanner();
  }, []);

  const dismissAppleForever = useCallback(() => {
    setActiveSheet(null);
    pwaStore.dismissAppleForever();
  }, []);

  const handleCopyLink = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const cleanShareUrl = `${window.location.origin}${pathname}${currentSearch}`;
    try {
      await window.navigator.clipboard.writeText(cleanShareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      // Ignore clipboard permission errors
    }
  }, [currentSearch, pathname]);

  const openInAppHref = useMemo(
    () => buildOpenInAppHref(pathname, currentSearch),
    [pathname, currentSearch]
  );

  const fullTabInstallHref = useMemo(() => {
    const safePath = pathname && pathname.startsWith('/') ? pathname : '/';
    return `${safePath}${currentSearch}`;
  }, [pathname, currentSearch]);

  const visibleSheet = status === 'hidden' ? null : activeSheet;

  const contextValue = useMemo<PWAInstallContextValue>(
    () => ({
      status,
      progressLabel,
      progressPercent,
      openInAppHref,
      isBannerDismissed,
      triggerPrimaryAction,
      dismissBanner,
      dismissAppleForever,
    }),
    [
      status,
      progressLabel,
      progressPercent,
      openInAppHref,
      isBannerDismissed,
      triggerPrimaryAction,
      dismissBanner,
      dismissAppleForever,
    ]
  );

  return (
    <PWAInstallContext.Provider value={contextValue}>
      {children}

      {visibleSheet && (
        <LazyPWAGuidedSheets
          sheet={visibleSheet}
          copiedLink={copiedLink}
          fullTabInstallHref={fullTabInstallHref}
          onClose={() => setActiveSheet(null)}
          onDismissAppleForever={dismissAppleForever}
          onCopyLink={() => void handleCopyLink()}
        />
      )}
    </PWAInstallContext.Provider>
  );
}
