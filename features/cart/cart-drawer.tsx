'use client';

import React, { useEffect } from 'react';
import { ArrowRight, ShoppingBag, Trash2, X } from 'lucide-react';
import { MonogramThumbnail } from '../../components/ui/monogram-thumbnail';
import { formatPrice } from '../../lib/registry/content-type-registry';
import { useCart } from './cart-provider';
import { useAuth } from '../auth/auth-provider';

export function CartDrawer() {
  const {
    items,
    summary,
    isOpen,
    isCheckingOut,
    closeCart,
    removeItem,
    clearCart,
    checkout,
  } = useCart();
  const { user } = useAuth();

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeCart();
      }
    };
    document.body.classList.add('overflow-hidden');
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('overflow-hidden');
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeCart, isOpen]);

  if (!isOpen) return null;

  const activeCurrency = summary.currency || 'INR';

  return (
    <div
      data-nosnippet=""
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Shopping cart"
    >
      {/* Fixed Backdrop */}
      <button
        type="button"
        aria-label="Close cart drawer"
        onClick={closeCart}
        className="fixed inset-0 h-[100lvh] bg-slate-950/45 backdrop-blur-[2px] transition-opacity"
      />

      {/* Slide-over Panel */}
      <aside className="relative z-10 flex flex-col w-full max-w-md h-[100dvh] bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] shadow-[var(--shadow-drawer)]">
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="w-5 h-5 text-[var(--text-main)]" aria-hidden="true" />
            <h2 className="text-base font-bold text-[var(--text-main)]">
              Your Cart ({summary.itemCount})
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                type="button"
                onClick={clearCart}
                className="min-h-[40px] px-2.5 rounded-md text-xs font-medium text-[var(--text-muted)] hover:text-[var(--status-danger)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0"
              >
                Clear all
              </button>
            )}
            <button
              type="button"
              aria-label="Close cart"
              onClick={closeCart}
              className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Cart Items Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16">
              <div className="w-12 h-12 rounded-xl bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-muted)] mb-4">
                <ShoppingBag className="w-6 h-6" aria-hidden="true" />
              </div>
              <p className="text-base font-semibold text-[var(--text-main)]">
                Your study cart is empty
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)] max-w-xs">
                Browse curated ebooks, question banks, and full-length mock exam series to get started.
              </p>
              <button
                type="button"
                onClick={closeCart}
                className="mt-6 min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
              >
                Continue Exploring
              </button>
            </div>
          ) : (
            items.map((item) => {
              const detailHref =
                item.collectionName === 'books'
                  ? `/books/${item.urlSlug}`
                  : `/exams/${item.urlSlug}`;
              const itemSaved = Math.max(0, item.listPrice - item.buyPrice);

              return (
                <div
                  key={item.compositeKey}
                  className="flex items-start gap-3.5 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5"
                >
                  <a href={detailHref} onClick={closeCart} className="shrink-0">
                    <MonogramThumbnail
                      title={item.title}
                      type={item.type}
                      collectionName={item.collectionName}
                      size="sm"
                      showBadge={false}
                    />
                  </a>

                  <div className="flex-1 min-w-0">
                    <a
                      href={detailHref}
                      onClick={closeCart}
                      className="text-sm font-semibold text-[var(--text-main)] hover:underline line-clamp-2"
                    >
                      {item.title}
                    </a>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)] truncate">
                      {item.authorName} · {item.language}
                    </p>
                    <div className="mt-2 flex items-baseline gap-2 tabular-nums">
                      <span className="text-sm font-bold text-[var(--text-main)]">
                        {item.buyPrice === 0
                          ? 'Free'
                          : formatPrice(item.buyPrice, item.currency)}
                      </span>
                      {itemSaved > 0 && (
                        <span className="text-xs text-[var(--text-muted)] line-through">
                          {formatPrice(item.listPrice, item.currency)}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label={`Remove ${item.title} from cart`}
                    onClick={() => removeItem(item.compositeKey)}
                    className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:text-[var(--status-danger)] hover:bg-[var(--bg-surface)] transition-colors shrink-0"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Sticky Checkout Footer */}
        {items.length > 0 && (
          <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-5 pb-[calc(1.25rem+var(--safe-area-inset-bottom))] space-y-3">
            <div className="space-y-1.5 text-sm tabular-nums">
              <div className="flex items-center justify-between text-[var(--text-muted)]">
                <span>List Total ({activeCurrency})</span>
                <span>{formatPrice(summary.listTotal, activeCurrency)}</span>
              </div>
              {summary.totalSavings > 0 && (
                <div className="flex items-center justify-between font-medium text-[var(--status-success)]">
                  <span>Instant Savings</span>
                  <span>−{formatPrice(summary.totalSavings, activeCurrency)}</span>
                </div>
              )}
              <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-base font-bold text-[var(--text-main)]">
                <span>Payable Total</span>
                <span>{formatPrice(summary.buyTotal, activeCurrency)}</span>
              </div>
            </div>

            <button
              type="button"
              disabled={isCheckingOut || summary.hasCurrencyConflict}
              onClick={() => void checkout()}
              className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
            >
              <span>
                {isCheckingOut
                  ? 'Processing Payment...'
                  : summary.buyTotal === 0
                  ? user
                    ? 'Claim Free Resources'
                    : 'Sign in & Claim Free'
                  : user
                  ? `Pay with Razorpay · ${formatPrice(summary.buyTotal, activeCurrency)}`
                  : `Sign in & Pay · ${formatPrice(summary.buyTotal, activeCurrency)}`}
              </span>
              <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
            </button>
            {summary.buyTotal > 0 && (
              <p className="text-center text-[11px] text-[var(--text-muted)]">
                Secured by Razorpay · Verified purchases unlock immediately in your Library
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
