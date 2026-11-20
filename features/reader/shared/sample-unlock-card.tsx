'use client';

import React from 'react';
import { Check, LockOpen, ShoppingBag, Sparkles, Zap } from 'lucide-react';
import type { PublicBookDTO } from '../../../lib/types/catalog';
import {
  computeDiscountPercent,
  formatPrice,
  makeCompositeKey,
  makeFirestoreSafeCartKey,
} from '../../../lib/registry/content-type-registry';
import { useAuth } from '../../auth/auth-provider';
import { useCart } from '../../cart/cart-provider';
import { useToast } from '../../toast/toast-context';

/**
 * Store-Safe End-of-Sample Unlock Card wired to ExamDash CheckoutAdapter
 * (Web Checkout / Cart & Entitlement sync).
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
  const { ownedCompositeKeys, recordCompletedPurchases } = useAuth();
  const { isInCart, addItem, openCart, claimFreeItem, isCheckingOut } = useCart();
  const { showToast } = useToast();

  const compositeKey = makeCompositeKey('books', book.id);
  const isOwned = book.buyPrice === 0 || ownedCompositeKeys.has(compositeKey);
  const inCart = isInCart(compositeKey);
  const isFree = book.buyPrice === 0;
  const discountPct = computeDiscountPercent(book.listPrice, book.buyPrice);
  const savings = Math.max(0, book.listPrice - book.buyPrice);

  const handleInstantUnlock = async () => {
    if (isFree) {
      await claimFreeItem(book);
      onUnlocked?.();
      return;
    }
    const ok = await recordCompletedPurchases([
      {
        compositeKey,
        firestoreKey: makeFirestoreSafeCartKey('books', book.id),
        id: book.id,
        collectionName: 'books',
        urlSlug: book.urlSlug,
        title: book.title,
        authorName: book.authorName,
        language: book.language,
        type: book.type,
        currency: (book.currency || 'INR').toUpperCase(),
        listPrice: book.listPrice,
        buyPrice: book.buyPrice,
      },
    ]);
    if (ok) {
      showToast(`Unlocked full edition of "${book.title}"!`, 'success');
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
        {onUnlocked ? (
          <button
            type="button"
            onClick={onUnlocked}
            className="mt-4 inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--status-success)] text-white text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            <LockOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Switch to Full {formatLabel} Edition</span>
          </button>
        ) : (
          <a
            href={`/read/${book.urlSlug}?mode=full&format=${formatLabel.toLowerCase()}`}
            className="mt-4 inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--status-success)] text-white text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            <LockOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Open Full {formatLabel} Edition</span>
          </a>
        )}
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
            Get complete access to both full-length PDF and reflowable Markdown editions, offline study vault, and lifetime library sync.
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

        <div className="flex flex-col sm:items-end gap-2.5 shrink-0">
          {isFree ? (
            <button
              type="button"
              disabled={isCheckingOut}
              onClick={() => void handleInstantUnlock()}
              className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--reader-accent,var(--brand-primary))] text-[var(--reader-accent-ink,var(--brand-primary-ink))] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Claim Free Book</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={isCheckingOut}
                onClick={() => void handleInstantUnlock()}
                className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--reader-accent,var(--brand-primary))] text-[var(--reader-accent-ink,var(--brand-primary-ink))] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
              >
                <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Unlock Full Book</span>
              </button>

              {inCart ? (
                <button
                  type="button"
                  onClick={openCart}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg border border-[var(--reader-border-strong,var(--border-strong))] bg-transparent text-[var(--reader-ink,var(--text-main))] text-xs font-semibold hover:opacity-80 transition-opacity whitespace-nowrap"
                >
                  <Check className="w-4 h-4 text-[var(--status-success)] shrink-0" aria-hidden="true" />
                  <span>View in Cart</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => addItem(book)}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg border border-[var(--reader-border-strong,var(--border-strong))] bg-transparent text-[var(--reader-ink,var(--text-main))] text-xs font-semibold hover:opacity-80 transition-opacity whitespace-nowrap"
                >
                  <ShoppingBag className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Add to Cart</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
