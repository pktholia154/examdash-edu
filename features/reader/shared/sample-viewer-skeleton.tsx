'use client';

import React from 'react';
import { X, Zap } from 'lucide-react';

export interface SampleDocumentBodySkeletonProps {
  format: 'pdf' | 'markdown';
  progressLabel?: string;
}

/**
 * Pure zero-dependency document page/prose skeleton (< 16ms paint, 0 CLS).
 * Used both during initial dynamic chunk load and while streaming PDF/Markdown sample bytes.
 */
export function SampleDocumentBodySkeleton({
  format,
  progressLabel,
}: SampleDocumentBodySkeletonProps) {
  if (format === 'markdown') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading sample chapter"
        className="flex-1 w-full overflow-hidden px-4 sm:px-8 lg:px-12 py-6 bg-[var(--reader-bg,var(--bg-surface))]"
      >
        <div className="mx-auto max-w-3xl space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div className="h-3.5 w-32 rounded ed-skeleton" />
            {progressLabel && (
              <span className="text-xs font-medium tabular-nums text-[var(--reader-muted,var(--text-muted))]">
                {progressLabel}
              </span>
            )}
          </div>
          <div className="h-7 w-3/4 rounded-md ed-skeleton" />
          <div className="h-px w-full bg-[var(--reader-border,var(--border-subtle))]" />
          <div className="space-y-2.5 pt-1">
            <div className="h-4 w-full rounded ed-skeleton" />
            <div className="h-4 w-[96%] rounded ed-skeleton" />
            <div className="h-4 w-[91%] rounded ed-skeleton" />
            <div className="h-4 w-4/5 rounded ed-skeleton" />
          </div>
          <div className="h-5 w-1/2 rounded ed-skeleton pt-2" />
          <div className="space-y-2.5">
            <div className="h-4 w-full rounded ed-skeleton" />
            <div className="h-4 w-[94%] rounded ed-skeleton" />
            <div className="h-4 w-[88%] rounded ed-skeleton" />
            <div className="h-4 w-2/3 rounded ed-skeleton" />
          </div>
          <div className="rounded-lg border border-[var(--reader-border,var(--border-subtle))] p-4 space-y-2">
            <div className="h-3.5 w-28 rounded ed-skeleton" />
            <div className="h-3.5 w-11/12 rounded ed-skeleton" />
            <div className="h-3.5 w-3/4 rounded ed-skeleton" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading PDF sample pages"
      className="flex-1 w-full overflow-hidden p-2.5 sm:p-5 bg-[var(--reader-stage-bg,var(--bg-elevated))] flex flex-col items-center"
    >
      <div className="w-full max-w-[780px] flex-1 rounded-md border border-[var(--reader-border,var(--border-subtle))] bg-[var(--reader-bg,var(--bg-surface))] p-5 sm:p-8 flex flex-col justify-between">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="h-3 w-28 rounded ed-skeleton" />
            <span className="text-xs font-medium tabular-nums text-[var(--reader-muted,var(--text-muted))]">
              {progressLabel || 'Streaming sample...'}
            </span>
          </div>
          <div className="h-6 w-2/3 rounded ed-skeleton mt-2" />
          <div className="space-y-2.5 pt-3">
            <div className="h-3.5 w-full rounded ed-skeleton" />
            <div className="h-3.5 w-[95%] rounded ed-skeleton" />
            <div className="h-3.5 w-[92%] rounded ed-skeleton" />
            <div className="h-3.5 w-[84%] rounded ed-skeleton" />
          </div>
          <div className="my-4 h-36 sm:h-44 w-full rounded-md ed-skeleton" />
          <div className="space-y-2.5">
            <div className="h-3.5 w-full rounded ed-skeleton" />
            <div className="h-3.5 w-[93%] rounded ed-skeleton" />
            <div className="h-3.5 w-3/4 rounded ed-skeleton" />
          </div>
        </div>
        <div className="pt-4 flex items-center justify-between border-t border-[var(--reader-border,var(--border-subtle))]">
          <div className="h-3 w-20 rounded ed-skeleton" />
          <div className="h-3 w-12 rounded ed-skeleton" />
        </div>
      </div>
    </div>
  );
}

/**
 * Synchronous < 16ms Overlay Shell Skeleton painted immediately on Sample click
 * before the lazy `book-inline-reader-modal` JS chunk finishes loading (0 KB PDF/MD bundle cost).
 */
export function SampleOverlayInstantShellSkeleton({
  title,
  format,
  priceLabel,
  isFree,
  onClose,
}: {
  title: string;
  format: 'pdf' | 'markdown';
  priceLabel: string;
  isFree: boolean;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — Sample Preview`}
      data-nosnippet=""
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 overscroll-contain"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full h-[94dvh] max-h-[94dvh] rounded-t-2xl md:w-[min(94vw,1120px)] md:h-[92dvh] md:max-h-[92dvh] md:rounded-2xl border-t md:border border-[var(--border-strong)] bg-[var(--bg-surface)] flex flex-col overflow-hidden"
      >
        {/* Mobile Handle Zone */}
        <div className="md:hidden flex items-center justify-center pt-2.5 pb-1.5 bg-[var(--bg-surface)] shrink-0">
          <span
            aria-hidden="true"
            className="w-10 h-1 rounded-full bg-[var(--border-strong)]"
          />
        </div>

        {/* Top Bar Skeleton */}
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] shrink-0">
          <h2 className="text-xs sm:text-sm font-bold text-[var(--text-main)] truncate flex-1 min-w-0">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sample viewer"
            className="inline-flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-main)] shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Sub-toolbar Skeleton */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] shrink-0">
          <div className="h-6 w-16 rounded ed-skeleton" />
          <div className="h-7 w-28 rounded ed-skeleton" />
          <div className="h-7 w-24 rounded ed-skeleton" />
        </div>

        <SampleDocumentBodySkeleton format={format} />

        {/* Sticky Buy eBook CTA Footer Skeleton */}
        <div
          className="flex items-center justify-between gap-3 px-3.5 sm:px-5 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] shrink-0"
          style={{
            paddingBottom: 'calc(0.625rem + var(--safe-area-inset-bottom))',
          }}
        >
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-muted)] truncate">
              Free Sample Preview
            </p>
            <p className="text-base font-extrabold text-[var(--text-main)] tabular-nums">
              {priceLabel}
            </p>
          </div>
          <span className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold opacity-90 whitespace-nowrap shrink-0">
            <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{isFree ? 'Claim Free eBook' : 'Buy eBook'}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
