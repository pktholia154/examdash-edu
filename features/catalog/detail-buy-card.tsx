'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import type {
  SampleCloseReason,
  SampleTriggerSource,
  SampleViewerFormat,
} from '../../lib/analytics/sample-telemetry';
import {
  popSameUrlSampleHistoryStateIfPresent,
  pushSameUrlSampleHistoryState,
  subscribeOpenBookSample,
} from '../../lib/reader/sample-overlay-events';
import { prefetchBookSampleOnIntent } from '../../lib/reader/sample-stream-loader';
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
import { SampleOverlayInstantShellSkeleton } from '../reader/shared/sample-viewer-skeleton';
import { useToast } from '../toast/toast-context';
import { useWishlist } from '../wishlist/wishlist-provider';
import type { BookInlineReaderModalProps } from './book-inline-reader-modal';

type LoadedModalComponent = React.ComponentType<BookInlineReaderModalProps>;

let cachedModalComponent: LoadedModalComponent | null = null;
let modalImportPromise: Promise<LoadedModalComponent> | null = null;

function loadBookInlineReaderModalChunk(): Promise<LoadedModalComponent> {
  if (cachedModalComponent) {
    return Promise.resolve(cachedModalComponent);
  }
  if (!modalImportPromise) {
    modalImportPromise = import('./book-inline-reader-modal').then((mod) => {
      cachedModalComponent = mod.BookInlineReaderModal;
      return mod.BookInlineReaderModal;
    });
  }
  return modalImportPromise;
}

