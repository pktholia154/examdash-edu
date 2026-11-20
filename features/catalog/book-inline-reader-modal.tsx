'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { BookOpen, ExternalLink, FileText, Loader2, X } from 'lucide-react';
import type { PublicBookDTO } from '../../lib/types/catalog';
import { makeCompositeKey } from '../../lib/registry/content-type-registry';
import { createUuidV7 } from '../../lib/platform/capacitor-bridge';
import { useAuth } from '../auth/auth-provider';
import { useToast } from '../toast/toast-context';
import { cn } from '../../lib/utils';

const PdfViewer = dynamic(
  () => import('../reader/pdf/pdf-viewer').then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-[72svh] text-sm text-[var(--text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin me-2" aria-hidden="true" />
        <span>Loading PDF Engine...</span>
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
      <div className="flex items-center justify-center h-[72svh] text-sm text-[var(--text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin me-2" aria-hidden="true" />
        <span>Loading Study Reader...</span>
      </div>
    ),
  }
);

export interface BookInlineReaderModalProps {
  book: PublicBookDTO;
  initialFormat: 'pdf' | 'markdown';
  initialMode: 'sample' | 'full';
  onClose: () => void;
}

/**
 * In-page Book Preview & Full Reader Sheet/Modal on `/books/[urlSlug]`.
 * Lets learners inspect PDF & Markdown samples or read purchased editions without leaving the detail page.
 */
