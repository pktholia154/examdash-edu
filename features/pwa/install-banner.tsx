'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_STORAGE_KEY = 'ed-install-banner-dismissed';
const BANNER_EVENT = 'ed-install-banner-change';

function subscribeBannerEnv(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  const mql = window.matchMedia('(display-mode: standalone)');
  mql.addEventListener('change', callback);
  window.addEventListener(BANNER_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    mql.removeEventListener('change', callback);
    window.removeEventListener(BANNER_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

function getBannerVisibilitySnapshot(): 'hidden' | 'ios' | 'standard' {
  if (typeof window === 'undefined') return 'hidden';
  const standaloneMatch =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  if (standaloneMatch) return 'hidden';

  try {
    if (localStorage.getItem(DISMISS_STORAGE_KEY) === '1') {
      return 'hidden';
    }
  } catch {
    // Ignore storage error
  }

  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) ? 'ios' : 'standard';
}

function getServerBannerSnapshot(): 'hidden' | 'ios' | 'standard' {
  return 'hidden';
}

export function InstallAppCallout() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showGuideModal, setShowGuideModal] = useState(false);

  const bannerMode = useSyncExternalStore(
    subscribeBannerEnv,
    getBannerVisibilitySnapshot,
    getServerBannerSnapshot
  );

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      window.dispatchEvent(new Event(BANNER_EVENT));
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  if (bannerMode === 'hidden') {
    return null;
  }

  const isIOS = bannerMode === 'ios';

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, '1');
    } catch {
      // Ignore
    }
    window.dispatchEvent(new Event(BANNER_EVENT));
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        handleDismiss();
      }
      return;
    }
    setShowGuideModal(true);
  };

  return (
    <>
      <div
        data-nosnippet=""
        className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-main)] shrink-0">
            <Smartphone className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-main)]">
              Add ExamDash to Home Screen
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Launch ebooks and mock exam sets in a distraction-free standalone window.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleInstallClick()}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isIOS ? 'iOS Setup' : 'Install App'}</span>
          </button>
          <button
            type="button"
            aria-label="Dismiss install banner"
            onClick={handleDismiss}
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {showGuideModal && (
        <div
          data-nosnippet=""
          role="dialog"
          aria-modal="true"
          aria-label="Install ExamDash instructions"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close install instructions"
            onClick={() => setShowGuideModal(false)}
            className="fixed inset-0 h-[100lvh] bg-slate-950/50 backdrop-blur-[2px]"
          />
          <div className="relative z-10 w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-6 shadow-xl">
            <h3 className="text-base font-bold text-[var(--text-main)]">
              Install ExamDash on your device
            </h3>
            {isIOS ? (
              <ol className="mt-3 space-y-2 text-sm text-[var(--text-muted)] list-decimal list-inside">
                <li>
                  Tap the <strong className="text-[var(--text-main)]">Share</strong>{' '}
                  <Share className="inline w-3.5 h-3.5" aria-hidden="true" /> button in Safari.
                </li>
                <li>
                  Select <strong className="text-[var(--text-main)]">Add to Home Screen</strong>.
                </li>
                <li>Tap <strong className="text-[var(--text-main)]">Add</strong> to launch full screen.</li>
              </ol>
            ) : (
              <p className="mt-3 text-sm text-[var(--text-muted)]">
                Open your browser&apos;s address bar or menu and choose{' '}
                <strong className="text-[var(--text-main)]">Install ExamDash</strong> (or{' '}
                <strong className="text-[var(--text-main)]">Add to Home Screen</strong>) for standalone desktop and mobile access.
              </p>
            )}
            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="mt-5 w-full min-h-[48px] rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
