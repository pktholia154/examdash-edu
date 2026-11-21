'use client';

import React from 'react';
import { ExternalLink, Zap } from 'lucide-react';
import type { PublicBookDTO } from '../../../lib/types/catalog';
import {
  computeDiscountPercent,
  formatPrice,
  makeCompositeKey,
} from '../../../lib/registry/content-type-registry';
import { useAuth } from '../../auth/auth-provider';
import { useCart } from '../../cart/cart-provider';

/**
 * End-of-Sample Unlock Card wired directly to Buy Now & Library Entitlement sync.
 */
export function SampleUnlockCard({
  book,
  formatLabel,
  onUnlocked,
}: {
  book: PublicBookDTO;
  formatLabel: 'PDF' | 'Markdown';
  onUnlocked?: () => void;
}) {
  const { ownedCompositeKeys } = useAuth();
  const { buyNow, isCheckingOut } = useCart();

  const compositeKey = makeCompositeKey('books', book.id);
  const isOwned = ownedCompositeKeys.has(compositeKey);
  const isFree = book.buyPrice === 0;
  const discountPct = computeDiscountPercent(book.listPrice, book.buyPrice);
  const savings = Math.max(0, book.listPrice - book.buyPrice);

  const handleBuyUnlock = async () => {
    const ok = await buyNow(book, { redirectToPurchased: true });
    if (ok) {
      onUnlocked?.();
    }
  };

  if (isOwned) {
    return (
      <div className="my-6 mx-auto max-w-2xl rounded-xl border border-[var(--reader-border-strong,var(--border-strong))] bg-[var(--reader-surface,var(--bg-surface))] p-6 text-center">
        <p className="text-xs font-medium text-[var(--reader-muted,var(--text-muted))]">
          Library Entitlement Active
        </p>
        <h3 className="mt-1 text-base font-bold text-[var(--reader-ink,var(--text-main))]">
          You own the Full {formatLabel} Edition of {book.title}
        </h3>
        <a
          href="/purchased"
          className="mt-4 inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--status-success)] text-white text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          <span>Open in Purchased Library →</span>
          <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
        </a>
      </div>
    );
  }

  return (
    <div className="my-8 mx-auto max-w-2xl rounded-xl border border-[var(--reader-border-strong,var(--border-strong))] bg-[var(--reader-surface,var(--bg-surface))] p-6 sm:p-7">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[var(--reader-muted,var(--text-muted))]">
            End of Free Sample · {book.type} · {book.language}
          </p>
          <h3 className="mt-1 text-lg font-extrabold text-[var(--reader-ink,var(--text-main))] text-balance">
            Unlock Full Book: {book.title}
          </h3>
          <p className="mt-1.5 text-sm text-[var(--reader-muted,var(--text-muted))]">
            Access full-length PDF and reflowable Markdown editions with offline study vault in your Purchased Library.
          </p>

          <div className="mt-3 flex flex-wrap items-baseline gap-2.5 tabular-nums">
            <span className="text-xl font-extrabold text-[var(--reader-ink,var(--text-main))]">
              {isFree ? 'Free' : formatPrice(book.buyPrice, book.currency)}
            </span>
            {discountPct > 0 && (
              <span className="text-sm text-[var(--reader-muted,var(--text-muted))] line-through">
                {formatPrice(book.listPrice, book.currency)}
              </span>
            )}
            {discountPct > 0 && (
              <span className="text-xs font-semibold text-[var(--status-success)]">
                {discountPct}% OFF · Save {formatPrice(savings, book.currency)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:items-end shrink-0">
          <button
            type="button"
            disabled={isCheckingOut}
            onClick={() => void handleBuyUnlock()}
            className="inline-flex items-center justify-center gap-2 min-h-[48px] px-6 rounded-lg bg-[var(--reader-accent,var(--brand-primary))] text-[var(--reader-accent-ink,var(--brand-primary-ink))] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
          >
            <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {isCheckingOut
                ? 'Processing...'
                : isFree
                ? 'Claim Free'
                : 'Buy Now'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
