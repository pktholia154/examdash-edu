'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { ArrowLeft, BookOpen, ExternalLink, FileText, KeyRound, Lock } from 'lucide-react';
import type { PublicBookDTO } from '../../lib/types/catalog';
import { makeCompositeKey } from '../../lib/registry/content-type-registry';
import { createUuidV7 } from '../../lib/platform/capacitor-bridge';
import { MonogramThumbnail } from '../../components/ui/monogram-thumbnail';
import { useAuth } from '../auth/auth-provider';
import { useToast } from '../toast/toast-context';
import { cn } from '../../lib/utils';

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
  const { user, ownedCompositeKeys, getIdToken, signInWithGoogle } = useAuth();
  const { showToast } = useToast();

  const isOwned =
    book.buyPrice === 0 ||
    ownedCompositeKeys.has(makeCompositeKey('books', book.id));

  const [format, setFormat] = useState<'markdown' | 'pdf'>(initialFormat);
  const [signedUrls, setSignedUrls] = useState<{
    pdfUrl?: string;
    markdownUrl?: string;
    expiresAtIso?: string;
  } | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const isSampleView = initialMode === 'sample' || !isOwned;

  const unlockFullBook = useCallback(async () => {
    if (!user) return;
    setUnlocking(true);
    try {
      const token = await getIdToken();
      if (!token) return;
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
        setSignedUrls({
          pdfUrl: data.assets.pdfUrl,
          markdownUrl: data.assets.markdownUrl,
          expiresAtIso: data.expiresAtIso,
        });
      }
    } catch {
      showToast('Unable to verify signed reader session.', 'danger');
    } finally {
      setUnlocking(false);
    }
  }, [book.urlSlug, getIdToken, showToast, user]);

  useEffect(() => {
    if (!isOwned || !user || signedUrls || initialMode !== 'full') return;
    let cancelled = false;

    const autoUnlock = async () => {
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
        // Silent background pre-unlock fallback; manual button remains available
      }
    };

    void autoUnlock();
    return () => {
      cancelled = true;
    };
  }, [book.urlSlug, getIdToken, initialMode, isOwned, signedUrls, user]);

  const activePdfUrl = isSampleView ? book.samplePdfUrl : signedUrls?.pdfUrl || book.samplePdfUrl;

  return (
    <div className="ed-container py-8 space-y-6">
      {/* Reader Workspace Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3.5 min-w-0">
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
            className="w-12 h-12 hidden sm:flex"
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--text-muted)]">
              {isSampleView ? 'Sample Preview Slot' : 'Owned Library Reader Slot'} ·{' '}
              {book.language}
            </p>
            <h1 className="text-lg sm:text-xl font-extrabold text-[var(--text-main)] truncate">
              {book.title}
            </h1>
          </div>
        </div>

        {/* Format Selector */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Reader format"
            className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1"
          >
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
          </div>
        </div>
      </div>

      {/* Entitlement / Phase-2 Reader Slot Viewport */}
      {!isOwned && initialMode === 'full' ? (
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
            <a
              href={`/books/${book.urlSlug}`}
              className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold"
            >
              Return to Book Details
            </a>
          </div>
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
            <span>
              Phase-2 Pluggable Reader Container · Ready for drop-in pagination, highlights & annotations
            </span>
            {isOwned && user && (
              <button
                type="button"
                disabled={unlocking}
                onClick={() => void unlockFullBook()}
                className="inline-flex items-center gap-1.5 font-semibold text-[var(--text-main)] hover:underline"
              >
                <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {signedUrls?.expiresAtIso
                    ? `Signed token active until ${new Date(
                        signedUrls.expiresAtIso
                      ).toLocaleTimeString()}`
                    : unlocking
                    ? 'Minting signed URL...'
                    : 'Refresh 15m Signed URL'}
                </span>
              </button>
            )}
          </div>

          {format === 'markdown' ? (
            <article className="max-w-3xl mx-auto prose dark:prose-invert text-sm sm:text-base leading-relaxed text-[var(--text-main)] space-y-4">
              {sampleMarkdownPreview ? (
                <div className="markdown-body space-y-3">
                  <Markdown>{sampleMarkdownPreview}</Markdown>
                </div>
              ) : (
                <div className="space-y-3">
                  <h2 className="text-lg font-bold">{book.title} — Overview</h2>
                  <p className="text-[var(--text-muted)] whitespace-pre-line">
                    {book.fullDescription || book.seoDescription}
                  </p>
                </div>
              )}
            </article>
          ) : (
            <div className="space-y-4">
              {activePdfUrl ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-8 text-center">
                  <FileText
                    className="w-8 h-8 text-[var(--text-main)] mb-3"
                    aria-hidden="true"
                  />
                  <h2 className="text-base font-bold text-[var(--text-main)]">
                    PDF Stream Ready ({isSampleView ? 'Sample Extract' : 'Full Edition'})
                  </h2>
                  <p className="mt-1 text-sm text-[var(--text-muted)] max-w-md">
                    Dedicated canvas PDF renderer mounts in this Phase-2 slot. You can also open the verified PDF stream directly.
                  </p>
                  <a
                    href={activePdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 inline-flex items-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    <span>Open PDF Document</span>
                    <ExternalLink className="w-4 h-4" aria-hidden="true" />
                  </a>
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)] text-center py-8">
                  No PDF stream attached to this preview mode. Switch to Markdown above.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
