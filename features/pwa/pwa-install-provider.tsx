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
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  LayoutGrid,
  MoreHorizontal,
  PlusSquare,
  Share,
  X,
} from 'lucide-react';
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

type GuidedSheetMode =
  | null
  | 'apple-ios'
  | 'apple-mac-safari'
  | 'in-app-webview'
  | 'iframe-preview';

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

      {/* Apple iOS / iPadOS Compact Guided Bottom Sheet (#apple-sheet) */}
      {visibleSheet === 'apple-ios' && (
        <div
          id="apple-sheet"
          data-nosnippet=""
          role="dialog"
          aria-modal="true"
          aria-label="Install ExamDash on Home Screen"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <button
            type="button"
            aria-label="Close install instructions"
            onClick={() => setActiveSheet(null)}
            className="fixed inset-0 h-[100lvh] bg-slate-950/55 backdrop-blur-[2px]"
          />
          <div className="relative z-10 w-full sm:max-w-md rounded-t-2xl sm:rounded-[var(--radius-card)] border-t sm:border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 pb-[calc(1.25rem+var(--safe-area-inset-bottom))] sm:p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Image
                  src="/assets/aistudio/exam-dash_logo_ef0c6c39.png"
                  alt="ExamDash"
                  width={40}
                  height={40}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-xl object-cover shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-[var(--text-main)] truncate">
                    Install ExamDash on Home Screen
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Standalone full-screen reader &amp; mock exam workspace
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close sheet"
                onClick={() => setActiveSheet(null)}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <ol className="mt-4 space-y-3 text-sm text-[var(--text-muted)]">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] shrink-0">
                  1
                </span>
                <span>
                  Tap{' '}
                  <strong className="inline-flex items-center gap-1 text-[var(--text-main)]">
                    Menu
                    <MoreHorizontal className="inline w-3.5 h-3.5" aria-hidden="true" />
                  </strong>{' '}
                  then{' '}
                  <strong className="inline-flex items-center gap-1 text-[var(--text-main)]">
                    Share
                    <Share className="inline w-3.5 h-3.5" aria-hidden="true" />
                  </strong>{' '}
                  in your browser bar <em>(or tap Share directly)</em>.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] shrink-0">
                  2
                </span>
                <span>
                  Scroll down and tap{' '}
                  <strong className="inline-flex items-center gap-1 text-[var(--text-main)]">
                    Add to Home Screen
                    <PlusSquare className="inline w-3.5 h-3.5" aria-hidden="true" />
                  </strong>
                  .
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] shrink-0">
                  3
                </span>
                <span>
                  Keep <strong className="text-[var(--text-main)]">Open as Web App</strong> on and tap{' '}
                  <strong className="text-[var(--text-main)]">Add</strong>.
                </span>
              </li>
            </ol>

            <div className="mt-4 flex items-center justify-center gap-1.5 text-xs font-medium text-[var(--text-muted)] sm:hidden">
              <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Use your browser toolbar below</span>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setActiveSheet(null)}
                className="w-full min-h-[48px] rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Got it
              </button>
              <button
                type="button"
                onClick={dismissAppleForever}
                className="w-full min-h-[44px] rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                Already added? Don&apos;t show again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Apple macOS Safari Add to Dock Popover / Modal */}
      {visibleSheet === 'apple-mac-safari' && (
        <div
          data-nosnippet=""
          role="dialog"
          aria-modal="true"
          aria-label="Add ExamDash to Mac Dock"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close Dock instructions"
            onClick={() => setActiveSheet(null)}
            className="fixed inset-0 h-[100lvh] bg-slate-950/55 backdrop-blur-[2px]"
          />
          <div className="relative z-10 w-full max-w-md rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Image
                  src="/assets/aistudio/exam-dash_logo_ef0c6c39.png"
                  alt="ExamDash"
                  width={40}
                  height={40}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-xl object-cover shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-[var(--text-main)] truncate">
                    Add ExamDash to your Mac Dock
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Launch standalone study windows from macOS
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setActiveSheet(null)}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <ol className="mt-4 space-y-3 text-sm text-[var(--text-muted)]">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] shrink-0">
                  1
                </span>
                <span>
                  Click{' '}
                  <strong className="inline-flex items-center gap-1 text-[var(--text-main)]">
                    Share
                    <Share className="inline w-3.5 h-3.5" aria-hidden="true" />
                  </strong>{' '}
                  in the Safari toolbar <em>(or open the <strong>File</strong> menu)</em>.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] shrink-0">
                  2
                </span>
                <span>
                  Select{' '}
                  <strong className="inline-flex items-center gap-1 text-[var(--text-main)]">
                    Add to Dock
                    <LayoutGrid className="inline w-3.5 h-3.5" aria-hidden="true" />
                  </strong>{' '}
                  and click <strong className="text-[var(--text-main)]">Add</strong>.
                </span>
              </li>
            </ol>

            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setActiveSheet(null)}
                className="w-full min-h-[48px] rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Got it
              </button>
              <button
                type="button"
                onClick={dismissAppleForever}
                className="w-full min-h-[44px] rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                Already added? Don&apos;t show again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-App WebView Escape Sheet (Instagram, WhatsApp, Facebook, LinkedIn) */}
      {visibleSheet === 'in-app-webview' && (
        <div
          data-nosnippet=""
          role="dialog"
          aria-modal="true"
          aria-label="Open in Browser to Install ExamDash"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <button
            type="button"
            aria-label="Close browser instructions"
            onClick={() => setActiveSheet(null)}
            className="fixed inset-0 h-[100lvh] bg-slate-950/55 backdrop-blur-[2px]"
          />
          <div className="relative z-10 w-full sm:max-w-md rounded-t-2xl sm:rounded-[var(--radius-card)] border-t sm:border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 pb-[calc(1.25rem+var(--safe-area-inset-bottom))] sm:p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Image
                  src="/assets/aistudio/exam-dash_logo_ef0c6c39.png"
                  alt="ExamDash"
                  width={40}
                  height={40}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-xl object-cover shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-[var(--text-main)] truncate">
                    Open in Browser to Install
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    In-app WebViews block Home Screen app installs
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setActiveSheet(null)}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <ol className="mt-4 space-y-3 text-sm text-[var(--text-muted)]">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] shrink-0">
                  1
                </span>
                <span>
                  Tap the{' '}
                  <strong className="inline-flex items-center gap-1 text-[var(--text-main)]">
                    Menu
                    <MoreHorizontal className="inline w-3.5 h-3.5" aria-hidden="true" />
                  </strong>{' '}
                  icon in the corner of this app.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] shrink-0">
                  2
                </span>
                <span>
                  Choose{' '}
                  <strong className="inline-flex items-center gap-1 text-[var(--text-main)]">
                    Open in Chrome / Safari
                    <ExternalLink className="inline w-3.5 h-3.5" aria-hidden="true" />
                  </strong>{' '}
                  to enable 1-tap installation.
                </span>
              </li>
            </ol>

            <div className="mt-5 flex flex-col sm:flex-row items-stretch gap-2.5">
              <button
                type="button"
                onClick={() => void handleCopyLink()}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-4 h-4 text-[var(--status-success)]" aria-hidden="true" />
                    <span>Link Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" aria-hidden="true" />
                    <span>Copy Page Link</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveSheet(null)}
                className="flex-1 min-h-[48px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Embedded Preview Frame Helper */}
      {visibleSheet === 'iframe-preview' && (
        <div
          data-nosnippet=""
          role="dialog"
          aria-modal="true"
          aria-label="Open full tab to install ExamDash"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close install dialog"
            onClick={() => setActiveSheet(null)}
            className="fixed inset-0 h-[100lvh] bg-slate-950/55 backdrop-blur-[2px]"
          />
          <div className="relative z-10 w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <Image
                src="/assets/aistudio/exam-dash_logo_ef0c6c39.png"
                alt="ExamDash"
                width={40}
                height={40}
                referrerPolicy="no-referrer"
                className="w-10 h-10 rounded-xl object-cover shrink-0"
              />
              <div>
                <h3 className="text-base font-bold text-[var(--text-main)]">
                  Install ExamDash App
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Open in a standalone browser tab to install
                </p>
              </div>
            </div>
            <p className="mt-3.5 text-sm text-[var(--text-muted)] leading-relaxed">
              Embedded preview frames restrict native OS app prompts. Open ExamDash in a full browser tab to trigger 1-click Home Screen or Desktop installation.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <a
                href={fullTabInstallHref}
                target="_blank"
                rel="noopener"
                onClick={() => setActiveSheet(null)}
                className="w-full inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                <span>Open Full Tab to Install</span>
                <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
              </a>
              <button
                type="button"
                onClick={() => setActiveSheet(null)}
                className="w-full min-h-[44px] rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </PWAInstallContext.Provider>
  );
}
