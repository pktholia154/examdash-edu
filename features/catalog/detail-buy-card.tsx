'use client';

import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  BookOpen,
  Check,
  Heart,
  Link2,
  Play,
  Share2,
  ShoppingCart,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  computeDiscountPercent,
  formatPrice,
  makeCompositeKey,
} from '../../lib/registry/content-type-registry';
import type { CollectionName } from '../../lib/types/catalog';
import { cn } from '../../lib/utils';
import { useAuth } from '../auth/auth-provider';
import { useCart } from '../cart/cart-provider';
import { InstallAppCallout } from '../pwa/install-banner';
import { useToast } from '../toast/toast-context';
import { useWishlist } from '../wishlist/wishlist-provider';

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
  type?: string;
  authorName?: string;
  language?: string;
  totalMocktest?: number;
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
  type,
  authorName,
  language,
  totalMocktest,
  currency,
  buyPrice,
  listPrice,
  samplePdfUrl,
  sampleMarkdownUrl,
  sampleJsonUrl,
}: DetailBuyCardProps) {
  const { ownedCompositeKeys } = useAuth();
  const { buyNow, addItem, isInCart, openCart, isCheckingOut } = useCart();
  const { isWishlisted, toggleWishlist } = useWishlist();
  const { showToast } = useToast();

  const [copiedLink, setCopiedLink] = useState(false);
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
  const inCart = isInCart(compositeKey);
  const wishlisted = isWishlisted(compositeKey);
  const isFree = buyPrice === 0;
  const discountPct = computeDiscountPercent(listPrice, buyPrice);
  const savingsAmount = Math.max(0, listPrice - buyPrice);

  const itemPayload = {
    id,
    collectionName,
    title,
    urlSlug,
    type:
      type || (collectionName === 'ExamPackDocument' ? 'Mock Test' : 'Ebook'),
    authorName: authorName || 'ExamDash',
    language: language || 'English',
    currency,
    buyPrice,
    listPrice,
    ...(typeof totalMocktest === 'number' ? { totalMocktest } : {}),
  };

  const handlePrimaryAction = async () => {
    await buyNow(itemPayload, { redirectToPurchased: true });
  };

  const getShareUrl = () => {
    if (typeof window !== 'undefined') {
      return window.location.href;
    }
    const base =
      collectionName === 'books' ? `/books/${urlSlug}` : `/exams/${urlSlug}`;
    return `https://exam-dash.com${base}`;
  };

  const handleCopyLink = async () => {
    const url = getShareUrl();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      }
      setCopiedLink(true);
      showToast('Link copied to clipboard', 'success');
      window.setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      showToast('Could not copy link right now', 'danger');
    }
  };

  const handleShare = async () => {
    const url = getShareUrl();
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `${title} — ExamDash`,
          text: `Check out "${title}" on ExamDash.`,
          url,
        });
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
      }
    }
    await handleCopyLink();
  };

  const handleAddToCartAction = () => {
    if (inCart) {
      openCart();
      return;
    }
    addItem(itemPayload);
  };

  const hasBookSample =
    collectionName === 'books' &&
    Boolean(samplePdfUrl || sampleMarkdownUrl);
  const defaultBookSampleFormat: 'pdf' | 'markdown' = samplePdfUrl
    ? 'pdf'
    : 'markdown';
  const hasExamSample =
    collectionName === 'ExamPackDocument' && Boolean(sampleJsonUrl);

  const primaryLabel = isCheckingOut
    ? 'Processing...'
    : isFree
    ? 'Claim Free'
    : 'Buy Now';

  return (
    <>
      {/* Dedicated Utility Action Bar directly ABOVE Price & Buy Now Bar */}
      <div
        role="toolbar"
        aria-label="Quick item actions"
        className={cn(
          'py-3 border-b border-[var(--border-subtle)] flex flex-wrap items-center gap-2 max-md:grid max-md:gap-2',
          !isOwned ? 'max-md:grid-cols-2' : 'max-md:grid-cols-3'
        )}
      >
        <button
          type="button"
          aria-pressed={wishlisted}
          onClick={() => toggleWishlist(itemPayload)}
          className={cn(
            'inline-flex items-center justify-center gap-2 min-h-[44px] max-md:w-full px-3.5 max-md:px-2.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-w-0',
            wishlisted
              ? 'border-[var(--status-wishlist)] bg-[var(--status-wishlist-bg)] text-[var(--status-wishlist)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]'
          )}
        >
          <Heart
            className={cn('w-4 h-4 shrink-0', wishlisted && 'fill-current')}
            aria-hidden="true"
          />
          <span className="truncate">{wishlisted ? 'Wishlisted' : 'Wishlist'}</span>
        </button>

        {!isOwned && (
          <button
            type="button"
            aria-pressed={inCart}
            onClick={handleAddToCartAction}
            className={cn(
              'inline-flex items-center justify-center gap-2 min-h-[44px] max-md:w-full px-3.5 max-md:px-2.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-w-0',
              inCart
                ? 'border-[var(--status-success)] bg-[var(--status-success-bg)] text-[var(--status-success)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]'
            )}
          >
            {inCart ? (
              <>
                <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="truncate">In Cart</span>
              </>
            ) : (
              <>
                <ShoppingCart className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="truncate">Add to Cart</span>
              </>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={() => void handleShare()}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] max-md:w-full px-3.5 max-md:px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0 min-w-0"
        >
          <Share2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Share</span>
        </button>

        <button
          type="button"
          onClick={() => void handleCopyLink()}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] max-md:w-full px-3.5 max-md:px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0 min-w-0"
        >
          {copiedLink ? (
            <>
              <Check
                className="w-4 h-4 text-[var(--status-success)] shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">Copied</span>
            </>
          ) : (
            <>
              <Link2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Copy Link</span>
            </>
          )}
        </button>
      </div>

      {/* Price & Buy Now / Sample Bar */}
      <div
        aria-label="Purchase and sample options"
        className="py-5 max-md:py-4 border-b border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 max-md:gap-3.5"
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

        <div
          className={cn(
            'flex flex-wrap items-center gap-2.5 max-md:w-full max-md:grid max-md:gap-2.5',
            hasBookSample || (hasExamSample && Boolean(sampleJsonUrl))
              ? 'max-md:grid-cols-2'
              : 'max-md:grid-cols-1'
          )}
        >
          {isOwned ? (
            <a
              href="/purchased"
              className="inline-flex items-center justify-center gap-2 min-h-[48px] max-md:w-full px-5 max-md:px-3.5 rounded-lg bg-[var(--status-success)] text-white text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap min-w-0"
            >
              <span className="truncate">Open in Purchased Library →</span>
            </a>
          ) : (
            <button
              type="button"
              disabled={isCheckingOut}
              onClick={() => void handlePrimaryAction()}
              className="inline-flex items-center justify-center gap-2 min-h-[48px] max-md:w-full px-6 max-md:px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap min-w-0"
            >
              {isFree ? (
                <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
              ) : (
                <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">{primaryLabel}</span>
            </button>
          )}

          {hasBookSample && (
            <button
              type="button"
              onClick={() => openSampleReader(defaultBookSampleFormat)}
              className="inline-flex items-center justify-center gap-2 min-h-[48px] max-md:w-full px-4 max-md:px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap min-w-0"
            >
              <BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Sample</span>
            </button>
          )}

          {hasExamSample && sampleJsonUrl && (
            <a
              href={sampleJsonUrl}
              className="inline-flex items-center justify-center gap-2 min-h-[48px] max-md:w-full px-4 max-md:px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap min-w-0"
            >
              <Play className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Try Sample Mock</span>
            </a>
          )}
        </div>
      </div>

      {/* Contextual Install Now / Open in App Banner right below Buy Now / Sample bar */}
      <InstallAppCallout
        variant="detail"
        itemKind={collectionName === 'books' ? 'book' : 'exam'}
        className="mt-4 max-md:mt-3.5"
      />

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
