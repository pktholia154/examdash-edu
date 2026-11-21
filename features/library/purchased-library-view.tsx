'use client';

import React, {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Clock,
  ExternalLink,
  HardDriveDownload,
  HelpCircle,
  KeyRound,
  Lock,
  Play,
  RotateCcw,
  Trophy,
} from 'lucide-react';
import { MonogramThumbnail } from '../../components/ui/monogram-thumbnail';
import { ViewToggle } from '../../components/ui/view-toggle';
import { CatalogGridSkeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/ui/state-blocks';
import type { UserPurchaseRecord, ViewMode } from '../../lib/types/catalog';
import type {
  CompletedAttemptSummary,
  ExamSet,
} from '../../lib/exam/types';
import {
  cacheExamPackOffline,
  EXAM_ATTEMPTS_UPDATED_EVENT,
  getCompletedAttemptsSync,
  loadExamSessionSync,
  readCachedExamPackOffline,
} from '../../lib/exam/storage';
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

export interface FlattenedExamSetEntry {
  key: string;
  packRecord: UserPurchaseRecord;
  set: ExamSet;
  setNumber: number;
  totalSetsInPack: number;
  offlineSaved: boolean;
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
  const {
    user,
    isAuthReady,
    isSigningIn,
    purchases,
    signInWithGoogle,
    getIdToken,
  } = useAuth();
  const { showToast } = useToast();

  const viewMode = useSyncExternalStore(
    subscribeLibView,
    getLibViewSnapshot,
    (): ViewMode => 'grid'
  );
  const [activeTab, setActiveTab] = useState<LibraryTab>('all');
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [unlockedMap, setUnlockedMap] = useState<
    Record<string, SignedGrantResponse>
  >({});

  const [examSetsByPurchaseId, setExamSetsByPurchaseId] = useState<
    Record<string, { sets: ExamSet[]; offlineSaved: boolean }>
  >({});
  const [loadingExamSets, setLoadingExamSets] = useState<boolean>(false);
  const [attemptsByKey, setAttemptsByKey] = useState<
    Record<string, CompletedAttemptSummary>
  >({});
  const [inProgressByKey, setInProgressByKey] = useState<
    Record<string, boolean>
  >({});

  const handleViewChange = (mode: ViewMode) => {
    try {
      localStorage.setItem(LIB_VIEW_KEY, mode);
    } catch {
      // Ignore storage quota errors
    }
    window.dispatchEvent(new Event(LIB_VIEW_EVENT));
  };

  const bookPurchases = useMemo(
    () => purchases.filter((p) => p.collectionName === 'books'),
    [purchases]
  );

  const examPurchases = useMemo(
    () => purchases.filter((p) => p.collectionName === 'ExamPackDocument'),
    [purchases]
  );

  // Resolve and flatten all ExamSet[] from fullJsonStoragePath for every purchased ExamPackDocument
  useEffect(() => {
    if (!user || examPurchases.length === 0) {
      return;
    }

    let cancelled = false;

    const loadAllPurchasedExamSets = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoadingExamSets(true);
      const token = await getIdToken();

      const entries = await Promise.all(
        examPurchases.map(async (record) => {
          try {
            const headers: Record<string, string> = {};
            if (token) {
              headers.Authorization = `Bearer ${token}`;
            }
            const res = await fetch(
              `/api/v1/exams/${encodeURIComponent(record.urlSlug)}?mode=full`,
              { headers }
            );
            if (res.ok) {
              const sets = (await res.json()) as ExamSet[];
              if (Array.isArray(sets) && sets.length > 0) {
                const offlineSaved = await cacheExamPackOffline(
                  record.urlSlug,
                  'full',
                  sets
                );
                return [record.purchaseId, { sets, offlineSaved }] as const;
              }
            }
          } catch {
            // Fall through to offline vault
          }

          const cached = await readCachedExamPackOffline(
            record.urlSlug,
            'full'
          );
          if (cached && cached.length > 0) {
            return [
              record.purchaseId,
              { sets: cached, offlineSaved: true },
            ] as const;
          }

          return [
            record.purchaseId,
            { sets: [] as ExamSet[], offlineSaved: false },
          ] as const;
        })
      );

      if (!cancelled) {
        const nextMap: Record<
          string,
          { sets: ExamSet[]; offlineSaved: boolean }
        > = {};
        for (const [pid, payload] of entries) {
          nextMap[pid] = payload;
        }
        setExamSetsByPurchaseId(nextMap);
        setLoadingExamSets(false);
      }
    };

    void loadAllPurchasedExamSets();
    return () => {
      cancelled = true;
    };
  }, [examPurchases, getIdToken, user]);

  const flattenedExamSets: FlattenedExamSetEntry[] = useMemo(() => {
    const out: FlattenedExamSetEntry[] = [];
    for (const record of examPurchases) {
      const resolved = examSetsByPurchaseId[record.purchaseId];
      if (resolved && resolved.sets.length > 0) {
        resolved.sets.forEach((set, idx) => {
          out.push({
            key: `${record.purchaseId}::${set.id}`,
            packRecord: record,
            set,
            setNumber: idx + 1,
            totalSetsInPack: resolved.sets.length,
            offlineSaved: resolved.offlineSaved,
          });
        });
      }
    }
    return out;
  }, [examPurchases, examSetsByPurchaseId]);

  // Sync local CBT attempt scores and resumable sessions for flattened sets
  useEffect(() => {
    const syncAttempts = () => {
      const all = getCompletedAttemptsSync();
      const map: Record<string, CompletedAttemptSummary> = {};
      for (const a of all) {
        const k = `${a.examSlug}::${a.setId}`;
        if (!map[k]) map[k] = a;
      }

      const prog: Record<string, boolean> = {};
      for (const item of flattenedExamSets) {
        const sess = loadExamSessionSync(
          item.packRecord.urlSlug,
          item.set.id,
          'full'
        );
        if (sess?.status === 'in_progress') {
          prog[`${item.packRecord.urlSlug}::${item.set.id}`] = true;
        }
      }

      setAttemptsByKey(map);
      setInProgressByKey(prog);
    };

    syncAttempts();
    window.addEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, syncAttempts);
    window.addEventListener('storage', syncAttempts);
    return () => {
      window.removeEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, syncAttempts);
      window.removeEventListener('storage', syncAttempts);
    };
  }, [flattenedExamSets]);

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
            Authenticate with Google to view your unlocked ebooks, question
            banks, and flattened full-length mock test sets across web and
            mobile.
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

  const booksCount = bookPurchases.length;
  const examSetsCount =
    flattenedExamSets.length > 0
      ? flattenedExamSets.length
      : examPurchases.reduce((acc, p) => acc + (p.totalMocktest || 1), 0);
  const totalFlattenedItems = booksCount + examSetsCount;

  const showBooks = activeTab === 'all' || activeTab === 'books';
  const showExams = activeTab === 'all' || activeTab === 'ExamPackDocument';
  const isEmptySelection =
    (activeTab === 'books' && booksCount === 0) ||
    (activeTab === 'ExamPackDocument' && examPurchases.length === 0) ||
    (activeTab === 'all' && purchases.length === 0);

  return (
    <div className="ed-container py-10 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-[var(--border-subtle)]">
        <div>
          <h1 className="text-[length:var(--text-h1)] font-extrabold tracking-tight text-[var(--text-main)]">
            Purchased Library
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Every unlocked mock exam set is flattened below for direct CBT
            execution, instant resume, and post-exam analytics.
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
        className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1"
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
          All ({totalFlattenedItems})
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
          Exam Sets ({examSetsCount})
        </button>
      </div>

      {isEmptySelection ? (
        <EmptyState
          title="No purchased items in this tab yet"
          description="Explore the live Books and Exam Packs catalogs to unlock ebooks and full-length mock test sets."
          actionLabel="Explore Catalog"
          actionHref="/"
        />
      ) : (
        <div className="space-y-8">
          {/* Flattened Individual Exam Sets Section */}
          {showExams && examPurchases.length > 0 && (
            <section aria-label="Unlocked exam sets" className="space-y-4">
              {activeTab === 'all' && booksCount > 0 && (
                <h2 className="text-base font-bold text-[var(--text-main)]">
                  Unlocked Mock Exam Sets ({examSetsCount})
                </h2>
              )}

              {loadingExamSets && flattenedExamSets.length === 0 ? (
                <CatalogGridSkeleton count={2} />
              ) : (
                <div
                  className={
                    viewMode === 'grid'
                      ? 'ed-catalog-grid'
                      : 'flex flex-col gap-3'
                  }
                >
                  {flattenedExamSets.map((entry) => {
                    const attemptHref = `/attempt/${entry.packRecord.urlSlug}/${encodeURIComponent(entry.set.id)}`;
                    const statusKey = `${entry.packRecord.urlSlug}::${entry.set.id}`;
                    const lastAttempt = attemptsByKey[statusKey];
                    const isResumable = Boolean(inProgressByKey[statusKey]);

                    return (
                      <article
                        key={entry.key}
                        className={cn(
                          'rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 tabular-nums',
                          viewMode === 'list'
                            ? 'flex flex-col sm:flex-row sm:items-center gap-4'
                            : 'flex flex-col gap-3.5'
                        )}
                      >
                        <a href={attemptHref} className="shrink-0 block">
                          <MonogramThumbnail
                            title={entry.set.title}
                            type={`Set ${entry.setNumber}/${entry.totalSetsInPack}`}
                            collectionName="ExamPackDocument"
                            size={viewMode === 'list' ? 'sm' : 'md'}
                          />
                        </a>

                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[var(--text-muted)] truncate">
                            {entry.packRecord.title} · Set {entry.setNumber} of{' '}
                            {entry.totalSetsInPack}
                            {entry.offlineSaved ? ' · Offline Vault' : ''}
                          </p>
                          <h3 className="mt-0.5 text-base font-bold text-[var(--text-main)] line-clamp-2">
                            <a href={attemptHref} className="hover:underline">
                              {entry.set.title}
                            </a>
                          </h3>

                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>{entry.set.duration} min</span>
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1">
                              <HelpCircle
                                className="w-3.5 h-3.5"
                                aria-hidden="true"
                              />
                              <span>{entry.set.totalQuestions} Qs</span>
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1">
                              <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>{entry.set.totalMarks} Marks</span>
                            </span>
                          </div>

                          {lastAttempt && (
                            <p className="mt-2 text-xs font-semibold text-[var(--status-success)]">
                              Last Score: {lastAttempt.totalScore} /{' '}
                              {lastAttempt.maxScore} ({lastAttempt.accuracyPct}%
                              accuracy)
                            </p>
                          )}

                          {entry.offlineSaved && !lastAttempt && (
                            <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">
                              <HardDriveDownload
                                className="w-3 h-3 text-[var(--status-success)]"
                                aria-hidden="true"
                              />
                              <span>Ready for offline attempt</span>
                            </p>
                          )}
                        </div>

                        <div className="mt-auto pt-3 border-t sm:border-t-0 border-[var(--border-subtle)] flex flex-wrap items-center gap-2 shrink-0">
                          <a
                            href={attemptHref}
                            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                          >
                            {isResumable ? (
                              <>
                                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Resume Set</span>
                              </>
                            ) : lastAttempt ? (
                              <>
                                <RotateCcw
                                  className="w-3.5 h-3.5"
                                  aria-hidden="true"
                                />
                                <span>Review / Retry</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Attempt Set</span>
                              </>
                            )}
                          </a>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Purchased Books Section */}
          {showBooks && bookPurchases.length > 0 && (
            <section aria-label="Unlocked study books" className="space-y-4">
              {activeTab === 'all' && examPurchases.length > 0 && (
                <h2 className="text-base font-bold text-[var(--text-main)]">
                  Unlocked Books &amp; Notes ({booksCount})
                </h2>
              )}

              <div
                className={
                  viewMode === 'grid'
                    ? 'ed-catalog-grid'
                    : 'flex flex-col gap-3'
                }
              >
                {bookPurchases.map((record) => {
                  const slotHref = `/read/${record.urlSlug}`;
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
                          collectionName="books"
                          size={viewMode === 'list' ? 'sm' : 'md'}
                        />
                      </a>

                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-bold text-[var(--text-main)] line-clamp-2">
                          <a href={slotHref} className="hover:underline">
                            {record.title}
                          </a>
                        </h3>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {record.authorName} · {record.language} · Paid{' '}
                          {formatPrice(record.paidPrice, record.currency)}
                        </p>

                        {grant && (
                          <div className="mt-2.5 p-2.5 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs space-y-1">
                            <p className="font-semibold text-[var(--status-success)]">
                              Signed access active (expires{' '}
                              {new Date(
                                grant.expiresAtIso
                              ).toLocaleTimeString()}
                              )
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
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="mt-auto pt-3 border-t sm:border-t-0 border-[var(--border-subtle)] flex flex-wrap items-center gap-2 shrink-0">
                        <a
                          href={slotHref}
                          className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                        >
                          <span>Open Reader</span>
                          <ExternalLink
                            className="w-3.5 h-3.5"
                            aria-hidden="true"
                          />
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
                            {unlockingId === record.purchaseId
                              ? 'Signing...'
                              : 'Signed Link'}
                          </span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
