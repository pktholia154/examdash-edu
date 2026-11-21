'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { BookOpen, FileText, Loader2, X } from 'lucide-react';
import { apiUrl } from '../../lib/platform/api-base';
import type { PublicBookDTO } from '../../lib/types/catalog';
import { cn } from '../../lib/utils';

const PdfViewer = dynamic(
  () => import('../reader/pdf/pdf-viewer').then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-[72svh] text-sm text-[var(--text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin me-2" aria-hidden="true" />
        <span>Loading PDF Sample...</span>
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
        <span>Loading Sample Reader...</span>
      </div>
    ),
  }
);

export interface BookSampleModalItem {
  id: string;
  title: string;
  urlSlug: string;
  currency: string;
  buyPrice: number;
  listPrice: number;
  samplePdfUrl?: string;
  sampleMarkdownUrl?: string;
}

export interface BookInlineReaderModalProps {
  book: BookSampleModalItem;
  initialFormat: 'pdf' | 'markdown';
  onClose: () => void;
}

/**
 * Focused In-Page Book Sample Preview Modal on `/books/[urlSlug]`.
 * Accepts primitive book fields so `DetailBuyCard` never serializes `fullDescription`.
 */
export function BookInlineReaderModal({
  book,
  initialFormat,
  onClose,
}: BookInlineReaderModalProps) {
  const [format, setFormat] = useState<'pdf' | 'markdown'>(initialFormat);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

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

  const viewerBookDto = useMemo<PublicBookDTO>(
    () => ({
      id: book.id,
      collectionName: 'books',
      title: book.title,
      urlSlug: book.urlSlug,
      seoDescription: '',
      fullDescription: '',
      type: 'Ebook',
      language: 'English',
      publisher: 'ExamDash',
      authorName: 'ExamDash',
      tags: [],
      currency: book.currency,
      listPrice: book.listPrice,
      buyPrice: book.buyPrice,
      publishAtIso: '',
      updatedAtIso: '',
      createdAtIso: '',
      samplePdfUrl: book.samplePdfUrl || '',
      sampleMarkdownUrl: book.sampleMarkdownUrl || '',
      hasFullPdf: true,
      hasFullMarkdown: true,
    }),
    [book]
  );

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

  const hasBothSamples = Boolean(book.samplePdfUrl && book.sampleMarkdownUrl);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${book.title} sample preview`}
      data-nosnippet=""
      className="fixed inset-0 z-50 h-[100dvh] w-screen bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl h-[94dvh] sm:h-[90dvh] rounded-t-2xl sm:rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] flex flex-col overflow-hidden shadow-xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-[var(--text-muted)]">
              Sample Preview
            </p>
            <h2 className="text-sm sm:text-base font-extrabold text-[var(--text-main)] truncate">
              {book.title}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasBothSamples && (
              <div
                role="group"
                aria-label="Sample format"
                className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5"
              >
                <button
                  type="button"
                  aria-pressed={format === 'pdf'}
                  onClick={() => setFormat('pdf')}
                  className={cn(
                    'inline-flex items-center gap-1.5 min-h-[48px] px-3.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap',
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
                    'inline-flex items-center gap-1.5 min-h-[48px] px-3.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap',
                    format === 'markdown'
                      ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  )}
                >
                  <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Markdown</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close sample preview"
              className="inline-flex items-center justify-center min-h-[48px] min-w-[48px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 p-2 sm:p-3 bg-[var(--bg-canvas)]">
          {format === 'pdf' ? (
            <PdfViewer
              book={viewerBookDto}
              streamUrl={samplePdfStreamUrl}
              isSample={true}
              embeddedHeightClass="h-full"
            />
          ) : (
            <MarkdownViewer
              book={viewerBookDto}
              streamUrl={sampleMdStreamUrl}
              isSample={true}
              embeddedHeightClass="h-full"
            />
          )}
        </div>
      </div>
    </div>
  );
}
