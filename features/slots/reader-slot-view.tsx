'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import dynamic from 'next/dynamic';
import { AlertCircle, Loader2, Lock, RefreshCw } from 'lucide-react';
import type { PublicBookDTO } from '../../lib/types/catalog';
import { makeCompositeKey } from '../../lib/registry/content-type-registry';
import {
  getCachedSignedGrant,
  hasBookFormatOffline,
  OFFLINE_VAULT_UPDATED_EVENT,
  requestSignedAssetUnlock,
} from '../../lib/offline/offline-vault';
import { apiUrl } from '../../lib/platform/api-base';
import { useAuth } from '../auth/auth-provider';
import { useToast } from '../toast/toast-context';
import {
  ReaderTopBar,
  type ReaderTopBarProps,
} from '../reader/shared/reader-top-bar';

const PdfViewer = dynamic(
  () => import('../reader/pdf/pdf-viewer').then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center flex-1 h-full bg-[var(--bg-canvas)] text-sm text-[var(--text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin me-2" aria-hidden="true" />
        <span>Loading PDF...</span>
      </div>
    ),
  }
);

const MarkdownViewer = dynamic(
  () =>
    import('../reader/markdown/markdown-viewer').then((m) => m.MarkdownViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center flex-1 h-full bg-[var(--bg-canvas)] text-sm text-[var(--text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin me-2" aria-hidden="true" />
        <span>Loading Markdown...</span>
      </div>
    ),
  }
);

function subscribeOnlineStatus(cb: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

function getOnlineSnapshot(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

interface UnlockedBookAssetState {
  pdfUrl?: string;
  markdownUrl?: string;
  directPdfUrl?: string;
  directMarkdownUrl?: string;
  pdfStoragePath?: string;
  markdownStoragePath?: string;
  expiresAtIso?: string;
}

export function ReaderSlotView({
  book,
  initialMode,
  initialFormat,
  initialSource = 'online',
  sampleMarkdownPreview,
}: {
  book: PublicBookDTO;
  initialMode: 'sample' | 'full';
  initialFormat: 'markdown' | 'pdf';
  initialSource?: 'online' | 'offline';
  sampleMarkdownPreview: string;
}) {
  const {
    user,
    isAuthReady,
    isEntitlementsReady,
    ownedCompositeKeys,
    ownedSlugs,
    getIdToken,
    signInWithGoogle,
  } = useAuth();
  const { showToast } = useToast();
  const isOnline = useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineSnapshot,
    () => true
  );

  const isOwned =
    book.buyPrice === 0 ||
    ownedCompositeKeys.has(makeCompositeKey('books', book.id)) ||
    ownedSlugs.has(`books:${book.urlSlug}`);

  const [format, setFormat] = useState<'markdown' | 'pdf'>(initialFormat);
  const [mode, setMode] = useState<'sample' | 'full'>(initialMode);
  const [preferOffline, setPreferOffline] = useState<boolean>(
    initialSource === 'offline'
  );
  const [offlineFormats, setOfflineFormats] = useState<{
    pdf: boolean;
    markdown: boolean;
  }>({ pdf: false, markdown: false });
  const [vaultChecked, setVaultChecked] = useState<boolean>(false);

  const [signedUrls, setSignedUrls] = useState<UnlockedBookAssetState | null>(
    () => {
      if (!user?.uid) return null;
      const cached = getCachedSignedGrant(user.uid, 'books', book.urlSlug);
      if (!cached) return null;
      return {
        pdfUrl: cached.assets.pdfUrl,
        markdownUrl: cached.assets.markdownUrl,
        directPdfUrl: cached.directUrls?.pdfUrl,
        directMarkdownUrl: cached.directUrls?.markdownUrl,
        pdfStoragePath: cached.storagePaths?.fullPdfStoragePath,
        markdownStoragePath: cached.storagePaths?.fullMarkdownStoragePath,
        expiresAtIso: cached.expiresAtIso,
      };
    }
  );
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const autoUnlockAttemptedKeyRef = useRef<string>('');

  const userId = user?.uid;
  const authAndEntitlementsReady =
    isAuthReady && (!user || isEntitlementsReady);
  const isSampleView = mode === 'sample' || !isOwned;

  const hasPdfAvailable = isSampleView
    ? Boolean(book.samplePdfUrl)
    : !isOnline
    ? offlineFormats.pdf
    : Boolean(
        book.hasFullPdf ||
          signedUrls?.pdfUrl ||
          signedUrls?.pdfStoragePath ||
          offlineFormats.pdf
      );
  const hasMarkdownAvailable = isSampleView
    ? Boolean(book.sampleMarkdownUrl)
    : !isOnline
    ? offlineFormats.markdown
    : Boolean(
        book.hasFullMarkdown ||
          signedUrls?.markdownUrl ||
          signedUrls?.markdownStoragePath ||
          offlineFormats.markdown
      );

  const effectiveFormat: 'markdown' | 'pdf' =
    format === 'pdf' && !hasPdfAvailable && hasMarkdownAvailable
      ? 'markdown'
      : format === 'markdown' && !hasMarkdownAvailable && hasPdfAvailable
      ? 'pdf'
      : format;

  const hasOfflineCopy =
    effectiveFormat === 'pdf' ? offlineFormats.pdf : offlineFormats.markdown;
  const effectiveOfflineMode = !isSampleView && (!isOnline || preferOffline);

  // Sync whether PDF and Markdown full editions are saved in the UID-scoped offline vault
  useEffect(() => {
    if (!authAndEntitlementsReady && mode === 'full') {
      return;
    }

    let active = true;
    const syncVault = async () => {
      if (!userId || isSampleView) {
        if (active) {
          setOfflineFormats({ pdf: false, markdown: false });
          setVaultChecked(true);
        }
        return;
      }
      const [savedPdf, savedMd] = await Promise.all([
        hasBookFormatOffline(userId, book.id, 'pdf'),
        hasBookFormatOffline(userId, book.id, 'markdown'),
      ]);
      if (active) {
        setOfflineFormats({ pdf: savedPdf, markdown: savedMd });
        setVaultChecked(true);
        if (!isOnline && (savedPdf || savedMd)) {
          setPreferOffline(true);
        }
        if ((!isOnline || initialSource === 'offline') && !savedPdf && savedMd) {
          setFormat('markdown');
        } else if (
          (!isOnline || initialSource === 'offline') &&
          savedPdf &&
          !savedMd &&
          format === 'markdown'
        ) {
          setFormat('pdf');
        }
      }
    };

    void syncVault();
    window.addEventListener(OFFLINE_VAULT_UPDATED_EVENT, syncVault);
    return () => {
      active = false;
      window.removeEventListener(OFFLINE_VAULT_UPDATED_EVENT, syncVault);
    };
  }, [
    authAndEntitlementsReady,
    book.id,
    format,
    initialSource,
    isOnline,
    isSampleView,
    mode,
    userId,
  ]);

  const unlockFullBook = useCallback(
    async (
      forceRefresh: boolean = false,
      options?: { silentStateUpdate?: boolean }
    ): Promise<UnlockedBookAssetState | null> => {
      if (!userId || !isOnline) return null;
      const silent = options?.silentStateUpdate === true;

      if (!silent) {
        setUnlocking(true);
        setUnlockError(null);
      }

      try {
        const grant = await requestSignedAssetUnlock({
          uid: userId,
          collectionName: 'books',
          urlSlug: book.urlSlug,
          getIdToken,
          forceRefresh,
        });
        const next: UnlockedBookAssetState = {
          pdfUrl: grant.assets.pdfUrl,
          markdownUrl: grant.assets.markdownUrl,
          directPdfUrl: grant.directUrls?.pdfUrl,
          directMarkdownUrl: grant.directUrls?.markdownUrl,
          pdfStoragePath: grant.storagePaths?.fullPdfStoragePath,
          markdownStoragePath: grant.storagePaths?.fullMarkdownStoragePath,
          expiresAtIso: grant.expiresAtIso,
        };
        if (!silent) {
          setSignedUrls(next);
          setUnlockError(null);
        }
        return next;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to verify signed reader session.';
        if (!silent) {
          setUnlockError(msg);
          if (!hasOfflineCopy) {
            showToast(msg, 'danger');
          }
        }
        return null;
      } finally {
        if (!silent) {
          setUnlocking(false);
        }
      }
    },
    [book.urlSlug, getIdToken, hasOfflineCopy, isOnline, showToast, userId]
  );

  useEffect(() => {
    if (
      !authAndEntitlementsReady ||
      !isOwned ||
      !userId ||
      signedUrls ||
      mode !== 'full' ||
      !isOnline ||
      (effectiveOfflineMode && hasOfflineCopy)
    ) {
      return;
    }

    const attemptKey = `${userId}:${book.urlSlug}:${mode}`;
    if (autoUnlockAttemptedKeyRef.current === attemptKey) {
      return;
    }
    autoUnlockAttemptedKeyRef.current = attemptKey;

    let cancelled = false;
    const autoUnlock = async () => {
      const cached = getCachedSignedGrant(userId, 'books', book.urlSlug);
      if (cached && !cancelled) {
        setSignedUrls({
          pdfUrl: cached.assets.pdfUrl,
          markdownUrl: cached.assets.markdownUrl,
          directPdfUrl: cached.directUrls?.pdfUrl,
          directMarkdownUrl: cached.directUrls?.markdownUrl,
          pdfStoragePath: cached.storagePaths?.fullPdfStoragePath,
          markdownStoragePath: cached.storagePaths?.fullMarkdownStoragePath,
          expiresAtIso: cached.expiresAtIso,
        });
        setUnlockError(null);
        return;
      }
      await unlockFullBook(false);
    };

    void autoUnlock();
    return () => {
      cancelled = true;
    };
  }, [
    authAndEntitlementsReady,
    book.urlSlug,
    effectiveOfflineMode,
    hasOfflineCopy,
    isOnline,
    isOwned,
    mode,
    signedUrls,
    unlockFullBook,
    userId,
  ]);

  const samplePdfStreamUrl = apiUrl(
    `/api/v1/library/stream?collection=books&slug=${encodeURIComponent(
      book.urlSlug
    )}&mode=sample&format=pdf`
  );
  const sampleMdStreamUrl = apiUrl(
    `/api/v1/library/stream?collection=books&slug=${encodeURIComponent(
      book.urlSlug
    )}&mode=sample&format=markdown`
  );

  const activePdfUrl = isSampleView
    ? samplePdfStreamUrl
    : signedUrls?.pdfUrl
    ? apiUrl(signedUrls.pdfUrl)
    : '';
  const activeMdUrl = isSampleView
    ? sampleMdStreamUrl
    : signedUrls?.markdownUrl
    ? apiUrl(signedUrls.markdownUrl)
    : '';

  const backHref = isOwned ? '/purchased' : `/books/${book.urlSlug}`;
  const canSwitchFormat = hasPdfAvailable && hasMarkdownAvailable;

  const topBar: ReaderTopBarProps = {
    title: book.title,
    activeFormat: effectiveFormat,
    canSwitchFormat,
    onFormatChange: setFormat,
    closeHref: backHref,
  };

  const shouldWaitForSignedStream =
    !isSampleView &&
    !hasOfflineCopy &&
    isOnline &&
    !signedUrls &&
    !unlockError;

  const shouldShowUnlockError =
    !isSampleView &&
    !hasOfflineCopy &&
    isOnline &&
    !signedUrls &&
    !unlocking &&
    Boolean(unlockError);

  return (
    <div className="fixed inset-0 z-50 h-[100dvh] w-screen flex flex-col overflow-hidden bg-[var(--bg-canvas)]">
      {(!authAndEntitlementsReady || !vaultChecked) && mode === 'full' ? (
        <>
          <ReaderTopBar {...topBar} />
          <div className="flex items-center justify-center flex-1 p-6">
            <Loader2
              className="w-6 h-6 animate-spin text-[var(--text-muted)] me-2"
              aria-hidden="true"
            />
            <span className="text-sm font-medium text-[var(--text-muted)]">
              Checking library entitlement...
            </span>
          </div>
        </>
      ) : !isOwned && mode === 'full' ? (
        <>
          <ReaderTopBar {...topBar} />
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 sm:p-8 text-center max-w-md w-full">
              <Lock
                className="w-6 h-6 text-[var(--text-muted)] mx-auto mb-3"
                aria-hidden="true"
              />
              <h2 className="text-base font-bold text-[var(--text-main)]">
                Full Ebook Locked
              </h2>
              <p className="mt-1.5 text-sm text-[var(--text-muted)]">
                Purchase this book or sign in with the account that owns it to
                unlock full PDF and Markdown editions.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                {!user && (
                  <button
                    type="button"
                    onClick={() => void signInWithGoogle()}
                    className="min-h-[44px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm font-semibold text-[var(--text-main)] whitespace-nowrap"
                  >
                    Sign In
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMode('sample')}
                  className="min-h-[44px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-sm font-semibold text-[var(--text-main)] whitespace-nowrap"
                >
                  Read Free Sample
                </button>
                <a
                  href={`/books/${book.urlSlug}`}
                  className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold whitespace-nowrap"
                >
                  Return to Book Details
                </a>
              </div>
            </div>
          </div>
        </>
      ) : shouldShowUnlockError ? (
        <>
          <ReaderTopBar {...topBar} />
          <div className="flex flex-col items-center justify-center flex-1 text-center p-6">
            <AlertCircle
              className="w-6 h-6 text-[var(--status-danger)] mb-2.5"
              aria-hidden="true"
            />
            <h2 className="text-base font-bold text-[var(--text-main)]">
              Unable to Open Full Edition
            </h2>
            <p className="mt-1.5 text-xs sm:text-sm text-[var(--text-muted)] max-w-md">
              {unlockError}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  autoUnlockAttemptedKeyRef.current = '';
                  void unlockFullBook(true);
                }}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold whitespace-nowrap"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                <span>Retry</span>
              </button>
              <a
                href="/purchased"
                className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-sm font-semibold text-[var(--text-main)] whitespace-nowrap"
              >
                Back to Library
              </a>
            </div>
          </div>
        </>
      ) : shouldWaitForSignedStream ? (
        <>
          <ReaderTopBar {...topBar} />
          <div className="flex flex-col items-center justify-center flex-1 text-center p-6">
            <Loader2
              className="w-6 h-6 animate-spin text-[var(--text-muted)] mb-2.5"
              aria-hidden="true"
            />
            <p className="text-sm font-semibold text-[var(--text-main)]">
              Opening full edition stream...
            </p>
          </div>
        </>
      ) : effectiveFormat === 'pdf' ? (
        <PdfViewer
          book={book}
          streamUrl={activePdfUrl}
          fullStoragePath={
            isSampleView ? undefined : signedUrls?.pdfStoragePath
          }
          directStreamUrl={isSampleView ? undefined : signedUrls?.directPdfUrl}
          isSample={isSampleView}
          userId={user?.uid}
          preferOffline={effectiveOfflineMode}
          bearerTokenProvider={getIdToken}
          onRefreshSignedUrl={async () => {
            const refreshed = await unlockFullBook(true, {
              silentStateUpdate: true,
            });
            return refreshed?.pdfUrl ? apiUrl(refreshed.pdfUrl) : null;
          }}
          onSwitchToFullMode={() => setMode('full')}
          topBar={topBar}
        />
      ) : (
        <MarkdownViewer
          book={book}
          streamUrl={activeMdUrl}
          fullStoragePath={
            isSampleView ? undefined : signedUrls?.markdownStoragePath
          }
          directStreamUrl={
            isSampleView ? undefined : signedUrls?.directMarkdownUrl
          }
          initialMarkdownText={isSampleView ? sampleMarkdownPreview : undefined}
          isSample={isSampleView}
          userId={user?.uid}
          preferOffline={effectiveOfflineMode}
          bearerTokenProvider={getIdToken}
          onRefreshSignedUrl={async () => {
            const refreshed = await unlockFullBook(true, {
              silentStateUpdate: true,
            });
            return refreshed?.markdownUrl
              ? apiUrl(refreshed.markdownUrl)
              : null;
          }}
          onSwitchToFullMode={() => setMode('full')}
          topBar={topBar}
        />
      )}
    </div>
  );
}