function preloadSampleViewerChunks(preferredFormat: SampleViewerFormat): void {
  void loadBookInlineReaderModalChunk().catch(() => {});
  if (preferredFormat === 'pdf') {
    void import('../reader/pdf/pdf-viewer').catch(() => {});
  } else {
    void import('../reader/markdown/markdown-viewer').catch(() => {});
  }
}

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
    () =>
      buyPrice <= 0
        ? validityOptions[1].validityMonths
        : validityOptions[0].validityMonths
  );
  const [copiedLink, setCopiedLink] = useState(false);
  const [inlineSampleState, setInlineSampleState] = useState<{
    open: boolean;
    format: SampleViewerFormat;
    triggerSource: SampleTriggerSource;
  } | null>(null);
  const [ModalComponent, setModalComponent] =
    useState<LoadedModalComponent | null>(() => cachedModalComponent);

  const suppressNextPopStateRef = useRef(false);

  const hasBookSample =
    collectionName === 'books' && Boolean(samplePdfUrl || sampleMarkdownUrl);
  const defaultBookSampleFormat: SampleViewerFormat = samplePdfUrl
    ? 'pdf'
    : 'markdown';
  const hasExamSample =
    collectionName === 'ExamPackDocument' && Boolean(sampleJsonUrl);

  const handlePrefetchSampleIntent = useCallback(() => {
    if (!hasBookSample) return;
    prefetchBookSampleOnIntent({
      urlSlug,
      preferredFormat: defaultBookSampleFormat,
      preloadViewerChunks: () =>
        preloadSampleViewerChunks(defaultBookSampleFormat),
    });
  }, [defaultBookSampleFormat, hasBookSample, urlSlug]);

  const openSampleReader = useCallback(
    (
      format: SampleViewerFormat,
      triggerSource: SampleTriggerSource = 'buy_card_cta'
    ) => {
      pushSameUrlSampleHistoryState(id);
      setInlineSampleState({ open: true, format, triggerSource });

      if (!cachedModalComponent) {
        void loadBookInlineReaderModalChunk()
          .then((Comp) => {
            setModalComponent(() => Comp);
          })
          .catch(() => {});
      } else if (!ModalComponent) {
        setModalComponent(() => cachedModalComponent);
      }
    },
    [ModalComponent, id]
  );

  const closeSampleReader = useCallback((reason: SampleCloseReason) => {
    setInlineSampleState(null);

    if (
      reason !== 'back_button' &&
      reason !== 'cta_checkout' &&
      reason !== 'pagehide'
    ) {
      suppressNextPopStateRef.current = true;
      const didPop = popSameUrlSampleHistoryStateIfPresent();
      if (!didPop) {
        suppressNextPopStateRef.current = false;
      } else {
        window.setTimeout(() => {
          suppressNextPopStateRef.current = false;
        }, 250);
      }
    }
  }, []);

  // Listen for same-URL mobile/browser Back button (`popstate`) while Sample Viewer is open
  useEffect(() => {
    if (!inlineSampleState?.open) return;

    const onPopState = () => {
      if (suppressNextPopStateRef.current) {
        suppressNextPopStateRef.current = false;
        return;
      }
      setInlineSampleState(null);
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, [inlineSampleState?.open]);

  // Listen for Chapter 1 Same-DOM open requests from `BookChaptersList`
  useEffect(() => {
    if (collectionName !== 'books' || !hasBookSample) return;
    return subscribeOpenBookSample(id, (detail) => {
      const requestedFormat: SampleViewerFormat =
        detail.format === 'markdown' && sampleMarkdownUrl
          ? 'markdown'
          : detail.format === 'pdf' && samplePdfUrl
          ? 'pdf'
          : defaultBookSampleFormat;
      openSampleReader(requestedFormat, detail.triggerSource);
    });
  }, [
    collectionName,
    defaultBookSampleFormat,
    hasBookSample,
    id,
    openSampleReader,
    sampleMarkdownUrl,
    samplePdfUrl,
  ]);

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
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function'
    ) {
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

  const primaryLabel = isCheckingOut
    ? 'Processing...'
    : isFree
    ? 'Claim Free'
    : 'Buy Now';

  const formattedPriceLabel = isFree
    ? 'Free'
    : formatPrice(activeValidity.payablePrice, currency);

  const ActiveModal = ModalComponent ?? cachedModalComponent;

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
            className={cn(
              'w-[18px] h-[18px] shrink-0',
              wishlisted && 'fill-current'
            )}
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
              {formattedPriceLabel}
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
                        <Check
                          className="w-3.5 h-3.5 stroke-[2.5]"
                          aria-hidden="true"
                        />
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
              onPointerEnter={handlePrefetchSampleIntent}
              onTouchStart={handlePrefetchSampleIntent}
              onFocus={handlePrefetchSampleIntent}
              onClick={() =>
                openSampleReader(defaultBookSampleFormat, 'buy_card_cta')
              }
              aria-haspopup="dialog"
              aria-expanded={Boolean(inlineSampleState?.open)}
              className="ed-sample-cta inline-flex items-center justify-center gap-2 min-h-[48px] max-md:w-full px-5 max-md:px-3.5 rounded-lg border text-sm font-semibold whitespace-nowrap min-w-0"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
              >
                <span className="ed-sample-cta-sheen" />
              </span>
              <BookOpen
                className="relative z-10 w-4 h-4 shrink-0"
                aria-hidden="true"
              />
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
              <Play
                className="relative z-10 w-4 h-4 shrink-0"
                aria-hidden="true"
              />
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

      {/* Same-DOM Sample Overlay: Instant <16ms Skeleton -> Lazy Web Worker Viewer */}
      {collectionName === 'books' &&
        inlineSampleState?.open &&
        (ActiveModal ? (
          <ActiveModal
            book={{
              id,
              title,
              urlSlug,
              type,
              authorName,
              language,
              currency,
              buyPrice,
              listPrice,
              imageUrl,
              imageAlt,
              samplePdfUrl,
              sampleMarkdownUrl,
            }}
            initialFormat={inlineSampleState.format}
            selectedValidityMonths={selectedValidityMonths}
            triggerSource={inlineSampleState.triggerSource}
            onClose={closeSampleReader}
          />
        ) : (
          <SampleOverlayInstantShellSkeleton
            title={title}
            format={inlineSampleState.format}
            priceLabel={formattedPriceLabel}
            isFree={isFree}
            onClose={() => closeSampleReader('close_button')}
          />
        ))}
    </>
  );
}
