'use client';

import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  BookOpen,
  Check,
  ExternalLink,
  FileText,
  Play,
  ShoppingBag,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { CatalogItemDTO } from '../../lib/types/catalog';
import {
  computeDiscountPercent,
  formatPrice,
  makeCompositeKey,
  makeFirestoreSafeCartKey,
} from '../../lib/registry/content-type-registry';
import { useAuth } from '../auth/auth-provider';
import { useCart } from '../cart/cart-provider';
import { useToast } from '../toast/toast-context';

const LazyBookInlineReaderModal = dynamic(
  () =>
    import('./book-inline-reader-modal').then((m) => m.BookInlineReaderModal),
  { ssr: false }
);

export function DetailBuyCard({ item }: { item: CatalogItemDTO }) {
  const { ownedCompositeKeys, recordCompletedPurchases } = useAuth();
  const { isInCart, addItem, openCart, claimFreeItem, isCheckingOut } = useCart();
  const { showToast } = useToast();

  const [inlineReaderState, setInlineReaderState] = useState<{
    open: boolean;
    format: 'pdf' | 'markdown';
    mode: 'sample' | 'full';
  } | null>(null);

  const openInlineReader = useCallback(
    (format: 'pdf' | 'markdown', mode: 'sample' | 'full') => {
      if (typeof window !== 'undefined') {
        try {
          const currentState =
            window.history.state && typeof window.history.state === 'object'
              ? (window.history.state as Record<string, unknown>)
              : {};
          if (!currentState.edInlineReader) {
            window.history.pushState(
              { ...currentState, edInlineReader: true },
              ''
            );
          }
        } catch {
          // Ignore restricted iframe history APIs
        }
      }
      setInlineReaderState({ open: true, format, mode });
    },
    []
  );

  const closeInlineReader = useCallback(() => {
    setInlineReaderState(null);
  }, []);

  const compositeKey = makeCompositeKey(item.collectionName, item.id);
  const isOwned = item.buyPrice === 0 || ownedCompositeKeys.has(compositeKey);
  const inCart = isInCart(compositeKey);
  const isFree = item.buyPrice === 0;
  const discountPct = computeDiscountPercent(item.listPrice, item.buyPrice);
  const savingsAmount = Math.max(0, item.listPrice - item.buyPrice);

  const openHref =
    item.collectionName === 'books'
      ? `/read/${item.urlSlug}`
      : `/attempt/${item.urlSlug}`;

  const handleInstantBuy = async () => {
    if (isFree) {
      await claimFreeItem(item);
      return;
    }
    const ok = await recordCompletedPurchases([
      {
        compositeKey,
        firestoreKey: makeFirestoreSafeCartKey(item.collectionName, item.id),
        id: item.id,
        collectionName: item.collectionName,
        urlSlug: item.urlSlug,
        title: item.title,
        authorName: item.authorName,
        language: item.language,
        type: item.type,
        currency: (item.currency || 'INR').toUpperCase(),
        listPrice: item.listPrice,
        buyPrice: item.buyPrice,
        ...(item.collectionName === 'ExamPackDocument'
          ? { totalMocktest: item.totalMocktest }
          : {}),
      },
    ]);
    if (ok) {
      showToast(`Unlocked "${item.title}" in your Library!`, 'success');
    }
  };

  const hasBookPdfSample =
    item.collectionName === 'books' && Boolean(item.samplePdfUrl);
  const hasBookMarkdownSample =
    item.collectionName === 'books' && Boolean(item.sampleMarkdownUrl);
  const canReadFullPdf =
    item.collectionName === 'books' &&
    isOwned &&
    (item.hasFullPdf || Boolean(item.samplePdfUrl));
  const canReadFullMarkdown =
    item.collectionName === 'books' &&
    isOwned &&
    (item.hasFullMarkdown || Boolean(item.sampleMarkdownUrl));

  return (
    <>
      {/* Seamless Inline Purchase & Sample Action Bar */}
      <div
        aria-label="Purchase and sample options"
        className="py-5 border-b border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 gated-asset-boundary"
      >
        {/* Price & Savings Summary */}
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 tabular-nums">
          <span className="text-2xl font-extrabold text-[var(--text-main)] leading-none">
            {isFree ? 'Free' : formatPrice(item.buyPrice, item.currency)}
          </span>
          {discountPct > 0 && (
            <span className="text-sm text-[var(--text-muted)] line-through">
              {formatPrice(item.listPrice, item.currency)}
            </span>
          )}
          {discountPct > 0 && (
            <span className="text-xs font-semibold text-[var(--status-success)]">
              {discountPct}% OFF · Save {formatPrice(savingsAmount, item.currency)}
            </span>
          )}
        </div>

        {/* Seamless Inline Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {isOwned ? (
            <>
              {item.collectionName === 'books' ? (
                <>
                  {canReadFullPdf && (
                    <button
                      type="button"
                      onClick={() => openInlineReader('pdf', 'full')}
                      className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg bg-[var(--status-success)] text-white text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                    >
                      <FileText className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Read Full PDF</span>
                    </button>
                  )}

                  {canReadFullMarkdown && (
                    <button
                      type="button"
                      onClick={() => openInlineReader('markdown', 'full')}
                      className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg border border-[var(--border-strong)] bg-transparent text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
                    >
                      <BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Read Full Markdown</span>
                    </button>
                  )}

                  <a
                    href={`${openHref}?mode=full&format=pdf`}
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg border border-[var(--border-subtle)] bg-transparent text-sm font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]/60 transition-colors whitespace-nowrap"
                  >
                    <span>Open in Reader</span>
                    <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
                  </a>
                </>
              ) : (
                <a
                  href={openHref}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg bg-[var(--status-success)] text-white text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                  <span>Start Mock Exam</span>
                  <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
                </a>
              )}
            </>
          ) : isFree ? (
            <button
              type="button"
              disabled={isCheckingOut}
              onClick={() => void claimFreeItem(item)}
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Claim Free</span>
            </button>
          ) : (
            <>
              {inCart ? (
                <button
                  type="button"
                  onClick={openCart}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-main)] text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                  <Check
                    className="w-4 h-4 text-[var(--status-success)] shrink-0"
                    aria-hidden="true"
                  />
                  <span>In Cart</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => addItem(item)}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                  <ShoppingBag className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Add to Cart</span>
                </button>
              )}

              <button
                type="button"
                disabled={isCheckingOut}
                onClick={() => void handleInstantBuy()}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg border border-[var(--border-strong)] bg-transparent text-[var(--text-main)] text-sm font-semibold hover:bg-[var(--bg-elevated)] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Instant Unlock</span>
              </button>
            </>
          )}

          {/* Inline Book Sample Buttons (opens in-page PDF/Markdown Viewer WITHOUT leaving /books/[urlSlug]) */}
          {hasBookPdfSample && (
            <button
              type="button"
              onClick={() => openInlineReader('pdf', 'sample')}
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg border border-[var(--border-subtle)] bg-transparent text-sm font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]/60 transition-colors whitespace-nowrap"
            >
              <FileText className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>PDF Sample</span>
            </button>
          )}

          {hasBookMarkdownSample && (
            <button
              type="button"
              onClick={() => openInlineReader('markdown', 'sample')}
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg border border-[var(--border-subtle)] bg-transparent text-sm font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]/60 transition-colors whitespace-nowrap"
            >
              <BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Markdown Sample</span>
            </button>
          )}

          {/* Exam Sample Trial Button */}
          {item.collectionName === 'ExamPackDocument' &&
            item.sampleJsonStoragePath && (
              <a
                href={`/attempt/${item.urlSlug}?mode=trial`}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg border border-[var(--border-subtle)] bg-transparent text-sm font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]/60 transition-colors whitespace-nowrap"
              >
                <Play className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Sample Mock</span>
              </a>
            )}
        </div>
      </div>

      {/* Mobile Sticky Bottom Purchase & Sample Bar (56px, replaces bottom nav on detail routes) */}
      <div
        data-nosnippet=""
        className="md:hidden fixed bottom-0 inset-x-0 z-30 h-14 border-t border-[var(--border-strong)] bg-[var(--bg-canvas)]/95 backdrop-blur-md px-4 pb-[var(--safe-area-inset-bottom)] flex items-center justify-between gap-2.5"
      >
        <div className="min-w-0 tabular-nums">
          <p className="text-base font-extrabold text-[var(--text-main)] leading-tight">
            {isFree ? 'Free' : formatPrice(item.buyPrice, item.currency)}
          </p>
          {discountPct > 0 && (
            <p className="text-[11px] font-semibold text-[var(--status-success)] leading-tight">
              {discountPct}% OFF
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isOwned && hasBookPdfSample && (
            <button
              type="button"
              onClick={() => openInlineReader('pdf', 'sample')}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Sample</span>
            </button>
          )}

          {isOwned ? (
            item.collectionName === 'books' ? (
              <button
                type="button"
                onClick={() =>
                  openInlineReader(canReadFullPdf ? 'pdf' : 'markdown', 'full')
                }
                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-[var(--status-success)] text-white text-xs font-semibold whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Read PDF</span>
              </button>
            ) : (
              <a
                href={openHref}
                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-5 rounded-lg bg-[var(--status-success)] text-white text-xs font-semibold whitespace-nowrap"
              >
                <span>Open</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            )
          ) : inCart ? (
            <button
              type="button"
              onClick={openCart}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-xs font-semibold text-[var(--text-main)] whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5 text-[var(--status-success)]" aria-hidden="true" />
              <span>In Cart</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => (isFree ? void claimFreeItem(item) : addItem(item))}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold whitespace-nowrap"
            >
              <span>{isFree ? 'Claim Free' : 'Add to Cart'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Lazy-Loaded In-Page Reader Modal (zero JS overhead until user clicks Sample / Read) */}
      {item.collectionName === 'books' && inlineReaderState?.open && (
        <LazyBookInlineReaderModal
          book={item}
          initialFormat={inlineReaderState.format}
          initialMode={inlineReaderState.mode}
          onClose={closeInlineReader}
        />
      )}
    </>
  );
}
