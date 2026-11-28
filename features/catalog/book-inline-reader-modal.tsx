'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import { Check, ShoppingCart, Sparkles, Zap } from 'lucide-react';
import {
  createSampleTelemetrySession,
  type SampleCloseReason,
  type SampleTriggerSource,
  type SampleViewerFormat,
} from '../../lib/analytics/sample-telemetry';
import { buildBookSampleStreamUrl } from '../../lib/reader/sample-stream-loader';
import { computeDragDismissDecision } from '../../lib/reader/sample-overlay-events';
import {
  formatPrice,
  makeCompositeKey,
} from '../../lib/registry/content-type-registry';
import type { PublicBookDTO } from '../../lib/types/catalog';
import { cn } from '../../lib/utils';
import { resolveValiditySelection } from '../../lib/validity/pricing';
import { useAuth } from '../auth/auth-provider';
import { useCart } from '../cart/cart-provider';
import {
  ReaderTopBar,
  type ReaderTopBarProps,
} from '../reader/shared/reader-top-bar';
import { SampleDocumentBodySkeleton } from '../reader/shared/sample-viewer-skeleton';

const PdfViewer = dynamic(
  () => import('../reader/pdf/pdf-viewer').then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <SampleDocumentBodySkeleton
        format="pdf"
        progressLabel="Initializing reader..."
      />
    ),
  }
);

const MarkdownViewer = dynamic(
  () =>
    import('../reader/markdown/markdown-viewer').then((m) => m.MarkdownViewer),
  {
    ssr: false,
    loading: () => <SampleDocumentBodySkeleton format="markdown" />,
  }
);

export interface BookSampleModalItem {
  id: string;
  title: string;
  urlSlug: string;
  type?: string;
  authorName?: string;
  language?: string;
  currency: string;
  buyPrice: number;
  listPrice: number;
  imageUrl?: string;
  imageAlt?: string;
  samplePdfUrl?: string;
  sampleMarkdownUrl?: string;
}

export interface BookInlineReaderModalProps {
  book: BookSampleModalItem;
  initialFormat: SampleViewerFormat;
  selectedValidityMonths: number;
  triggerSource: SampleTriggerSource;
  onClose: (reason: SampleCloseReason) => void;
}

/**
 * Same-DOM Responsive Sample Overlay on `/books/[urlSlug]`:
 * - Mobile (< 768px): 94dvh Bottom Sheet with drag-to-close strictly on the top handle bar.
 * - Desktop (>= 768px): Centered Modal (92dvh height, 1120px max-width) with expand toggle.
 * - Contained overscroll + zero-CLS scrollbar lock + sticky "Buy eBook" CTA bar.
 * - 100% same-URL rendering with active-reading 30s GA4 heartbeats and zero virtual pageviews.
 */
