'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { apiUrl } from '../../lib/platform/api-base';
import type { PublicBookDTO } from '../../lib/types/catalog';
import {
  ReaderTopBar,
  type ReaderTopBarProps,
} from '../reader/shared/reader-top-bar';

const PdfViewer = dynamic(
  () => import('../reader/pdf/pdf-viewer').then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center flex-1 h-full text-sm text-[var(--text-muted)]">
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
      <div className="flex items-center justify-center flex-1 h-full text-sm text-[var(--text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin me-2" aria-hidden="true" />
        <span>Loading Markdown...</span>
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
 * Full-Screen Edge-to-Edge Sample Reader on `/books/[urlSlug]`.
 * Always opens in full screen with zero outer boxes and minimal 2-bar controls.
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

  const topBar: ReaderTopBarProps = {
    title: book.title,
    activeFormat: format,
    canSwitchFormat: hasBothSamples,
    onFormatChange: setFormat,
    onClose,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={book.title}
      data-nosnippet=""
      className="fixed inset-0 z-50 h-[100dvh] w-screen flex flex-col overflow-hidden bg-[var(--bg-canvas)]"
    >
      {format === 'pdf' ? (
        <PdfViewer
          book={viewerBookDto}
          streamUrl={samplePdfStreamUrl}
          isSample={true}
          topBar={topBar}
        />
      ) : format === 'markdown' ? (
        <MarkdownViewer
          book={viewerBookDto}
          streamUrl={sampleMdStreamUrl}
          isSample={true}
          topBar={topBar}
        />
      ) : (
        <ReaderTopBar {...topBar} />
      )}
    </div>
  );
}
