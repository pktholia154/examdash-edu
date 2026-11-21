'use client';

import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  BookOpen,
  FileText,
  Play,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  computeDiscountPercent,
  formatPrice,
  makeCompositeKey,
} from '../../lib/registry/content-type-registry';
import type { CollectionName } from '../../lib/types/catalog';
import { useAuth } from '../auth/auth-provider';
import { useCart } from '../cart/cart-provider';

const LazyBookInlineReaderModal = dynamic(
  () =>
    import('./book-inline-reader-modal').then((m) => m.BookInlineReaderModal),
  { ssr: false }
);

/**
 * Primitive-only props contract (Module 4 RSC Payload Slimming):
 * Prevents serializing 3+ KB of `fullDescription` Markdown into `self.__next_f`.
 */
export interface DetailBuyCardProps {
  id: string;
  collectionName: CollectionName;
  title: string;
  urlSlug: string;
  currency: string;
  buyPrice: number;
  listPrice: number;
  samplePdfUrl?: string;
  sampleMarkdownUrl?: string;
  sampleJsonUrl?: string;
}

export function DetailBuyCard({
  id,
  collectionName,
  title,
  urlSlug,
  currency,
  buyPrice,
  listPrice,
  samplePdfUrl,
  sampleMarkdownUrl,
  sampleJsonUrl,
}: DetailBuyCardProps) {
  const { ownedCompositeKeys } = useAuth();
  const { buyNow, isCheckingOut } = useCart();

  const [inlineSampleState, setInlineSampleState] = useState<{
    open: boolean;
    format: 'pdf' | 'markdown';
  } | null>(null);

  const openSampleReader = useCallback((format: 'pdf' | 'markdown') => {
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
    setInlineSampleState({ open: true, format });
  }, []);

  const closeSampleReader = useCallback(() => {
    setInlineSampleState(null);
  }, []);

  const compositeKey = makeCompositeKey(collectionName, id);
  const isOwned = ownedCompositeKeys.has(compositeKey);
  const isFree = buyPrice === 0;
  const discountPct = computeDiscountPercent(listPrice, buyPrice);
  const savingsAmount = Math.max(0, listPrice - buyPrice);

  const handlePrimaryAction = async () => {
    await buyNow(
      {
        id,
        collectionName,
        title,
        urlSlug,
        currency,
        buyPrice,
        listPrice,
      },
      { redirectToPurchased: true }
    );
  };

  const hasBookPdfSample = collectionName === 'books' && Boolean(samplePdfUrl);
  const hasBookMarkdownSample =
    collectionName === 'books' && Boolean(sampleMarkdownUrl);
  const hasExamSample =
    collectionName === 'ExamPackDocument' && Boolean(sampleJsonUrl);

  const primaryLabel = isCheckingOut
    ? 'Processing...'
    : isFree
    ? 'Claim Free'
    : 'Buy Now';

  return (
    <>
      {/* Strict 2-Action Detail Bar (Zero Add to Cart, Zero .gated-asset-boundary) */}
      <div
        aria-label="Purchase and sample options"
        className="py-5 border-b border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 tabular-nums">
          <span className="text-2xl font-extrabold text-[var(--text-main)] leading-none">
            {isFree ? 'Free' : formatPrice(buyPrice, currency)}
          </span>
          {discountPct > 0 && (
            <span className="text-sm text-[var(--text-muted)] line-through">
              {formatPrice(listPrice, currency)}
            </span>
          )}
          {discountPct > 0 && (
            <span className="text-xs font-semibold text-[var(--status-success)]">
              {discountPct}% OFF · Save {formatPrice(savingsAmount, currency)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isOwned ? (
            <a
              href="/purchased"
              className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--status-success)] text-white text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <span>Open in Purchased Library →</span>
            </a>
          ) : (
            <button
              type="button"
              disabled={isCheckingOut}
              onClick={() => void handlePrimaryAction()}
              className="inline-flex items-center justify-center gap-2 min-h-[48px] px-6 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
            >
              {isFree ? (
                <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
              ) : (
                <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>{primaryLabel}</span>
            </button>
          )}

          {hasBookPdfSample && (
            <button
              type="button"
              onClick={() => openSampleReader('pdf')}
              className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-transparent text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
            >
              <FileText className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>PDF Sample</span>
            </button>
          )}

          {hasBookMarkdownSample && (
            <button
              type="button"
              onClick={() => openSampleReader('markdown')}
              className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-transparent text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
            >
              <BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Markdown Sample</span>
            </button>
          )}

          {hasExamSample && sampleJsonUrl && (
            <a
              href={sampleJsonUrl}
              className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-transparent text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
            >
              <Play className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Try Sample Mock</span>
            </a>
          )}
        </div>
      </div>

      {/* Mobile Sticky Bottom Bar (data-nosnippet, Strict 2-Action Contract, <= 60px height) */}
      <div
        data-nosnippet=""
        className="md:hidden fixed bottom-0 inset-x-0 z-30 h-15 border-t border-[var(--border-strong)] bg-[var(--bg-canvas)]/95 backdrop-blur-md px-4 pb-[var(--safe-area-inset-bottom)] flex items-center justify-between gap-2.5"
      >
        <div className="min-w-0 tabular-nums">
          <p className="text-base font-extrabold text-[var(--text-main)] leading-tight">
            {isFree ? 'Free' : formatPrice(buyPrice, currency)}
          </p>
          {discountPct > 0 && (
            <p className="text-[11px] font-semibold text-[var(--status-success)] leading-tight">
              {discountPct}% OFF
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasBookPdfSample ? (
            <button
              type="button"
              onClick={() => openSampleReader('pdf')}
              className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              <span>PDF Sample</span>
            </button>
          ) : hasBookMarkdownSample ? (
            <button
              type="button"
              onClick={() => openSampleReader('markdown')}
              className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] whitespace-nowrap"
            >
              <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Markdown Sample</span>
            </button>
          ) : null}

          {hasExamSample && sampleJsonUrl && (
            <a
              href={sampleJsonUrl}
              className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Try Sample Mock</span>
            </a>
          )}

          {isOwned ? (
            <a
              href="/purchased"
              className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 rounded-lg bg-[var(--status-success)] text-white text-xs font-semibold whitespace-nowrap"
            >
              <span>Open in Purchased Library →</span>
            </a>
          ) : (
            <button
              type="button"
              disabled={isCheckingOut}
              onClick={() => void handlePrimaryAction()}
              className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
            >
              {isFree ? (
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Zap className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{primaryLabel}</span>
            </button>
          )}
        </div>
      </div>

      {collectionName === 'books' && inlineSampleState?.open && (
        <LazyBookInlineReaderModal
          book={{
            id,
            title,
            urlSlug,
            currency,
            buyPrice,
            listPrice,
            samplePdfUrl,
            sampleMarkdownUrl,
          }}
          initialFormat={inlineSampleState.format}
          onClose={closeSampleReader}
        />
      )}
    </>
  );
}
