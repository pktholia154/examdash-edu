'use client';

import React, {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  BookOpen,
  FileText,
  KeyRound,
  Loader2,
  Lock,
  WifiOff,
} from 'lucide-react';
import type { PublicBookDTO } from '../../lib/types/catalog';
import { makeCompositeKey } from '../../lib/registry/content-type-registry';
import {
  getCachedSignedGrant,
  hasBookFormatOffline,
  OFFLINE_VAULT_UPDATED_EVENT,
  requestSignedAssetUnlock,
} from '../../lib/offline/offline-vault';
import { apiUrl } from '../../lib/platform/api-base';
import { MonogramThumbnail } from '../../components/ui/monogram-thumbnail';
import { useAuth } from '../auth/auth-provider';
import { useToast } from '../toast/toast-context';
import { cn } from '../../lib/utils';

const PdfViewer = dynamic(
  () => import('../reader/pdf/pdf-viewer').then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-[74svh] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm text-[var(--text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin me-2" aria-hidden="true" />
        <span>Initializing PDFium WASM Viewer...</span>
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
      <div className="flex items-center justify-center h-[74svh] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm text-[var(--text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin me-2" aria-hidden="true" />
        <span>Initializing Study Reader...</span>
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
    ownedCompositeKeys,
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
    ownedCompositeKeys.has(makeCompositeKey('books', book.id));

  const [format, setFormat] = useState<'markdown' | 'pdf'>(initialFormat);
  const [mode, setMode] = useState<'sample' | 'full'>(initialMode);
  const [preferOffline, setPreferOffline] = useState<boolean>(
    initialSource === 'offline'
  );
  const [hasOfflineCopy, setHasOfflineCopy] = useState<boolean>(false);
  const [vaultChecked, setVaultChecked] = useState<boolean>(false);

  const [signedUrls, setSignedUrls] = useState<{
    pdfUrl?: string;
    markdownUrl?: string;
    expiresAtIso?: string;
  } | null>(() => {
    if (!user?.uid) return null;
    const cached = getCachedSignedGrant(user.uid, 'books', book.urlSlug);
    if (!cached) return null;
    return {
      pdfUrl: cached.assets.pdfUrl,
      markdownUrl: cached.assets.markdownUrl,
      expiresAtIso: cached.expiresAtIso,
    };
  });
  const [unlocking, setUnlocking] = useState(false);

  const userId = user?.uid;
  const isSampleView = mode === 'sample' || !isOwned;
  const effectiveOfflineMode = !isSampleView && (!isOnline || preferOffline);

  // Sync whether the active format is saved in the UID-scoped offline vault
  useEffect(() => {
    let active = true;
    const syncVault = async () => {
      if (!userId || isSampleView) {
        if (active) {
          setHasOfflineCopy(false);
          setVaultChecked(true);
        }
        return;
      }
      const saved = await hasBookFormatOffline(userId, book.id, format);
      if (active) {
        setHasOfflineCopy(saved);
        setVaultChecked(true);
        if (!isOnline && saved) {
          setPreferOffline(true);
        }
      }
    };

    void syncVault();
    window.addEventListener(OFFLINE_VAULT_UPDATED_EVENT, syncVault);
    return () => {
      active = false;
      window.removeEventListener(OFFLINE_VAULT_UPDATED_EVENT, syncVault);
    };
  }, [book.id, format, isOnline, isSampleView, userId]);

  const unlockFullBook = useCallback(
    async (forceRefresh: boolean = false): Promise<{
      pdfUrl?: string;
      markdownUrl?: string;
    } | null> => {
      if (!userId || !isOnline) return null;
      setUnlocking(true);
      try {
        const grant = await requestSignedAssetUnlock({
          uid: userId,
          collectionName: 'books',
          urlSlug: book.urlSlug,
          getIdToken,
          forceRefresh,
        });
        const next = {
          pdfUrl: grant.assets.pdfUrl,
          markdownUrl: grant.assets.markdownUrl,
          expiresAtIso: grant.expiresAtIso,
        };
        setSignedUrls(next);
        return next;
      } catch {
        if (!hasOfflineCopy) {
          showToast('Unable to verify signed reader session.', 'danger');
        }
        return null;
      } finally {
        setUnlocking(false);
      }
    },
    [book.urlSlug, getIdToken, hasOfflineCopy, isOnline, showToast, userId]
  );

  useEffect(() => {
    if (
      !isOwned ||
      !userId ||
      signedUrls ||
      mode !== 'full' ||
      !isOnline ||
      effectiveOfflineMode
    ) {
      return;
    }

    let cancelled = false;
    const autoUnlock = async () => {
      const cached = getCachedSignedGrant(userId, 'books', book.urlSlug);
      if (cached && !cancelled) {
        setSignedUrls({
          pdfUrl: cached.assets.pdfUrl,
          markdownUrl: cached.assets.markdownUrl,
          expiresAtIso: cached.expiresAtIso,
        });
        return;
      }
      await unlockFullBook(false);
    };

    void autoUnlock();
    return () => {
      cancelled = true;
    };
  }, [
    book.urlSlug,
    effectiveOfflineMode,
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
  const shouldWaitForSignedStream =
    !isSampleView &&
    !effectiveOfflineMode &&
    !hasOfflineCopy &&
    isOnline &&
    (!signedUrls || unlocking) &&
    !signedUrls;

  return (
    <div className="ed-container py-5 sm:py-6 space-y-4">
      {/* Reader Workspace Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3 min-w-0">
          <a
            href={backHref}
            className="inline-flex items-center justify-center w-12 h-12 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
            aria-label={isOwned ? 'Back to Purchased Library' : 'Back to book details'}
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </a>
          <MonogramThumbnail
            title={book.title}
            type={book.type}
            collectionName="books"
            size="xs"
            showBadge={false}
            className="hidden sm:flex"
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--text-muted)] flex flex-wrap items-center gap-1.5">
              <span>
                {isSampleView
                  ? 'Sample Preview'
                  : effectiveOfflineMode && hasOfflineCopy
                  ? 'Offline Vault Edition'
                  : 'Full Library Edition'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{book.language}</span>
              {!isOnline && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-[var(--status-warning)]">
                    <WifiOff className="w-3 h-3" aria-hidden="true" />
                    <span>Offline Mode</span>
                  </span>
                </>
              )}
              {!isSampleView &&
                !effectiveOfflineMode &&
                signedUrls?.expiresAtIso && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      disabled={unlocking}
                      onClick={() => void unlockFullBook(true)}
                      className="inline-flex items-center gap-1 font-semibold text-[var(--text-main)] hover:underline"
                    >
                      <KeyRound className="w-3 h-3" aria-hidden="true" />
                      <span>
                        Signed until{' '}
                        {new Date(signedUrls.expiresAtIso).toLocaleTimeString()}
                      </span>
                    </button>
                  </>
                )}
            </p>
            <h1 className="text-base sm:text-lg font-extrabold text-[var(--text-main)] truncate">
              {book.title}
            </h1>
          </div>
        </div>

        {/* Mode & Format Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!isSampleView && hasOfflineCopy && (
            <div
              role="group"
              aria-label="Delivery source"
              className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5"
            >
              <button
                type="button"
                disabled={!isOnline}
                aria-pressed={!effectiveOfflineMode}
                onClick={() => setPreferOffline(false)}
                className={cn(
                  'min-h-[40px] px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-40',
                  !effectiveOfflineMode
                    ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                )}
              >
                Read Online
              </button>
              <button
                type="button"
                aria-pressed={effectiveOfflineMode}
                onClick={() => setPreferOffline(true)}
                className={cn(
                  'min-h-[40px] px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap',
                  effectiveOfflineMode
                    ? 'bg-[var(--bg-surface)] text-[var(--status-success)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                )}
              >
                ● Read Offline
              </button>
            </div>
          )}

          <div
            role="group"
            aria-label="Reader format"
            className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5"
          >
            {(book.hasFullPdf || Boolean(book.samplePdfUrl)) && (
              <button
                type="button"
                aria-pressed={format === 'pdf'}
                onClick={() => setFormat('pdf')}
                className={cn(
                  'inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap',
                  format === 'pdf'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                )}
              >
                <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                <span>PDF</span>
              </button>
            )}
            {(book.hasFullMarkdown || Boolean(book.sampleMarkdownUrl)) && (
              <button
                type="button"
                aria-pressed={format === 'markdown'}
                onClick={() => setFormat('markdown')}
                className={cn(
                  'inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap',
                  format === 'markdown'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                )}
              >
                <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Markdown</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Entitlement Gate or Active Production Viewer */}
      {(!isAuthReady || !vaultChecked) && mode === 'full' ? (
        <div className="flex items-center justify-center h-[60svh] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <Loader2
            className="w-6 h-6 animate-spin text-[var(--text-muted)] me-2"
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-[var(--text-muted)]">
            Checking library entitlement...
          </span>
        </div>
      ) : !isOwned && mode === 'full' ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center max-w-xl mx-auto">
          <Lock
            className="w-6 h-6 text-[var(--text-muted)] mx-auto mb-3"
            aria-hidden="true"
          />
          <h2 className="text-base font-bold text-[var(--text-main)]">
            Full Ebook Locked
          </h2>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            Purchase this book or sign in with the account that owns it to unlock full PDF and Markdown editions.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            {!user && (
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                className="min-h-[48px] px-5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm font-semibold text-[var(--text-main)]"
              >
                Sign In
              </button>
            )}
            <button
              type="button"
              onClick={() => setMode('sample')}
              className="min-h-[48px] px-5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-sm font-semibold text-[var(--text-main)]"
            >
              Read Free Sample
            </button>
            <a
              href={`/books/${book.urlSlug}`}
              className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold"
            >
              Return to Book Details
            </a>
          </div>
        </div>
      ) : shouldWaitForSignedStream ? (
        <div className="flex flex-col items-center justify-center h-[60svh] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-center p-6">
          <Loader2
            className="w-6 h-6 animate-spin text-[var(--text-muted)] mb-2.5"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-[var(--text-main)]">
            Minting 15-minute signed reader stream...
          </p>
        </div>
      ) : format === 'pdf' ? (
        <PdfViewer
          book={book}
          streamUrl={activePdfUrl}
          isSample={isSampleView}
          userId={user?.uid}
          preferOffline={effectiveOfflineMode}
          bearerTokenProvider={getIdToken}
          onRefreshSignedUrl={async () => {
            const refreshed = await unlockFullBook(true);
            return refreshed?.pdfUrl ?? null;
          }}
          onSwitchToFullMode={() => setMode('full')}
          embeddedHeightClass="h-[78svh] min-h-[540px]"
        />
      ) : (
        <MarkdownViewer
          book={book}
          streamUrl={activeMdUrl}
          initialMarkdownText={isSampleView ? sampleMarkdownPreview : undefined}
          isSample={isSampleView}
          userId={user?.uid}
          preferOffline={effectiveOfflineMode}
          bearerTokenProvider={getIdToken}
          onRefreshSignedUrl={async () => {
            const refreshed = await unlockFullBook(true);
            return refreshed?.markdownUrl ?? null;
          }}
          onSwitchToFullMode={() => setMode('full')}
          embeddedHeightClass="h-[78svh] min-h-[540px]"
        />
      )}
    </div>
  );
}
