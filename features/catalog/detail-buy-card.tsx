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
  formatPrice,
  makeCompositeKey,
} from '../../lib/registry/content-type-registry';
import {
  getValidityOptions,
  resolveValiditySelection,
} from '../../lib/validity/pricing';
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
  imageUrl?: string;
  imageAlt?: string;
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
  imageUrl,
  imageAlt,
  samplePdfUrl,
  sampleMarkdownUrl,
  sampleJsonUrl,
}: DetailBuyCardProps) {
  const { ownedCompositeKeys } = useAuth();
  const { buyNow, addItem, getCartItem, openCart, isCheckingOut } = useCart();
  const { isWishlisted, toggleWishlist } = useWishlist();
  const { showToast } = useToast();

  const validityOptions = getValidityOptions(collectionName, buyPrice);
  const [selectedValidityMonths, setSelectedValidityMonths] = useState<number>(
    () => (buyPrice <= 0 ? validityOptions[1].validityMonths : validityOptions[0].validityMonths)
  );
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
  const cartEntry = getCartItem(compositeKey);
  const wishlisted = isWishlisted(compositeKey);
  const isFree = buyPrice <= 0;
  const activeValidity = resolveValiditySelection(
    collectionName,
    buyPrice,
    selectedValidityMonths
  );
  const inCartSameValidity =
    Boolean(cartEntry) &&
    (isFree || cartEntry?.validityMonths === activeValidity.validityMonths);
  const inCartDifferentValidity =
    Boolean(cartEntry) &&
    !isFree &&
    cartEntry?.validityMonths !== activeValidity.validityMonths;

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
    baseBuyPrice: buyPrice,
    buyPrice: activeValidity.payablePrice,
    listPrice: activeValidity.fullPrice,
    validityMonths: activeValidity.validityMonths,
    validityLabel: activeValidity.label,
    ...(imageUrl ? { imageUrl } : {}),
    ...(imageAlt ? { imageAlt } : {}),
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
    if (inCartSameValidity) {
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
      {/* Minimal Single-Row Circular Icon Action Bar */}
      <div
        data-nosnippet=""
        role="toolbar"
        aria-label="Quick item actions"
        className="pt-3.5 pb-0.5 flex flex-row flex-nowrap items-center gap-3.5 sm:gap-4"
      >
        <button
          type="button"
          aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          title={wishlisted ? 'Wishlisted' : 'Wishlist'}
          aria-pressed={wishlisted}
          onClick={() => toggleWishlist(itemPayload)}
          className={cn(
            'inline-flex items-center justify-center w-11 h-11 rounded-full shrink-0 active:scale-95 transition-[background-color,color,transform]',
            wishlisted
              ? 'bg-[var(--status-wishlist-bg)] text-[var(--status-wishlist)]'
              : 'bg-[var(--bg-elevated)] text-[var(--text-main)] hover:bg-[var(--border-subtle)]'
          )}
        >
          <Heart
            className={cn('w-[18px] h-[18px] shrink-0', wishlisted && 'fill-current')}
            aria-hidden="true"
          />
        </button>

        {!isOwned && (
          <button
            type="button"
            aria-label={
              inCartSameValidity
                ? 'In cart — open cart'
                : inCartDifferentValidity
                ? 'Update cart with selected validity'
                : 'Add to cart'
            }
            title={
              inCartSameValidity
                ? 'In Cart'
                : inCartDifferentValidity
                ? 'Update Cart'
                : 'Add to Cart'
            }
            aria-pressed={inCartSameValidity}
            onClick={handleAddToCartAction}
            className={cn(
              'inline-flex items-center justify-center w-11 h-11 rounded-full shrink-0 active:scale-95 transition-[background-color,color,transform]',
              inCartSameValidity
                ? 'bg-[var(--status-success-bg)] text-[var(--status-success)]'
                : inCartDifferentValidity
                ? 'bg-[var(--bg-elevated)] text-[var(--brand-primary)] hover:bg-[var(--border-subtle)]'
                : 'bg-[var(--bg-elevated)] text-[var(--text-main)] hover:bg-[var(--border-subtle)]'
            )}
          >
            {inCartSameValidity ? (
              <Check className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
            ) : (
              <ShoppingCart
                className="w-[18px] h-[18px] shrink-0"
                aria-hidden="true"
              />
            )}
          </button>
        )}

        <button
          type="button"
          aria-label="Share"
          title="Share"
          onClick={() => void handleShare()}
          className="inline-flex items-center justify-center w-11 h-11 rounded-full shrink-0 bg-[var(--bg-elevated)] text-[var(--text-main)] hover:bg-[var(--border-subtle)] active:scale-95 transition-[background-color,color,transform]"
        >
          <Share2 className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-label={copiedLink ? 'Link copied' : 'Copy link'}
          title={copiedLink ? 'Copied' : 'Copy Link'}
          onClick={() => void handleCopyLink()}
          className={cn(
            'inline-flex items-center justify-center w-11 h-11 rounded-full shrink-0 active:scale-95 transition-[background-color,color,transform]',
            copiedLink
              ? 'bg-[var(--status-success-bg)] text-[var(--status-success)]'
              : 'bg-[var(--bg-elevated)] text-[var(--text-main)] hover:bg-[var(--border-subtle)]'
          )}
        >
          {copiedLink ? (
            <Check className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
          ) : (
            <Link2 className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Price, Validity Selector & Buy Now / Sample Bar */}
      <div
        aria-label="Purchase and sample options"
        className="py-5 max-md:py-4 border-b border-[var(--border-subtle)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 max-md:gap-3.5"
      >
        <div className="flex flex-row flex-wrap items-center gap-x-4 gap-y-2.5 min-w-0">
          {/* Dynamic Price Readout */}
          <div className="flex items-baseline tabular-nums shrink-0">
            <span className="text-[26px] font-extrabold text-[var(--text-main)] leading-none">
              {isFree
                ? 'Free'
                : formatPrice(activeValidity.payablePrice, currency)}
            </span>
          </div>

          {/* Compact Single-Select Validity Checkboxes right next to Price */}
          {!isFree && !isOwned && (
            <div
              role="group"
              aria-label="Select access validity"
              className="flex flex-wrap items-center gap-2"
            >
              {validityOptions.map((option) => {
                const isSelected =
                  activeValidity.validityMonths === option.validityMonths;
                const shouldEntice = option.isLongValidity && !isSelected;

                return (
                  <label
                    key={option.validityMonths}
                    className={cn(
                      'relative inline-flex items-center gap-2 min-h-[44px] px-2.5 py-1.5 rounded-lg border cursor-pointer select-none transition-colors shrink-0',
                      isSelected
                        ? 'border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-main)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-main)]',
                      shouldEntice && 'ed-validity-entice'
                    )}
                  >
                    {shouldEntice && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
                      >
                        <span className="ed-validity-entice-sheen" />
                      </span>
                    )}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() =>
                        setSelectedValidityMonths(option.validityMonths)
                      }
                      aria-label={`Validity ${option.label}`}
                      className="sr-only peer"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'relative z-10 inline-flex items-center justify-center w-5 h-5 rounded-[5px] border transition-colors shrink-0 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--brand-primary)]',
                        isSelected
                          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                      )}
                    >
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" aria-hidden="true" />
                      )}
                    </span>
                    <span className="relative z-10 flex flex-col leading-none gap-0.5 whitespace-nowrap">
                      <span className="text-[10px] font-normal text-[var(--text-muted)] leading-none">
                        Validity
                      </span>
                      <span
                        className={cn(
                          'text-xs font-medium leading-tight',
                          isSelected
                            ? 'text-[var(--text-main)]'
                            : 'text-[var(--text-muted)]'
                        )}
                      >
                        {option.label}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div
          className={cn(
            'max-lg:mt-2 flex flex-wrap items-center gap-2.5 max-md:w-full max-md:grid max-md:gap-2.5',
            hasBookSample || (hasExamSample && Boolean(sampleJsonUrl))
              ? 'max-md:grid-cols-2'
              : 'max-md:grid-cols-1'
          )}
        >
          {isOwned ? (
            <a
              href="/purchased"
              rel="nofollow"
              className="inline-flex items-center justify-center gap-2 min-h-[48px] max-md:w-full px-5 max-md:px-3.5 rounded-lg bg-[var(--status-success)] text-white text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap min-w-0"
            >
              <span className="truncate">Open in Purchased Library →</span>
            </a>
          ) : (
            <button
              type="button"
              disabled={isCheckingOut}
              onClick={() => void handlePrimaryAction()}
              className="inline-flex items-center justify-center gap-2 min-h-[48px] max-md:w-full px-6 max-md:px-4 rounded-lg border-2 border-solid border-black dark:border-[var(--brand-primary)] bg-[var(--bg-canvas)] text-black dark:text-[var(--text-main)] text-sm font-semibold hover:bg-[var(--bg-elevated)] disabled:opacity-50 transition-colors whitespace-nowrap min-w-0"
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
              className="ed-sample-cta inline-flex items-center justify-center gap-2 min-h-[48px] max-md:w-full px-5 max-md:px-3.5 rounded-lg border text-sm font-semibold whitespace-nowrap min-w-0"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
              >
                <span className="ed-sample-cta-sheen" />
              </span>
              <BookOpen className="relative z-10 w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="relative z-10 truncate">Sample</span>
            </button>
          )}

          {hasExamSample && sampleJsonUrl && (
            <a
              href={sampleJsonUrl}
              rel="nofollow"
              className="ed-sample-cta inline-flex items-center justify-center gap-2 min-h-[48px] max-md:w-full px-5 max-md:px-3 rounded-lg border text-sm font-semibold whitespace-nowrap min-w-0"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
              >
                <span className="ed-sample-cta-sheen" />
              </span>
              <Play className="relative z-10 w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="relative z-10 truncate">Try Sample Mock</span>
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