export function BookInlineReaderModal({
  book,
  initialFormat,
  selectedValidityMonths,
  triggerSource,
  onClose,
}: BookInlineReaderModalProps) {
  const { ownedCompositeKeys } = useAuth();
  const { buyNow, addItem, getCartItem, openCart, isCheckingOut } = useCart();

  const [format, setFormat] = useState<SampleViewerFormat>(initialFormat);
  const [isMaximized, setIsMaximized] = useState(false);
  const [readingProgress, setReadingProgress] = useState<{
    current: number;
    total: number;
    ratio: number;
  } | null>(null);

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    lastTimeMs: number;
    velocityPxPerMs: number;
    active: boolean;
  } | null>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const telemetryRef = useRef<ReturnType<
    typeof createSampleTelemetrySession
  > | null>(null);
  const closedOnceRef = useRef(false);

  const finalizeClose = useCallback((reason: SampleCloseReason) => {
    if (closedOnceRef.current) return;
    closedOnceRef.current = true;
    telemetryRef.current?.close(reason);
    onCloseRef.current(reason);
  }, []);

  // Initialize Same-DOM Sample Analytics Session & 30s Active-Reading Heartbeat Clock
  useEffect(() => {
    closedOnceRef.current = false;
    const pagePath =
      typeof window !== 'undefined'
        ? window.location.pathname
        : `/books/${book.urlSlug}`;

    const session = createSampleTelemetrySession({
      context: {
        bookId: book.id,
        bookSlug: book.urlSlug,
        bookTitle: book.title,
        pagePath,
      },
      initialFormat,
      triggerSource,
    });
    telemetryRef.current = session;
    session.startOpen();

    const heartbeatTimer = window.setInterval(() => {
      session.tick();
    }, 5_000);

    const onVisibilityChange = () => {
      session.tick();
    };
    const onPageHide = () => {
      session.close('pagehide');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.clearInterval(heartbeatTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      if (!closedOnceRef.current) {
        // Parent unmounted modal (e.g. mobile Back button popstate)
        session.close('back_button');
      }
    };
  }, [book.id, book.title, book.urlSlug, initialFormat, triggerSource]);

  // Zero-CLS Scroll Lock + Escape Key Handler
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevPaddingInlineEnd = document.body.style.paddingInlineEnd;
    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - document.documentElement.clientWidth
    );

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingInlineEnd = `${scrollbarWidth}px`;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      telemetryRef.current?.recordInteraction();
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        finalizeClose('escape');
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingInlineEnd = prevPaddingInlineEnd;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [finalizeClose]);

  const handleFormatChange = useCallback((nextFormat: SampleViewerFormat) => {
    setFormat(nextFormat);
    setReadingProgress(null);
    telemetryRef.current?.switchFormat(nextFormat);
  }, []);

  const handleUserActivity = useCallback(() => {
    telemetryRef.current?.recordInteraction();
  }, []);

  const handleReadingProgressChange = useCallback(
    (next: { current: number; total: number; ratio: number }) => {
      setReadingProgress((prev) => {
        const prevPct = prev ? Math.round(prev.ratio * 100) : -1;
        const nextPct = Math.round(next.ratio * 100);
        if (
          prev &&
          prev.current === next.current &&
          prev.total === next.total &&
          prevPct === nextPct
        ) {
          return prev;
        }
        return next;
      });
      telemetryRef.current?.updateProgress({
        format,
        current: next.current,
        total: next.total,
        ratio: next.ratio,
      });
    },
    [format]
  );

  // Mobile Top-Handle-Only Drag-to-Close (NEVER attached to scrollable document body)
  const handleDragHandlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const now = performance.now();
    dragStateRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      lastTimeMs: now,
      velocityPxPerMs: 0,
      active: true,
    };
    const sheet = sheetRef.current;
    if (sheet) {
      sheet.style.transition = 'none';
      sheet.style.willChange = 'transform';
    }
  };

  const handleDragHandlePointerMove = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    const st = dragStateRef.current;
    if (!st || !st.active || st.pointerId !== e.pointerId) return;

    const now = performance.now();
    const dt = Math.max(1, now - st.lastTimeMs);
    const instantVy = (e.clientY - st.lastY) / dt;
    st.velocityPxPerMs = st.velocityPxPerMs * 0.4 + instantVy * 0.6;
    st.lastY = e.clientY;
    st.lastTimeMs = now;

    const deltaY = Math.max(0, e.clientY - st.startY);
    const sheet = sheetRef.current;
    if (sheet) {
      sheet.style.transform = `translate3d(0, ${deltaY}px, 0)`;
    }
  };

  const finishDragHandleGesture = (
    e: React.PointerEvent<HTMLDivElement>,
    cancelled: boolean
  ) => {
    const st = dragStateRef.current;
    if (!st || !st.active || st.pointerId !== e.pointerId) return;
    st.active = false;
    dragStateRef.current = null;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const deltaY = Math.max(0, e.clientY - st.startY);
    const shouldDismiss =
      !cancelled &&
      computeDragDismissDecision({
        deltaY,
        velocityPxPerMs: st.velocityPxPerMs,
      });

    const sheet = sheetRef.current;
    if (shouldDismiss) {
      if (sheet) {
        sheet.style.transition =
          'transform 160ms cubic-bezier(0.16, 1, 0.3, 1)';
        sheet.style.transform = 'translate3d(0, 100%, 0)';
      }
      window.setTimeout(() => {
        finalizeClose('drag_handle');
      }, 140);
      return;
    }

    if (sheet) {
      sheet.style.transition = 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)';
      sheet.style.transform = 'translate3d(0, 0, 0)';
      window.setTimeout(() => {
        if (sheetRef.current) {
          sheetRef.current.style.transition = '';
          sheetRef.current.style.transform = '';
          sheetRef.current.style.willChange = 'auto';
        }
      }, 190);
    }
  };

  // Pricing & Cart State for Sticky "Buy eBook" CTA Bar
  const compositeKey = makeCompositeKey('books', book.id);
  const isOwned = ownedCompositeKeys.has(compositeKey);
  const cartEntry = getCartItem(compositeKey);
  const isFree = book.buyPrice <= 0;
  const activeValidity = resolveValiditySelection(
    'books',
    book.buyPrice,
    selectedValidityMonths
  );
  const inCartSameValidity =
    Boolean(cartEntry) &&
    (isFree || cartEntry?.validityMonths === activeValidity.validityMonths);

  const itemPayload = useMemo(
    () => ({
      id: book.id,
      collectionName: 'books' as const,
      title: book.title,
      urlSlug: book.urlSlug,
      type: book.type || 'Ebook',
      authorName: book.authorName || 'ExamDash',
      language: book.language || 'English',
      currency: book.currency,
      baseBuyPrice: book.buyPrice,
      buyPrice: activeValidity.payablePrice,
      listPrice: activeValidity.fullPrice,
      validityMonths: activeValidity.validityMonths,
      validityLabel: activeValidity.label,
      ...(book.imageUrl ? { imageUrl: book.imageUrl } : {}),
      ...(book.imageAlt ? { imageAlt: book.imageAlt } : {}),
    }),
    [activeValidity, book]
  );

  const handleStickyAddToCart = () => {
    telemetryRef.current?.recordCtaClick({
      ctaType: 'sticky_add_to_cart',
      value: activeValidity.payablePrice,
      currency: book.currency,
      validityMonths: activeValidity.validityMonths,
    });
    if (inCartSameValidity) {
      finalizeClose('cta_checkout');
      openCart();
      return;
    }
    addItem(itemPayload);
  };

  const handleStickyBuyEbook = async () => {
    telemetryRef.current?.recordCtaClick({
      ctaType: 'sticky_buy_ebook',
      value: activeValidity.payablePrice,
      currency: book.currency,
      validityMonths: activeValidity.validityMonths,
    });
    finalizeClose('cta_checkout');
    await buyNow(itemPayload, { redirectToPurchased: true });
  };

  const handleEndCardCtaClick = useCallback(() => {
    telemetryRef.current?.recordCtaClick({
      ctaType: 'end_card_unlock',
      value: activeValidity.payablePrice,
      currency: book.currency,
      validityMonths: activeValidity.validityMonths,
    });
    closedOnceRef.current = true;
    telemetryRef.current?.close('cta_checkout');
    onCloseRef.current('cta_checkout');
  }, [activeValidity.payablePrice, activeValidity.validityMonths, book.currency]);

  const viewerBookDto = useMemo<PublicBookDTO>(
    () => ({
      id: book.id,
      collectionName: 'books',
      title: book.title,
      urlSlug: book.urlSlug,
      seoDescription: '',
      fullDescription: '',
      type: book.type || 'Ebook',
      language: book.language || 'English',
      publisher: 'ExamDash',
      authorName: book.authorName || 'ExamDash',
      tags: [],
      currency: book.currency,
      listPrice: book.listPrice,
      buyPrice: book.buyPrice,
      publishAtIso: '',
      updatedAtIso: '',
      createdAtIso: '',
      imageUrl: book.imageUrl || '',
      bookChapters: [],
      samplePdfUrl: book.samplePdfUrl || '',
      sampleMarkdownUrl: book.sampleMarkdownUrl || '',
      hasFullPdf: true,
      hasFullMarkdown: true,
    }),
    [book]
  );

  const samplePdfStreamUrl = buildBookSampleStreamUrl(book.urlSlug, 'pdf');
  const sampleMdStreamUrl = buildBookSampleStreamUrl(book.urlSlug, 'markdown');
  const hasBothSamples = Boolean(book.samplePdfUrl && book.sampleMarkdownUrl);

  const topBar: ReaderTopBarProps = {
    title: book.title,
    activeFormat: format,
    canSwitchFormat: hasBothSamples,
    onFormatChange: handleFormatChange,
    onClose: () => finalizeClose('close_button'),
    isModalOverlay: true,
    isMaximized,
    onToggleMaximize: () => setIsMaximized((prev) => !prev),
  };

  const progressSummaryText = useMemo(() => {
    if (!readingProgress || readingProgress.total <= 0) {
      return 'Free Sample';
    }
    const pct = Math.min(100, Math.max(1, Math.round(readingProgress.ratio * 100)));
    if (format === 'pdf') {
      return `Page ${readingProgress.current} of ${readingProgress.total} · ${pct}% read`;
    }
    return readingProgress.total > 1
      ? `Ch ${readingProgress.current}/${readingProgress.total} · ${pct}% read`
      : `Sample · ${pct}% read`;
  }, [format, readingProgress]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${book.title} — Sample Reader`}
      data-nosnippet=""
      onClick={() => finalizeClose('backdrop')}
      onPointerDown={handleUserActivity}
      onWheel={handleUserActivity}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 overscroll-contain"
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full h-[94dvh] max-h-[94dvh] rounded-t-2xl border-t md:border border-[var(--border-strong)] bg-[var(--bg-surface)] flex flex-col overflow-hidden overscroll-contain shadow-2xl',
          isMaximized
            ? 'md:w-[98vw] md:max-w-[1600px] md:h-[96dvh] md:max-h-[96dvh] md:rounded-xl'
            : 'md:w-[min(94vw,1120px)] md:h-[92dvh] md:max-h-[92dvh] md:rounded-2xl'
        )}
      >
        {/* Mobile Top Drag Handle ONLY — Swipe-to-close isolated strictly from document body; Close (X) button provides WCAG 2.5.7 single-tap alternative */}
        <div
          aria-hidden="true"
          data-testid="sample-sheet-drag-handle"
          onPointerDown={handleDragHandlePointerDown}
          onPointerMove={handleDragHandlePointerMove}
          onPointerUp={(e) => finishDragHandleGesture(e, false)}
          onPointerCancel={(e) => finishDragHandleGesture(e, true)}
          className="md:hidden flex flex-col items-center justify-center min-h-[28px] pt-2.5 pb-1.5 bg-[var(--reader-bg,var(--bg-surface))] border-b border-[var(--border-subtle)]/50 touch-none select-none cursor-grab active:cursor-grabbing shrink-0"
        >
          <span className="w-11 h-1.5 rounded-full bg-[var(--border-strong)]" />
        </div>

        {/* Active Same-DOM Reader Surface (Web Worker PDF Canvas or Web Worker Markdown) */}
        <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden overscroll-contain">
          {format === 'pdf' ? (
            <PdfViewer
              book={viewerBookDto}
              streamUrl={samplePdfStreamUrl}
              isSample={true}
              isOverlayEmbed={true}
              onReadingProgressChange={handleReadingProgressChange}
              onUserActivity={handleUserActivity}
              onEndCardCtaClick={handleEndCardCtaClick}
              topBar={topBar}
            />
          ) : (
            <MarkdownViewer
              book={viewerBookDto}
              streamUrl={sampleMdStreamUrl}
              isSample={true}
              isOverlayEmbed={true}
              onReadingProgressChange={handleReadingProgressChange}
              onUserActivity={handleUserActivity}
              onEndCardCtaClick={handleEndCardCtaClick}
              topBar={topBar}
            />
          )}
        </div>

        {/* Sticky "Buy eBook" Conversion Bar (Always Accessible While Reading) */}
        <div
          data-nosnippet=""
          className="flex items-center justify-between gap-3 px-3.5 sm:px-5 pt-2.5 pb-[calc(0.625rem+var(--safe-area-inset-bottom))] border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] shrink-0"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[11px] sm:text-xs text-[var(--text-muted)] truncate tabular-nums">
              <span>{progressSummaryText}</span>
              {!isOwned && !isFree && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="hidden sm:inline">{activeValidity.label}</span>
                  <span className="sm:hidden">
                    {activeValidity.validityMonths >= 12
                      ? `${Math.round(activeValidity.validityMonths / 12)}Y`
                      : `${activeValidity.validityMonths}M`}
                  </span>
                </>
              )}
            </p>
            <div className="mt-0.5 flex items-baseline gap-2 tabular-nums">
              <span className="text-base sm:text-lg font-extrabold text-[var(--text-main)] leading-none whitespace-nowrap">
                {isOwned
                  ? 'Unlocked in Library'
                  : isFree
                  ? 'Free'
                  : formatPrice(activeValidity.payablePrice, book.currency)}
              </span>
              {!isOwned && !isFree && activeValidity.discountPct > 0 && (
                <>
                  <span className="text-xs text-[var(--text-muted)] line-through whitespace-nowrap">
                    {formatPrice(activeValidity.fullPrice, book.currency)}
                  </span>
                  <span className="hidden sm:inline text-xs font-semibold text-[var(--status-success)] whitespace-nowrap">
                    {activeValidity.discountPct}% off
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isOwned ? (
              <a
                href="/purchased"
                rel="nofollow"
                className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 sm:px-5 rounded-lg bg-[var(--status-success)] text-white text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
              >
                <span>Open in Library →</span>
              </a>
            ) : (
              <>
                {!isFree && (
                  <button
                    type="button"
                    onClick={handleStickyAddToCart}
                    aria-label={
                      inCartSameValidity ? 'In cart — open cart' : 'Add eBook to cart'
                    }
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 min-h-[48px] min-w-[48px] px-3 sm:px-4 rounded-lg border text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0',
                      inCartSameValidity
                        ? 'border-[var(--status-success)] bg-[var(--status-success-bg)] text-[var(--status-success)]'
                        : 'border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-main)] hover:bg-[var(--border-subtle)]'
                    )}
                  >
                    {inCartSameValidity ? (
                      <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <ShoppingCart className="w-4 h-4 shrink-0" aria-hidden="true" />
                    )}
                    <span className="hidden sm:inline">
                      {inCartSameValidity ? 'In Cart' : 'Add to Cart'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={isCheckingOut}
                  onClick={() => void handleStickyBuyEbook()}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 sm:px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap shrink-0"
                >
                  {isFree ? (
                    <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    {isCheckingOut
                      ? 'Processing...'
                      : isFree
                      ? 'Claim Free eBook'
                      : 'Buy eBook'}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