export function BookInlineReaderModal({
  book,
  initialFormat,
  initialMode,
  onClose,
}: BookInlineReaderModalProps) {
  const { user, ownedCompositeKeys, getIdToken } = useAuth();
  const { showToast } = useToast();

  const isOwned =
    book.buyPrice === 0 ||
    ownedCompositeKeys.has(makeCompositeKey('books', book.id));

  const [format, setFormat] = useState<'pdf' | 'markdown'>(initialFormat);
  const [mode, setMode] = useState<'sample' | 'full'>(
    initialMode === 'full' && isOwned ? 'full' : 'sample'
  );
  const [signedAssets, setSignedAssets] = useState<{
    pdfUrl?: string;
    markdownUrl?: string;
    expiresAtIso?: string;
  } | null>(null);
  const [mintingSignedUrl, setMintingSignedUrl] = useState(false);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Lock body scroll & wire Predictive Back / Escape without Strict Mode history.back() races
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onPopState = () => {
      onCloseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const mintSignedUrls = useCallback(async (): Promise<{
    pdfUrl?: string;
    markdownUrl?: string;
  } | null> => {
    if (!user) return null;
    setMintingSignedUrl(true);
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
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        showToast(err.error || 'Could not unlock full book stream.', 'danger');
        return null;
      }
      const data = (await res.json()) as {
        expiresAtIso: string;
        assets: { pdfUrl?: string; markdownUrl?: string };
      };
      const next = {
        pdfUrl: data.assets.pdfUrl,
        markdownUrl: data.assets.markdownUrl,
        expiresAtIso: data.expiresAtIso,
      };
      setSignedAssets(next);
      return next;
    } catch {
      showToast('Network error while minting signed reader URL.', 'danger');
      return null;
    } finally {
      setMintingSignedUrl(false);
    }
  }, [book.urlSlug, getIdToken, showToast, user]);

  useEffect(() => {
    if (mode !== 'full' || !isOwned || !user || signedAssets) return;
    let cancelled = false;

    const autoMint = async () => {
      try {
        const token = await getIdToken();
        if (!token || cancelled) return;
        setMintingSignedUrl(true);
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
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          expiresAtIso: string;
          assets: { pdfUrl?: string; markdownUrl?: string };
        };
        if (!cancelled) {
          setSignedAssets({
            pdfUrl: data.assets.pdfUrl,
            markdownUrl: data.assets.markdownUrl,
            expiresAtIso: data.expiresAtIso,
          });
        }
      } catch {
        // Retry button remains available
      } finally {
        if (!cancelled) setMintingSignedUrl(false);
      }
    };

    void autoMint();
    return () => {
      cancelled = true;
    };
  }, [book.urlSlug, getIdToken, isOwned, mode, signedAssets, user]);

  const samplePdfStreamUrl = `/api/v1/library/stream?collection=books&slug=${encodeURIComponent(
    book.urlSlug
  )}&mode=sample&format=pdf`;
  const sampleMdStreamUrl = `/api/v1/library/stream?collection=books&slug=${encodeURIComponent(
    book.urlSlug
  )}&mode=sample&format=markdown`;

  const handleRefreshPdfUrl = useCallback(async () => {
    const next = await mintSignedUrls();
    return next?.pdfUrl ?? null;
  }, [mintSignedUrls]);

  const handleRefreshMarkdownUrl = useCallback(async () => {
    const next = await mintSignedUrls();
    return next?.markdownUrl ?? null;
  }, [mintSignedUrls]);

  const isSampleActive = mode === 'sample' || !isOwned;
  const activePdfUrl = isSampleActive
    ? samplePdfStreamUrl
    : signedAssets?.pdfUrl || '';
  const activeMdUrl = isSampleActive
    ? sampleMdStreamUrl
    : signedAssets?.markdownUrl || '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${book.title} inline reader`}
      data-nosnippet=""
      className="fixed inset-0 z-50 h-[100dvh] w-screen bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl h-[94dvh] sm:h-[90dvh] rounded-t-2xl sm:rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] flex flex-col overflow-hidden shadow-xl"
      >
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-[var(--text-muted)]">
              {isSampleActive ? 'Instant Sample Preview' : 'Full Library Edition'} ·{' '}
              {book.language}
            </p>
            <h2 className="text-sm sm:text-base font-extrabold text-[var(--text-main)] truncate">
              {book.title}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Sample vs Full Edition Switcher (when owned) */}
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
                    'min-h-[38px] px-2.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap',
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
                    'min-h-[38px] px-2.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap',
                    mode === 'full'
                      ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  )}
                >
                  Full Book
                </button>
              </div>
            )}

            {/* PDF <-> Markdown Switcher */}
            <div
              role="group"
              aria-label="Reader format"
              className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5"
            >
              {(book.samplePdfUrl || (isOwned && book.hasFullPdf)) && (
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
              )}
              {(book.sampleMarkdownUrl || (isOwned && book.hasFullMarkdown)) && (
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
              )}
            </div>

            {/* Dedicated Reader Route Link */}
            <a
              href={`/read/${book.urlSlug}?mode=${
                isSampleActive ? 'sample' : 'full'
              }&format=${format}`}
              className="hidden md:inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
            >
              <span>Dedicated Tab</span>
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>

            {/* Close Modal Button (returns to exact scroll position on Book Details page) */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close reader preview"
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Viewer Body */}
        <div className="flex-1 min-h-0 p-2 sm:p-3 bg-[var(--bg-canvas)]">
          {!isSampleActive && mintingSignedUrl && !signedAssets ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Loader2
                className="w-6 h-6 animate-spin text-[var(--text-muted)] mb-2.5"
                aria-hidden="true"
              />
              <p className="text-sm font-semibold text-[var(--text-main)]">
                Verifying purchase & minting 15-minute signed stream...
              </p>
            </div>
          ) : format === 'pdf' ? (
            <PdfViewer
              book={book}
              streamUrl={activePdfUrl}
              isSample={isSampleActive}
              bearerTokenProvider={getIdToken}
              onRefreshSignedUrl={handleRefreshPdfUrl}
              onSwitchToFullMode={() => setMode('full')}
              embeddedHeightClass="h-full"
            />
          ) : (
            <MarkdownViewer
              book={book}
              streamUrl={activeMdUrl}
              isSample={isSampleActive}
              bearerTokenProvider={getIdToken}
              onRefreshSignedUrl={handleRefreshMarkdownUrl}
              onSwitchToFullMode={() => setMode('full')}
              embeddedHeightClass="h-full"
            />
          )}
        </div>
      </div>
    </div>
  );
}
