'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  ShoppingCart,
  Sparkles,
  Star,
} from 'lucide-react';
import { CatalogThumbnail } from '../../components/ui/catalog-thumbnail';
import type { CatalogCardDTO } from '../../lib/types/catalog';
import {
  computeDiscountPercent,
  formatPrice,
  makeCompositeKey,
} from '../../lib/registry/content-type-registry';
import { useAuth } from '../auth/auth-provider';
import { useCart } from '../cart/cart-provider';
import { useWishlist } from '../wishlist/wishlist-provider';
import { cn } from '../../lib/utils';

export interface BookCarouselSectionProps {
  id: string;
  heading: string;
  subheading?: string;
  items: CatalogCardDTO[];
  viewAllHref?: string;
  viewAllLabel?: string;
  prioritizeFirstCount?: number;
}

interface CarouselBookCardProps {
  item: CatalogCardDTO;
  priority?: boolean;
}

function CarouselBookCard({ item, priority = false }: CarouselBookCardProps) {
  const { ownedCompositeKeys } = useAuth();
  const { isInCart, addItem, openCart, claimFreeItem, isCheckingOut } =
    useCart();
  const { isWishlisted, toggleWishlist } = useWishlist();

  const compositeKey = makeCompositeKey(item.collectionName, item.id);
  const isOwned = ownedCompositeKeys.has(compositeKey);
  const inCart = isInCart(compositeKey);
  const wishlisted = isWishlisted(compositeKey);
  const isFree = item.buyPrice === 0;
  const discountPct = computeDiscountPercent(item.listPrice, item.buyPrice);

  const hasRealRating =
    typeof item.reviewCount === 'number' &&
    item.reviewCount > 0 &&
    typeof item.averageRating === 'number' &&
    item.averageRating >= 1;

  const hasRealSoldCount =
    typeof item.soldCount === 'number' && item.soldCount > 0;

  const detailHref =
    item.collectionName === 'books'
      ? `/books/${item.urlSlug}`
      : `/exams/${item.urlSlug}`;

  const openSlotHref =
    item.collectionName === 'books'
      ? `/read/${item.urlSlug}`
      : `/attempt/${item.urlSlug}`;

  const subtitleLabel = item.tags[0] || item.authorName;

  const handleCartClick = () => {
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
    <article className="ed-carousel-item group/card flex flex-col">
      {/* 4:3 Portrait Book Cover with Top-Right Wishlist & Bottom-Right Action Controls */}
      <div className="relative w-full aspect-[3/4] transition-transform duration-150 ease-out group-hover/card:-translate-y-0.5">
        <a
          href={detailHref}
          aria-label={`View ${item.title}`}
          className="block w-full h-full rounded-[var(--radius-thumb)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
        >
          <CatalogThumbnail
            title={item.title}
            collectionName={item.collectionName}
            imageUrl={item.imageUrl}
            imageAlt={item.imageAlt}
            imageTitle={item.imageTitle}
            size="card"
            priority={priority}
            className="w-full h-full group-hover/card:border-[var(--border-strong)] transition-colors"
          />
        </a>

        {/* Top-Right Circular Wishlist Button */}
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
            'absolute top-1.5 right-1.5 z-10 w-6 h-6 sm:w-7 sm:h-7 rounded-full inline-flex items-center justify-center border transition-colors before:content-[""] before:absolute before:-inset-2',
            wishlisted
              ? 'border-[var(--status-wishlist)] bg-[var(--status-wishlist-bg)] text-[var(--status-wishlist)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 text-[var(--text-muted)] hover:text-[var(--status-wishlist)] hover:border-[var(--border-strong)]'
          )}
        >
          <Heart
            className={cn(
              'w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0',
              wishlisted && 'fill-current'
            )}
            aria-hidden="true"
          />
        </button>

        {/* Bottom-Right Circular Owned / Cart / Claim Button */}
        {isOwned ? (
          <a
            href={openSlotHref}
            rel="nofollow"
            aria-label={`Open ${item.title} in Library`}
            title="Owned — Open in Library"
            className="absolute bottom-1.5 right-1.5 z-10 w-6 h-6 sm:w-7 sm:h-7 rounded-full inline-flex items-center justify-center border border-[var(--status-success)] bg-[var(--status-success)] text-white hover:opacity-90 transition-opacity before:content-[''] before:absolute before:-inset-2"
          >
            <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" aria-hidden="true" />
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
            onClick={handleCartClick}
            className={cn(
              'absolute bottom-1.5 right-1.5 z-10 w-6 h-6 sm:w-7 sm:h-7 rounded-full inline-flex items-center justify-center border transition-colors disabled:opacity-50 before:content-[""] before:absolute before:-inset-2',
              inCart
                ? 'border-[var(--status-success)] bg-[var(--status-success-bg)] text-[var(--status-success)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 text-[var(--text-main)] hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-ink)] hover:border-[var(--brand-primary)]'
            )}
          >
            {isFree ? (
              <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" aria-hidden="true" />
            ) : inCart ? (
              <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <ShoppingCart className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {/* Compact Editorial Metadata Stack (Zero-Pill Discipline) */}
      <div className="mt-2 flex flex-col gap-0.5 min-w-0">
        {/* Price + MRP + Discount */}
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 tabular-nums leading-tight">
          <span className="text-[13px] sm:text-sm font-extrabold text-[var(--text-main)]">
            {isFree ? 'Free' : formatPrice(item.buyPrice, item.currency)}
          </span>
          {discountPct > 0 && (
            <span className="text-[10.5px] sm:text-xs text-[var(--text-muted)] line-through">
              {formatPrice(item.listPrice, item.currency)}
            </span>
          )}
          {discountPct > 0 && (
            <span className="text-[10.5px] sm:text-[11px] font-semibold text-[var(--status-success)] whitespace-nowrap">
              {discountPct}% OFF
            </span>
          )}
        </div>

        {/* Book Title */}
        <h3 className="mt-0.5 text-xs sm:text-[13px] font-bold text-[var(--text-main)] leading-snug line-clamp-2 min-h-[2.6em]">
          <a
            href={detailHref}
            className="hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] rounded-xs"
          >
            {item.title}
          </a>
        </h3>

        {/* Primary Category / Author */}
        <p className="text-[11px] text-[var(--text-muted)] truncate leading-snug">
          {subtitleLabel}
        </p>

        {/* Bottom Metadata Row: Language · Type + Optional Real Rating / Sold Count */}
        <div className="mt-0.5 flex items-center justify-between gap-1.5 text-[10.5px] sm:text-[11px] text-[var(--text-muted)] leading-snug">
          <span className="truncate min-w-0">
            {item.language}
            {item.type ? ` · ${item.type}` : ''}
          </span>

          {hasRealRating ? (
            <span className="inline-flex items-center gap-0.5 shrink-0 font-semibold text-[var(--text-main)] tabular-nums">
              <Star
                className="w-2.5 h-2.5 sm:w-3 sm:h-3 fill-[var(--status-warning)] text-[var(--status-warning)] shrink-0"
                aria-hidden="true"
              />
              <span>{item.averageRating!.toFixed(1)}</span>
            </span>
          ) : hasRealSoldCount ? (
            <span className="shrink-0 font-medium text-[var(--text-muted)] tabular-nums whitespace-nowrap">
              {item.soldCount} sold
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function BookCarouselSection({
  id,
  heading,
  subheading,
  items,
  viewAllHref = '/books',
  viewAllLabel = 'All Books',
  prioritizeFirstCount = 0,
}: BookCarouselSectionProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [scrollState, setScrollState] = useState({
    canPrev: false,
    canNext: false,
  });

  const syncScrollState = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const nextCanPrev = el.scrollLeft > 4;
    const nextCanNext = maxScroll > 4 && el.scrollLeft < maxScroll - 4;
    setScrollState((prev) =>
      prev.canPrev === nextCanPrev && prev.canNext === nextCanNext
        ? prev
        : { canPrev: nextCanPrev, canNext: nextCanNext }
    );
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    syncScrollState();

    const onScroll = () => syncScrollState();
    el.addEventListener('scroll', onScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => syncScrollState());
      resizeObserver.observe(el);
    } else {
      window.addEventListener('resize', onScroll, { passive: true });
    }

    return () => {
      el.removeEventListener('scroll', onScroll);
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', onScroll);
      }
    };
  }, [syncScrollState, items.length]);

  const scrollByPage = (direction: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = Math.max(200, Math.round(el.clientWidth * 0.78));
    el.scrollBy({
      left: direction * step,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  };

  if (!items || items.length === 0) {
    return null;
  }

  const headingId = `${id}-heading`;
  const isScrollable = scrollState.canPrev || scrollState.canNext;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      aria-roledescription="carousel"
      className="ed-container py-6 sm:py-7 max-md:py-4"
    >
      {/* Section Header with Single-Tap Scroll Controls (WCAG 2.2 AA SC 2.5.7) */}
      <div className="flex items-end justify-between gap-3 pb-3.5 max-md:pb-2.5 border-b border-[var(--border-subtle)]">
        <div className="min-w-0">
          <h2
            id={headingId}
            className="text-[length:var(--text-h2)] font-extrabold tracking-tight text-[var(--text-main)]"
          >
            {heading}
          </h2>
          {subheading && (
            <p className="mt-0.5 text-xs sm:text-sm text-[var(--text-muted)]">
              {subheading}
            </p>
          )}
        </div>

        <div
          data-nosnippet=""
          className="flex items-center gap-2 sm:gap-3 shrink-0"
        >
          {isScrollable && (
            <div
              role="group"
              aria-label={`Scroll ${heading}`}
              className="hidden sm:inline-flex items-center gap-1.5"
            >
              <button
                type="button"
                onClick={() => scrollByPage(-1)}
                disabled={!scrollState.canPrev}
                aria-label={`Scroll ${heading} left`}
                className="w-9 h-9 rounded-full inline-flex items-center justify-center border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => scrollByPage(1)}
                disabled={!scrollState.canNext}
                aria-label={`Scroll ${heading} right`}
                className="w-9 h-9 rounded-full inline-flex items-center justify-center border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4 shrink-0" aria-hidden="true" />
              </button>
            </div>
          )}

          {viewAllHref && viewAllLabel && (
            <a
              href={viewAllHref}
              className="text-xs sm:text-sm font-semibold text-[var(--text-main)] hover:underline underline-offset-4 whitespace-nowrap shrink-0 max-md:min-h-[44px] max-md:-my-2 max-md:inline-flex max-md:items-center"
            >
              {viewAllLabel} →
            </a>
          )}
        </div>
      </div>

      {/* Horizontal Scroll Track */}
      <div className="relative mt-4 max-md:mt-3">
        <div
          ref={trackRef}
          tabIndex={0}
          aria-label={`${heading} book list`}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              scrollByPage(1);
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault();
              scrollByPage(-1);
            }
          }}
          className="ed-carousel-track focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] rounded-[var(--radius-thumb)]"
        >
          {items.map((item, idx) => (
            <CarouselBookCard
              key={`${id}-${item.collectionName}:${item.id}`}
              item={item}
              priority={idx < prioritizeFirstCount}
            />
          ))}
        </div>

        {/* Subtle Right-Edge Fade Hint When More Books Exist Off-Screen */}
        {scrollState.canNext && (
          <div
            aria-hidden="true"
            className="ed-carousel-fade-end pointer-events-none absolute inset-y-0 right-0 w-7 sm:w-10"
          />
        )}
      </div>
    </section>
  );
}
