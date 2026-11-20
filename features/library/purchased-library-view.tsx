'use client';

import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { ExternalLink, KeyRound, Lock } from 'lucide-react';
import { MonogramThumbnail } from '../../components/ui/monogram-thumbnail';
import { ViewToggle } from '../../components/ui/view-toggle';
import { CatalogGridSkeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/ui/state-blocks';
import type { UserPurchaseRecord, ViewMode } from '../../lib/types/catalog';
import { formatPrice } from '../../lib/registry/content-type-registry';
import { createUuidV7 } from '../../lib/platform/capacitor-bridge';
import { useAuth } from '../auth/auth-provider';
import { useToast } from '../toast/toast-context';
import { cn } from '../../lib/utils';

type LibraryTab = 'all' | 'books' | 'ExamPackDocument';

interface SignedGrantResponse {
  expiresAtIso: string;
  signature: string;
  assets: {
    pdfUrl?: string;
    markdownUrl?: string;
    jsonUrl?: string;
  };
}

const LIB_VIEW_KEY = 'ed-view-library';
const LIB_VIEW_EVENT = 'ed-view-library-change';

function subscribeLibView(cb: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(LIB_VIEW_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(LIB_VIEW_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

function getLibViewSnapshot(): ViewMode {
  if (typeof window === 'undefined') return 'grid';
  try {
    return localStorage.getItem(LIB_VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function PurchasedLibraryView() {
  const { user, isAuthReady, isSigningIn, purchases, signInWithGoogle, getIdToken } =
    useAuth();
  const { showToast } = useToast();

  const viewMode = useSyncExternalStore(
    subscribeLibView,
    getLibViewSnapshot,
    (): ViewMode => 'grid'
  );
  const [activeTab, setActiveTab] = useState<LibraryTab>('all');
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [unlockedMap, setUnlockedMap] = useState<Record<string, SignedGrantResponse>>(
    {}
  );

  const handleViewChange = (mode: ViewMode) => {
    try {
      localStorage.setItem(LIB_VIEW_KEY, mode);
    } catch {
      // Ignore
    }
    window.dispatchEvent(new Event(LIB_VIEW_EVENT));
  };

  const filtered = useMemo(() => {
    if (activeTab === 'all') return purchases;
    return purchases.filter((p) => p.collectionName === activeTab);
  }, [activeTab, purchases]);

  const handleServerUnlock = async (record: UserPurchaseRecord) => {
    setUnlockingId(record.purchaseId);
    try {
      const idToken = await getIdToken();
      if (!idToken) {
        showToast('Session expired. Please sign in again.', 'danger');
        return;
      }

      const res = await fetch('/api/v1/library/unlock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          'Idempotency-Key': createUuidV7(),
        },
        body: JSON.stringify({
          collectionName: record.collectionName,
          urlSlug: record.urlSlug,
          purchaseId: record.purchaseId,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        showToast(err.error || 'Could not generate signed asset link.', 'danger');
        return;
      }

      const grant = (await res.json()) as SignedGrantResponse;
      setUnlockedMap((prev) => ({ ...prev, [record.purchaseId]: grant }));
      showToast('Short-lived (15m) signed delivery link ready.', 'success');
    } catch {
      showToast('Network error while unlocking resource.', 'danger');
    } finally {
      setUnlockingId(null);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="ed-container py-10">
        <CatalogGridSkeleton count={4} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="ed-container py-12">
        <div className="max-w-lg mx-auto text-center rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8">
          <div className="w-12 h-12 rounded-xl bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-main)] mx-auto mb-4">
            <Lock className="w-5 h-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-extrabold text-[var(--text-main)]">
            Sign in to access your Purchased Library
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Authenticate with Google to view your unlocked ebooks, question banks, and full-length mock test packs across web and mobile.
          </p>
          <button
            type="button"
            disabled={isSigningIn}
            onClick={() => void signInWithGoogle()}
            className="mt-6 inline-flex items-center justify-center min-h-[48px] px-6 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
          >
            {isSigningIn ? 'Signing in...' : 'Continue with Google'}
          </button>
        </div>
      </div>
    );
  }

  const booksCount = purchases.filter((p) => p.collectionName === 'books').length;
  const examsCount = purchases.filter(
    (p) => p.collectionName === 'ExamPackDocument'
  ).length;

  return (
    <div className="ed-container py-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-[var(--border-subtle)]">
        <div>
          <h1 className="text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)]">
            Purchased Library
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Access owned ebooks and mock exam packs via short-lived server-signed delivery links.
          </p>
        </div>

        <ViewToggle
          value={viewMode}
          onChange={handleViewChange}
          labelPrefix="Library"
        />
      </div>

      {/* Collection Tabs */}
      <div
        role="tablist"
        aria-label="Filter purchased items by collection"
        className="mt-5 mb-6 inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'all'}
          onClick={() => setActiveTab('all')}
          className={cn(
            'min-h-[38px] px-3.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap tabular-nums',
            activeTab === 'all'
              ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
          )}
        >
          All ({purchases.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'books'}
          onClick={() => setActiveTab('books')}
          className={cn(
            'min-h-[38px] px-3.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap tabular-nums',
            activeTab === 'books'
              ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
          )}
        >
          Books ({booksCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'ExamPackDocument'}
          onClick={() => setActiveTab('ExamPackDocument')}
          className={cn(
            'min-h-[38px] px-3.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap tabular-nums',
            activeTab === 'ExamPackDocument'
              ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
          )}
        >
          Exams ({examsCount})
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No purchased items in this tab yet"
          description="Explore the live Books and Exam Packs catalogs to add resources to your personal study library."
          actionLabel="Explore Catalog"
          actionHref="/"
        />
      ) : (
        <div
          className={
            viewMode === 'grid' ? 'ed-catalog-grid' : 'flex flex-col gap-3'
          }
        >
          {filtered.map((record) => {
            const slotHref =
              record.collectionName === 'books'
                ? `/read/${record.urlSlug}`
                : `/attempt/${record.urlSlug}`;
            const grant = unlockedMap[record.purchaseId];

            return (
              <article
                key={record.purchaseId}
                className={cn(
                  'rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4',
                  viewMode === 'list'
                    ? 'flex flex-col sm:flex-row sm:items-center gap-4'
                    : 'flex flex-col gap-3.5'
                )}
              >
                <a href={slotHref} className="shrink-0 block">
                  <MonogramThumbnail
                    title={record.title}
                    type={record.type}
                    collectionName={record.collectionName}
                    size={viewMode === 'list' ? 'sm' : 'md'}
                  />
                </a>

                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-[var(--text-main)] line-clamp-2">
                    <a href={slotHref} className="hover:underline">
                      {record.title}
                    </a>
                  </h2>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {record.authorName} · {record.language} · Paid{' '}
                    {formatPrice(record.paidPrice, record.currency)}
                  </p>

                  {grant && (
                    <div className="mt-2.5 p-2.5 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs space-y-1">
                      <p className="font-semibold text-[var(--status-success)]">
                        Signed access active (expires{' '}
                        {new Date(grant.expiresAtIso).toLocaleTimeString()})
                      </p>
                      <div className="flex flex-wrap gap-3">
                        {grant.assets.pdfUrl && (
                          <a
                            href={`${slotHref}?format=pdf`}
                            className="underline font-medium text-[var(--text-main)]"
                          >
                            Open Full PDF Slot
                          </a>
                        )}
                        {grant.assets.markdownUrl && (
                          <a
                            href={`${slotHref}?format=markdown`}
                            className="underline font-medium text-[var(--text-main)]"
                          >
                            Open Full Markdown Slot
                          </a>
                        )}
                        {grant.assets.jsonUrl && (
                          <a
                            href={slotHref}
                            className="underline font-medium text-[var(--text-main)]"
                          >
                            Launch Full Mock Runner
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-auto pt-3 border-t sm:border-t-0 border-[var(--border-subtle)] flex flex-wrap items-center gap-2 shrink-0">
                  <a
                    href={slotHref}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                  >
                    <span>
                      {record.collectionName === 'books' ? 'Open Reader' : 'Start Exam'}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  </a>

                  <button
                    type="button"
                    disabled={unlockingId === record.purchaseId}
                    onClick={() => void handleServerUnlock(record)}
                    aria-label={`Verify signed URL for ${record.title}`}
                    className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {unlockingId === record.purchaseId ? 'Signing...' : 'Signed Link'}
                    </span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
