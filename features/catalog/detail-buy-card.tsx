'use client';

import React from 'react';
import {
  BookOpen,
  Check,
  ExternalLink,
  FileText,
  Play,
  ShoppingBag,
  Sparkles,
  Zap,
} from 'lucide-react';
import { MonogramThumbnail } from '../../components/ui/monogram-thumbnail';
import type { CatalogItemDTO } from '../../lib/types/catalog';
import {
  computeDiscountPercent,
  formatPrice,
  makeCompositeKey,
  makeFirestoreSafeCartKey,
} from '../../lib/registry/content-type-registry';
import { useAuth } from '../auth/auth-provider';
import { useCart } from '../cart/cart-provider';
import { useToast } from '../toast/toast-context';

export function DetailBuyCard({ item }: { item: CatalogItemDTO }) {
  const { ownedCompositeKeys, recordCompletedPurchases } = useAuth();
  const { isInCart, addItem, openCart, claimFreeItem, isCheckingOut } = useCart();
  const { showToast } = useToast();

  const compositeKey = makeCompositeKey(item.collectionName, item.id);
  const isOwned = ownedCompositeKeys.has(compositeKey);
  const inCart = isInCart(compositeKey);
  const isFree = item.buyPrice === 0;
  const discountPct = computeDiscountPercent(item.listPrice, item.buyPrice);
  const savingsAmount = Math.max(0, item.listPrice - item.buyPrice);

  const openHref =
    item.collectionName === 'books'
      ? `/read/${item.urlSlug}`
      : `/attempt/${item.urlSlug}`;

  const handleInstantBuy = async () => {
    if (isFree) {
      await claimFreeItem(item);
      return;
    }
    const ok = await recordCompletedPurchases([
      {
        compositeKey,
        firestoreKey: makeFirestoreSafeCartKey(item.collectionName, item.id),
        id: item.id,
        collectionName: item.collectionName,
        urlSlug: item.urlSlug,
        title: item.title,
        authorName: item.authorName,
        language: item.language,
        type: item.type,
        currency: (item.currency || 'INR').toUpperCase(),
        listPrice: item.listPrice,
        buyPrice: item.buyPrice,
        ...(item.collectionName === 'ExamPackDocument'
          ? { totalMocktest: item.totalMocktest }
          : {}),
      },
    ]);
    if (ok) {
      showToast(`Unlocked "${item.title}" in your Library!`, 'success');
    }
  };

  return (
    <>
      {/* Desktop & Tablet Sticky 360px SaaS Purchase Card */}
      <aside aria-label="Purchase and sample options" className="w-full lg:w-[360px] shrink-0">
        <div className="lg:sticky lg:top-24 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 space-y-5">
          <div className="flex items-center gap-4">
            <MonogramThumbnail
              title={item.title}
              type={item.type}
              collectionName={item.collectionName}
              size="sm"
              showBadge={false}
              className="w-20 h-20"
            />
            <div className="min-w-0">
              <p className="text-xs font-medium text-[var(--text-muted)]">
                {item.type} · {item.language}
              </p>
              <div className="mt-1 flex items-baseline gap-2 tabular-nums">
                <span className="text-2xl font-extrabold text-[var(--text-main)]">
                  {isFree ? 'Free' : formatPrice(item.buyPrice, item.currency)}
                </span>
                {discountPct > 0 && (
                  <span className="text-sm text-[var(--text-muted)] line-through">
                    {formatPrice(item.listPrice, item.currency)}
                  </span>
                )}
              </div>
              {discountPct > 0 && (
                <p className="mt-0.5 text-xs font-semibold text-[var(--status-success)] tabular-nums">
                  {discountPct}% OFF · Save {formatPrice(savingsAmount, item.currency)}
                </p>
              )}
            </div>
          </div>

          {/* Primary & Secondary Action Stack */}
          <div className="space-y-2.5">
            {isOwned ? (
              <a
                href={openHref}
                className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--status-success)] text-white text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                <span>
                  {item.collectionName === 'books' ? 'Open in Reader' : 'Start Mock Exam'}
                </span>
                <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
              </a>
            ) : isFree ? (
              <button
                type="button"
                disabled={isCheckingOut}
                onClick={() => void claimFreeItem(item)}
                className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Claim Free Access</span>
              </button>
            ) : (
              <>
                {inCart ? (
                  <button
                    type="button"
                    onClick={openCart}
                    className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-main)] text-sm font-semibold hover:bg-[var(--bg-canvas)] transition-colors whitespace-nowrap"
                  >
                    <Check
                      className="w-4 h-4 text-[var(--status-success)] shrink-0"
                      aria-hidden="true"
                    />
                    <span>In Cart · View Drawer</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => addItem(item)}
                    className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                  >
                    <ShoppingBag className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Add to Cart</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={isCheckingOut}
                  onClick={() => void handleInstantBuy()}
                  className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-main)] text-sm font-semibold hover:bg-[var(--bg-elevated)] disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>
                    Instant Unlock · {formatPrice(item.buyPrice, item.currency)}
                  </span>
                </button>
              </>
            )}
          </div>

          {/* Conditional Free Sample / Trial Triggers */}
          {item.collectionName === 'books' &&
            (item.samplePdfUrl || item.sampleMarkdownUrl) && (
              <div className="pt-4 border-t border-[var(--border-subtle)] space-y-2">
                <p className="text-xs font-semibold text-[var(--text-muted)]">
                  Free Chapter Samples
                </p>
                <div className="flex flex-col gap-2">
                  {item.sampleMarkdownUrl && (
                    <a
                      href={`/read/${item.urlSlug}?mode=sample&format=markdown`}
                      className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap"
                    >
                      <BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Read Sample Markdown</span>
                    </a>
                  )}
                  {item.samplePdfUrl && (
                    <a
                      href={`/read/${item.urlSlug}?mode=sample&format=pdf`}
                      className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap"
                    >
                      <FileText className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Preview Sample PDF</span>
                    </a>
                  )}
                </div>
              </div>
            )}

          {item.collectionName === 'ExamPackDocument' &&
            item.sampleJsonStoragePath && (
              <div className="pt-4 border-t border-[var(--border-subtle)] space-y-2">
                <p className="text-xs font-semibold text-[var(--text-muted)]">
                  Free Practice Trial
                </p>
                <a
                  href={`/attempt/${item.urlSlug}?mode=trial`}
                  className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap"
                >
                  <Play className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Attempt Free Sample Mock</span>
                </a>
              </div>
            )}

          {/* Entitlement Delivery Summary */}
          <dl className="pt-4 border-t border-[var(--border-subtle)] space-y-2 text-xs text-[var(--text-muted)] gated-asset-boundary">
            <div className="flex items-center justify-between">
              <dt>Publisher</dt>
              <dd className="font-medium text-[var(--text-main)] truncate max-w-[180px]">
                {item.publisher}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Language</dt>
              <dd className="font-medium text-[var(--text-main)]">{item.language}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Library Access</dt>
              <dd className="font-medium text-[var(--text-main)]">
                Instant Cloud Sync
              </dd>
            </div>
          </dl>
        </div>
      </aside>

      {/* Mobile Sticky Bottom Purchase Bar (56px, replaces bottom nav on detail routes) */}
      <div
        data-nosnippet=""
        className="md:hidden fixed bottom-0 inset-x-0 z-30 h-14 border-t border-[var(--border-strong)] bg-[var(--bg-surface)]/95 backdrop-blur-md px-4 pb-[var(--safe-area-inset-bottom)] flex items-center justify-between gap-3"
      >
        <div className="min-w-0 tabular-nums">
          <p className="text-base font-extrabold text-[var(--text-main)] leading-tight">
            {isFree ? 'Free' : formatPrice(item.buyPrice, item.currency)}
          </p>
          {discountPct > 0 && (
            <p className="text-[11px] font-semibold text-[var(--status-success)] leading-tight">
              {discountPct}% OFF
            </p>
          )}
        </div>

        {isOwned ? (
          <a
            href={openHref}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-5 rounded-lg bg-[var(--status-success)] text-white text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <span>Open</span>
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        ) : inCart ? (
          <button
            type="button"
            onClick={openCart}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-xs font-semibold text-[var(--text-main)] whitespace-nowrap shrink-0"
          >
            <Check className="w-3.5 h-3.5 text-[var(--status-success)]" aria-hidden="true" />
            <span>In Cart</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => (isFree ? void claimFreeItem(item) : addItem(item))}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <span>{isFree ? 'Claim Free' : 'Add to Cart'}</span>
          </button>
        )}
      </div>
    </>
  );
}
