'use client';

import React from 'react';
import { Check, ExternalLink, Plus, Sparkles } from 'lucide-react';
import { MonogramThumbnail } from '../../components/ui/monogram-thumbnail';
import type {
  CatalogCardDTO,
  CatalogItemDTO,
  ViewMode,
} from '../../lib/types/catalog';
import {
  computeDiscountPercent,
  formatPrice,
  makeCompositeKey,
} from '../../lib/registry/content-type-registry';
import { useAuth } from '../auth/auth-provider';
import { useCart } from '../cart/cart-provider';
import { cn } from '../../lib/utils';

export interface CatalogCardProps {
  item: CatalogCardDTO | CatalogItemDTO;
  viewMode: ViewMode;
}

export function CatalogCard({ item, viewMode }: CatalogCardProps) {
  const { ownedCompositeKeys } = useAuth();
  const { isInCart, addItem, openCart, claimFreeItem, isCheckingOut } = useCart();

  const compositeKey = makeCompositeKey(item.collectionName, item.id);
  const isOwned = ownedCompositeKeys.has(compositeKey);
  const inCart = isInCart(compositeKey);
  const isFree = item.buyPrice === 0;
  const discountPct = computeDiscountPercent(item.listPrice, item.buyPrice);

  const detailHref =
    item.collectionName === 'books'
      ? `/books/${item.urlSlug}`
      : `/exams/${item.urlSlug}`;

  const openSlotHref =
    item.collectionName === 'books'
      ? `/read/${item.urlSlug}`
      : `/attempt/${item.urlSlug}`;

  const renderStatefulCta = (compact: boolean = false) => {
    if (isOwned) {
      return (
        <a
          href={openSlotHref}
          aria-label={`Open ${item.title}`}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 min-h-[48px] rounded-lg bg-[var(--status-success)] text-white text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0',
            compact ? 'px-4' : 'px-4 w-full sm:w-auto'
          )}
        >
          <span>Open</span>
          <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        </a>
      );
    }

    if (isFree) {
      return (
        <button
          type="button"
          disabled={isCheckingOut}
          aria-label={`Claim free resource ${item.title}`}
          onClick={() => void claimFreeItem(item)}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 min-h-[48px] rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap shrink-0',
            compact ? 'px-4' : 'px-4 w-full sm:w-auto'
          )}
        >
          <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Claim Free</span>
        </button>
      );
    }

    if (inCart) {
      return (
        <button
          type="button"
          aria-label={`${item.title} is in cart. View cart`}
          onClick={openCart}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 min-h-[48px] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-main)] text-xs font-semibold hover:bg-[var(--bg-canvas)] transition-colors whitespace-nowrap shrink-0',
            compact ? 'px-4' : 'px-3.5 w-full sm:w-auto'
          )}
        >
          <Check className="w-3.5 h-3.5 text-[var(--status-success)] shrink-0" aria-hidden="true" />
          <span>In Cart</span>
        </button>
      );
    }

    return (
      <button
        type="button"
        aria-label={`Add ${item.title} to cart`}
        onClick={() => addItem(item)}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 min-h-[48px] rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0',
          compact ? 'px-4' : 'px-3.5 w-full sm:w-auto'
        )}
      >
        <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Add to Cart</span>
      </button>
    );
  };

  if (viewMode === 'list') {
    return (
      <article className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 hover:border-[var(--border-strong)] transition-colors">
        <div className="flex items-start sm:items-center gap-4 flex-1 min-w-0">
          <a href={detailHref} className="shrink-0">
            <MonogramThumbnail
              title={item.title}
              type={item.type}
              collectionName={item.collectionName}
              size="sm"
              showBadge={false}
            />
          </a>

          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-[var(--text-main)] leading-snug line-clamp-2">
              <a href={detailHref} className="hover:underline underline-offset-4">
                {item.title}
              </a>
            </h3>

            {/* Unboxed Clean Metadata (Zero-Pill Discipline) */}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-muted)]">
              <span>{item.authorName}</span>
              <span aria-hidden="true">·</span>
              <span>{item.language}</span>
              <span aria-hidden="true">·</span>
              <span>{item.type}</span>
              {item.collectionName === 'ExamPackDocument' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {item.totalMocktest} Mock {item.totalMocktest === 1 ? 'Test' : 'Tests'}
                  </span>
                </>
              )}
            </div>

            {item.tags.length > 0 && (
              <p className="mt-1 text-xs text-[var(--text-muted)] truncate">
                {item.tags.slice(0, 4).join(' · ')}
              </p>
            )}
          </div>
        </div>

        {/* Pricing + CTA End */}
        <div className="flex items-center justify-between sm:justify-end gap-4 pt-3 sm:pt-0 border-t sm:border-t-0 border-[var(--border-subtle)] shrink-0">
          <div className="text-left sm:text-right tabular-nums">
            <div className="flex items-baseline sm:justify-end gap-2">
              <span className="text-base font-extrabold text-[var(--text-main)]">
                {isFree ? 'Free' : formatPrice(item.buyPrice, item.currency)}
              </span>
              {discountPct > 0 && (
                <span className="text-xs text-[var(--text-muted)] line-through">
                  {formatPrice(item.listPrice, item.currency)}
                </span>
              )}
            </div>
            {discountPct > 0 && (
              <p className="text-xs font-semibold text-[var(--status-success)]">
                {discountPct}% OFF
              </p>
            )}
          </div>

          {renderStatefulCta(true)}
        </div>
      </article>
    );
  }

  return (
    <article className="flex flex-col rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 hover:border-[var(--border-strong)] transition-colors">
      <a href={detailHref} className="block">
        <MonogramThumbnail
          title={item.title}
          type={item.type}
          collectionName={item.collectionName}
          size="md"
        />
      </a>

      <div className="mt-3.5 flex-1 flex flex-col">
        <h3 className="text-base font-bold text-[var(--text-main)] leading-snug line-clamp-2">
          <a href={detailHref} className="hover:underline underline-offset-4">
            {item.title}
          </a>
        </h3>

        <p className="mt-1.5 text-xs text-[var(--text-muted)] truncate">
          {item.authorName} · {item.language}
          {item.collectionName === 'ExamPackDocument'
            ? ` · ${item.totalMocktest} Tests`
            : ''}
        </p>

        {/* Sticky Bottom Pricing & Stateful CTA Footer */}
        <div className="mt-auto pt-4">
          <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-2 tabular-nums">
              <div className="flex items-baseline gap-1.5">
                <span className="text-base font-extrabold text-[var(--text-main)]">
                  {isFree ? 'Free' : formatPrice(item.buyPrice, item.currency)}
                </span>
                {discountPct > 0 && (
                  <span className="text-xs text-[var(--text-muted)] line-through">
                    {formatPrice(item.listPrice, item.currency)}
                  </span>
                )}
              </div>

              {discountPct > 0 && (
                <span className="text-xs font-semibold text-[var(--status-success)] whitespace-nowrap">
                  {discountPct}% OFF
                </span>
              )}
            </div>

            {renderStatefulCta(false)}
          </div>
        </div>
      </div>
    </article>
  );
}
