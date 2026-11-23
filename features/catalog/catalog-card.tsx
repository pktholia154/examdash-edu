'use client';

import React from 'react';
import {
  Check,
  ExternalLink,
  Heart,
  ShoppingCart,
  Sparkles,
  Star,
} from 'lucide-react';
import { CatalogThumbnail } from '../../components/ui/catalog-thumbnail';
import type {
  CatalogCardDTO,
  CatalogItemDTO,
  ViewMode,
  WishlistItem,
} from '../../lib/types/catalog';
import {
  computeDiscountPercent,
  formatPrice,
  makeCompositeKey,
} from '../../lib/registry/content-type-registry';
import { useAuth } from '../auth/auth-provider';
import { useCart } from '../cart/cart-provider';
import { useWishlist } from '../wishlist/wishlist-provider';
import { cn } from '../../lib/utils';

export interface CatalogCardProps {
  item: CatalogCardDTO | CatalogItemDTO | WishlistItem;
  viewMode?: ViewMode;
}

export function CatalogCard({ item }: CatalogCardProps) {
  const { ownedCompositeKeys } = useAuth();
  const { isInCart, addItem, openCart, claimFreeItem, isCheckingOut } = useCart();
  const { isWishlisted, toggleWishlist } = useWishlist();

  const compositeKey = makeCompositeKey(item.collectionName, item.id);
  const isOwned = ownedCompositeKeys.has(compositeKey);
  const inCart = isInCart(compositeKey);
  const wishlisted = isWishlisted(compositeKey);
  const isFree = item.buyPrice === 0;
  const discountPct = computeDiscountPercent(item.listPrice, item.buyPrice);

  const cardReviewCount =
    'reviewCount' in item && typeof item.reviewCount === 'number'
      ? item.reviewCount
      : 0;
  const cardAvgRating =
    'averageRating' in item && typeof item.averageRating === 'number'
      ? item.averageRating
      : 0;
  const hasRealRating = cardReviewCount > 0 && cardAvgRating >= 1;

  const totalMocktest =
    'totalMocktest' in item && typeof item.totalMocktest === 'number'
      ? item.totalMocktest
      : undefined;

  const tags =
    'tags' in item && Array.isArray(item.tags) ? item.tags : [];

  const imageUrl =
    'imageUrl' in item && typeof item.imageUrl === 'string'
      ? item.imageUrl
      : undefined;
  const imageMeta =
    'imageMeta' in item ? item.imageMeta : undefined;
  const imageAlt =
    'imageAlt' in item && typeof item.imageAlt === 'string'
      ? item.imageAlt
      : imageMeta?.alt;
  const imageTitle =
    'imageTitle' in item && typeof item.imageTitle === 'string'
      ? item.imageTitle
      : imageMeta?.title;

  const detailHref =
    item.collectionName === 'books'
      ? `/books/${item.urlSlug}`
      : `/exams/${item.urlSlug}`;

  const openSlotHref =
    item.collectionName === 'books'
      ? `/read/${item.urlSlug}`
      : `/attempt/${item.urlSlug}`;

  const handleCartCornerClick = () => {
    if (isFree) {
      void claimFreeItem(item);
      return;
    }
    if (inCart) {
      openCart();
      return;
    }
    addItem(item);
  };

  return (
    <article className="flex flex-row items-center gap-3.5 sm:gap-4 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:p-4 hover:border-[var(--border-strong)] transition-colors max-md:items-start max-md:gap-3 max-md:p-2.5">
      {/* Left 4:3 Portrait Thumbnail with Bottom-Left Wishlist & Bottom-Right Cart Circular Icons */}
      <div className="relative shrink-0 w-[84px] h-[112px] md:w-[90px] md:h-[120px]">
        <a
          href={detailHref}
          aria-label={`View ${item.title}`}
          className="block w-full h-full rounded-[var(--radius-thumb)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
        >
          <CatalogThumbnail
            title={item.title}
            collectionName={item.collectionName}
            imageUrl={imageUrl}
            imageMeta={imageMeta}
            imageAlt={imageAlt}
            imageTitle={imageTitle}
            size="list"
            className="w-full h-full"
          />
        </a>

        {/* Bottom-Left Circular Wishlist Icon */}
        <button
          type="button"
          aria-label={
            wishlisted
              ? `Remove ${item.title} from wishlist`
              : `Add ${item.title} to wishlist`
          }
          aria-pressed={wishlisted}
          onClick={() => toggleWishlist(item)}
          className={cn(
            'absolute bottom-1.5 left-1.5 z-10 w-[26px] h-[26px] rounded-full inline-flex items-center justify-center border shadow-sm transition-colors before:content-[""] before:absolute before:-inset-1.5',
            wishlisted
              ? 'border-[var(--status-wishlist)] bg-[var(--status-wishlist-bg)] text-[var(--status-wishlist)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 text-[var(--text-muted)] hover:text-[var(--status-wishlist)] hover:border-[var(--border-strong)]'
          )}
        >
          <Heart
            className={cn(
              'w-[13px] h-[13px] shrink-0',
              wishlisted && 'fill-current'
            )}
            aria-hidden="true"
          />
        </button>

        {/* Bottom-Right Circular Add to Cart / Claim / Open Icon */}
        {isOwned ? (
          <a
            href={openSlotHref}
            rel="nofollow"
            aria-label={`Open ${item.title} in Library`}
            title="Open in Library"
            className="absolute bottom-1.5 right-1.5 z-10 w-[26px] h-[26px] rounded-full inline-flex items-center justify-center border border-[var(--status-success)] bg-[var(--status-success)] text-white hover:opacity-90 transition-opacity before:content-[''] before:absolute before:-inset-1.5"
          >
            <ExternalLink className="w-[13px] h-[13px] shrink-0" aria-hidden="true" />
          </a>
        ) : (
          <button
            type="button"
            disabled={isFree && isCheckingOut}
            aria-label={
              isFree
                ? `Claim free resource ${item.title}`
                : inCart
                ? `${item.title} is in cart. View cart`
                : `Add ${item.title} to cart`
            }
            aria-pressed={inCart}
            title={
              isFree
                ? 'Claim Free'
                : inCart
                ? 'In Cart — View Cart'
                : 'Add to Cart'
            }
            onClick={handleCartCornerClick}
            className={cn(
              'absolute bottom-1.5 right-1.5 z-10 w-[26px] h-[26px] rounded-full inline-flex items-center justify-center border transition-colors disabled:opacity-50 before:content-[""] before:absolute before:-inset-1.5',
              inCart
                ? 'border-[var(--status-success)] bg-[var(--status-success-bg)] text-[var(--status-success)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-ink)] hover:border-[var(--brand-primary)]'
            )}
          >
            {isFree ? (
              <Sparkles className="w-[13px] h-[13px] shrink-0" aria-hidden="true" />
            ) : inCart ? (
              <Check className="w-[13px] h-[13px] shrink-0" aria-hidden="true" />
            ) : (
              <ShoppingCart className="w-[13px] h-[13px] shrink-0" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {/* Center Content & Metadata */}
      <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm sm:text-base font-bold text-[var(--text-main)] leading-snug line-clamp-2">
            <a
              href={detailHref}
              className="hover:underline underline-offset-4"
            >
              {item.title}
            </a>
          </h3>

          {/* Unboxed Clean Metadata (Zero-Pill Discipline) */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-muted)]">
            <span className="truncate max-w-[160px] max-md:max-w-[125px]">{item.authorName}</span>
            <span aria-hidden="true">·</span>
            <span>{item.language}</span>
            <span aria-hidden="true">·</span>
            <span>{item.type}</span>
            {item.collectionName === 'ExamPackDocument' &&
              typeof totalMocktest === 'number' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {totalMocktest} Mock {totalMocktest === 1 ? 'Test' : 'Tests'}
                  </span>
                </>
              )}
            {hasRealRating && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 font-semibold text-[var(--text-main)] tabular-nums">
                  <Star
                    className="w-3.5 h-3.5 fill-[var(--status-warning)] text-[var(--status-warning)] shrink-0"
                    aria-hidden="true"
                  />
                  <span>{cardAvgRating.toFixed(1)}</span>
                  <span className="font-normal text-[var(--text-muted)]">
                    ({cardReviewCount})
                  </span>
                </span>
              </>
            )}
          </div>

          {tags.length > 0 && (
            <p className="mt-1 hidden sm:block text-xs text-[var(--text-muted)] truncate">
              {tags.slice(0, 4).join(' · ')}
            </p>
          )}
        </div>

        {/* Right Price & Subtle Owned Indicator */}
        <div className="flex sm:flex-col items-baseline sm:items-end justify-between sm:justify-center gap-2 sm:gap-0.5 shrink-0 tabular-nums">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm sm:text-base font-extrabold text-[var(--text-main)]">
              {isFree ? 'Free' : formatPrice(item.buyPrice, item.currency)}
            </span>
            {discountPct > 0 && (
              <span className="text-xs text-[var(--text-muted)] line-through">
                {formatPrice(item.listPrice, item.currency)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {discountPct > 0 && (
              <span className="text-[11px] font-semibold text-[var(--status-success)] whitespace-nowrap">
                {discountPct}% OFF
              </span>
            )}
            {isOwned && (
              <a
                href={openSlotHref}
                rel="nofollow"
                className="text-xs font-semibold text-[var(--status-success)] hover:underline underline-offset-4 whitespace-nowrap max-md:min-h-[44px] max-md:inline-flex max-md:items-center"
              >
                Open →
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
