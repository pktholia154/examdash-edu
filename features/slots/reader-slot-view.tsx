'use client';

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  BookOpen,
  FileText,
  KeyRound,
  Loader2,
  Lock,
} from 'lucide-react';
import type { PublicBookDTO } from '../../lib/types/catalog';
import { makeCompositeKey } from '../../lib/registry/content-type-registry';
import { createUuidV7 } from '../../lib/platform/capacitor-bridge';
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

export function ReaderSlotView({
  book,
  initialMode,
  initialFormat,
  sampleMarkdownPreview,
}: {
  book: PublicBookDTO;
  initialMode: 'sample' | 'full';
  initialFormat: 'markdown' | 'pdf';
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

  const isOwned =
    book.buyPrice === 0 ||
    ownedCompositeKeys.has(makeCompositeKey('books', book.id));

  const [format, setFormat] = useState<'markdown' | 'pdf'>(initialFormat);
  const [mode, setMode] = useState<'sample' | 'full'>(initialMode);
  const [signedUrls, setSignedUrls] = useState<{
    pdfUrl?: string;
    markdownUrl?: string;
    expiresAtIso?: string;
  } | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const isSampleView = mode === 'sample' || !isOwned;

  const unlockFullBook = useCallback(async (): Promise<{
    pdfUrl?: string;
    markdownUrl?: string;
  } | null> => {
    if (!user) return null;
    setUnlocking(true);
    try {
      const token = await getIdToken();
      if (!token) return null;
      const res = await fetch('/api/v1/library/unlock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': createUuidV7(),
        },
        body: JSON.stringify({
          collectionName: 'books',
          urlSlug: book.urlSlug,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          expiresAtIso: string;
          assets: { pdfUrl?: string; markdownUrl?: string };
        };
        const next = {
          pdfUrl: data.assets.pdfUrl,
          markdownUrl: data.assets.markdownUrl,
          expiresAtIso: data.expiresAtIso,
        };
        setSignedUrls(next);
        return next;
      }
      return null;
    } catch {
      showToast('Unable to verify signed reader session.', 'danger');
      return null;
    } finally {
      setUnlocking(false);
    }
  }, [book.urlSlug, getIdToken, showToast, user]);

  useEffect(() => {
    if (!isOwned || !user || signedUrls || mode !== 'full') return;
    let cancelled = false;

    const autoUnlock = async () => {
      setUnlocking(true);
      try {
        const token = await getIdToken();
        if (!token || cancelled) return;
        const res = await fetch('/api/v1/library/unlock', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'Idempotency-Key': createUuidV7(),
          },
          body: JSON.stringify({
            collectionName: 'books',
            urlSlug: book.urlSlug,
          }),
        });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as {
            expiresAtIso: string;
            assets: { pdfUrl?: string; markdownUrl?: string };
          };
          setSignedUrls({
            pdfUrl: data.assets.pdfUrl,
            markdownUrl: data.assets.markdownUrl,
            expiresAtIso: data.expiresAtIso,
          });
        }
      } catch {
        // Manual retry remains available in header
      } finally {
        if (!cancelled) setUnlocking(false);
      }
    };

    void autoUnlock();
    return () => {
      cancelled = true;
    };
  }, [book.urlSlug, getIdToken, isOwned, mode, signedUrls, user]);

  const samplePdfStreamUrl = `/api/v1/library/stream?collection=books&slug=${encodeURIComponent(
    book.urlSlug
  )}&mode=sample&format=pdf`;
  const sampleMdStreamUrl = `/api/v1/library/stream?collection=books&slug=${encodeURIComponent(
    book.urlSlug
  )}&mode=sample&format=markdown`;

  const activePdfUrl = isSampleView
    ? samplePdfStreamUrl
    : signedUrls?.pdfUrl || '';
  const activeMdUrl = isSampleView
    ? sampleMdStreamUrl
    : signedUrls?.markdownUrl || '';

  return (
    <div className="ed-container py-5 sm:py-6 space-y-4">
      {/* Reader Workspace Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3 min-w-0">
          <a
            href={`/books/${book.urlSlug}`}
            className="inline-flex items-center justify-center w-11 h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
            aria-label="Back to book details"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </a>
          <MonogramThumbnail
            title={book.title}
            type={book.type}
            collectionName="books"
            size="sm"
            showBadge={false}
            className="w-11 h-11 hidden sm:flex"
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--text-muted)]">
              {isSampleView ? 'Sample Preview' : 'Full Library Edition'} ·{' '}
              {book.language}
              {!isSampleView && signedUrls?.expiresAtIso && (
                <>
                  {' · '}
                  <button
                    type="button"
                    disabled={unlocking}
                    onClick={() => void unlockFullBook()}
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
          {isOwned && (
            <div
              role="group"
              aria-label="Edition mode"
              className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5"
            >
              <button
                type="button"
                aria-pressed={mode === 'sample'}
                onClick={() => setMode('sample')}
                className={cn(
                  'min-h-[38px] px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap',
                  mode === 'sample'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                )}
              >
                Sample
              </button>
              <button
                type="button"
                aria-pressed={mode === 'full'}
                onClick={() => setMode('full')}
                className={cn(
                  'min-h-[38px] px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap',
                  mode === 'full'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                )}
              >
                Full Edition
              </button>
            </div>
          )}

          <div
            role="group"
            aria-label="Reader format"
            className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5"
          >
            <button
              type="button"
              aria-pressed={format === 'pdf'}
              onClick={() => setFormat('pdf')}
              className={cn(
                'inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap',
                format === 'pdf'
                  ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              )}
            >
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              <span>PDF</span>
            </button>
            <button
              type="button"
              aria-pressed={format === 'markdown'}
              onClick={() => setFormat('markdown')}
              className={cn(
                'inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap',
                format === 'markdown'
                  ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              )}
            >
              <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Markdown</span>
            </button>
          </div>
        </div>
      </div>

      {/* Entitlement Gate or Active Production Viewer */}
      {!isAuthReady && mode === 'full' ? (
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
            Purchase this book or sign in with the account that owns it to unlock full PDF and Markdown streams. You can read the free sample chapter anytime.
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
      ) : !isSampleView && (!signedUrls || unlocking) && !signedUrls ? (
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
          bearerTokenProvider={getIdToken}
          onRefreshSignedUrl={async () => {
            const refreshed = await unlockFullBook();
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
          bearerTokenProvider={getIdToken}
          onRefreshSignedUrl={async () => {
            const refreshed = await unlockFullBook();
            return refreshed?.markdownUrl ?? null;
          }}
          onSwitchToFullMode={() => setMode('full')}
          embeddedHeightClass="h-[78svh] min-h-[540px]"
        />
      )}
    </div>
  );
}
