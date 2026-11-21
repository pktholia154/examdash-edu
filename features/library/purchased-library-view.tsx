'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ChevronDown,
  Download,
  HardDrive,
  Loader2,
  Lock,
  RefreshCw,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { MonogramThumbnail } from '../../components/ui/monogram-thumbnail';
import { EmptyState } from '../../components/ui/state-blocks';
import {
  EXAM_ATTEMPTS_UPDATED_EVENT,
  loadExamSessionSync,
} from '../../lib/exam/storage';
import {
  clearAllUserOfflineAssets,
  deleteBookFormatOffline,
  deleteExamPackOffline,
  formatBytesCompact,
  getStorageUsageSummary,
  listUserOfflineAssets,
  OFFLINE_VAULT_UPDATED_EVENT,
  requestSignedAssetUnlock,
  saveBookFormatOffline,
  saveExamPackShardedOffline,
  type OfflineAssetRecord,
  type StorageUsageSummary,
} from '../../lib/offline/offline-vault';
import type {
  MocktestTitleItem,
  UserPurchaseRecord,
} from '../../lib/types/catalog';
import { cn } from '../../lib/utils';
import { useAuth } from '../auth/auth-provider';
import { useToast } from '../toast/toast-context';

export interface PurchasedBookCatalogMeta {
  id: string;
  urlSlug: string;
  hasFullPdf: boolean;
  hasFullMarkdown: boolean;
  updatedAtMs: number;
}

export interface PurchasedExamCatalogMeta {
  id: string;
  urlSlug: string;
  totalMocktest: number;
  hasFullJson: boolean;
  updatedAtMs: number;
  mocktestTitles: MocktestTitleItem[];
}

type LibraryOfflineFilter = 'all' | 'offline';

function subscribeNetworkStatus(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

function getNetworkSnapshot(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

export function PurchasedLibraryView({
  booksMeta = [],
  examsMeta = [],
}: {
  booksMeta?: PurchasedBookCatalogMeta[];
  examsMeta?: PurchasedExamCatalogMeta[];
}) {
  const router = useRouter();
  const {
    user,
    isAuthReady,
    isSigningIn,
    purchases,
    signInWithGoogle,
    getIdToken,
  } = useAuth();
  const { showToast } = useToast();

  const isOnline = useSyncExternalStore(
    subscribeNetworkStatus,
    getNetworkSnapshot,
    () => true
  );

  const [filterMode, setFilterMode] = useState<LibraryOfflineFilter>('all');
  const [offlineAssets, setOfflineAssets] = useState<OfflineAssetRecord[]>([]);
  const [storageUsage, setStorageUsage] = useState<StorageUsageSummary>({
    vaultBytes: 0,
    assetCount: 0,
    browserUsageBytes: null,
    browserQuotaBytes: null,
  });
  const [manageStorageOpen, setManageStorageOpen] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);

  // Active download progress (0-100) keyed by taskId
  const [downloadProgress, setDownloadProgress] = useState<
    Record<string, number>
  >({});
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Short-lived signed URL minting state for immediate Online launches
  const [launchingTaskKey, setLaunchingTaskKey] = useState<string | null>(null);

  // User-selected Online vs Offline preferences when online & saved
  const [bookFormatPref, setBookFormatPref] = useState<
    Record<string, 'online' | 'offline'>
  >({});
  const [examOfflineReadyToggle, setExamOfflineReadyToggle] = useState<
    Record<string, boolean>
  >({});

  // Track resumable in-progress exam set IDs per slug
  const [resumableSets, setResumableSets] = useState<Record<string, boolean>>(
    {}
  );

  const booksMetaById = useMemo(() => {
    const map = new Map<string, PurchasedBookCatalogMeta>();
    for (const b of booksMeta) {
      map.set(b.id, b);
      map.set(b.urlSlug, b);
    }
    return map;
  }, [booksMeta]);

  const examsMetaById = useMemo(() => {
    const map = new Map<string, PurchasedExamCatalogMeta>();
    for (const e of examsMeta) {
      map.set(e.id, e);
      map.set(e.urlSlug, e);
    }
    return map;
  }, [examsMeta]);

  // Abort any in-flight downloads if component unmounts
  useEffect(() => {
    const controllers = abortControllersRef.current;
    return () => {
      controllers.forEach((ctrl) => ctrl.abort());
      controllers.clear();
    };
  }, []);

  const userId = user?.uid;

  const refreshVaultSnapshot = useCallback(async () => {
    if (!userId) {
      setOfflineAssets([]);
      setStorageUsage({
        vaultBytes: 0,
        assetCount: 0,
        browserUsageBytes: null,
        browserQuotaBytes: null,
      });
      return;
    }
    const [assets, summary] = await Promise.all([
      listUserOfflineAssets(userId),
      getStorageUsageSummary(userId),
    ]);
    setOfflineAssets(assets);
    setStorageUsage(summary);
  }, [userId]);

  useEffect(() => {
    let active = true;
    const sync = async () => {
      await Promise.resolve();
      if (!active) return;
      await refreshVaultSnapshot();
    };
    void sync();
    window.addEventListener(OFFLINE_VAULT_UPDATED_EVENT, sync);
    return () => {
      active = false;
      window.removeEventListener(OFFLINE_VAULT_UPDATED_EVENT, sync);
    };
  }, [refreshVaultSnapshot]);

  // Fast O(1) lookup maps for saved book formats & saved exam packs/shards
  const savedBookAssetsMap = useMemo(() => {
    const map = new Map<string, OfflineAssetRecord>();
    for (const asset of offlineAssets) {
      if (
        asset.collectionName === 'books' &&
        (asset.format === 'pdf' || asset.format === 'markdown')
      ) {
        map.set(`${asset.itemId}::${asset.format}`, asset);
      }
    }
    return map;
  }, [offlineAssets]);

  const savedExamPacksMap = useMemo(() => {
    const manifestByPack = new Map<string, OfflineAssetRecord>();
    const shardsByPack = new Map<string, OfflineAssetRecord[]>();
    for (const asset of offlineAssets) {
      if (asset.collectionName !== 'ExamPackDocument') continue;
      if (asset.format === 'exam_pack') {
        manifestByPack.set(asset.itemId, asset);
      } else if (asset.format === 'exam_set') {
        const list = shardsByPack.get(asset.itemId) || [];
        list.push(asset);
        shardsByPack.set(asset.itemId, list);
      }
    }
    return { manifestByPack, shardsByPack };
  }, [offlineAssets]);

  const bookPurchases = useMemo(
    () => purchases.filter((p) => p.collectionName === 'books'),
    [purchases]
  );

  const examPurchases = useMemo(
    () => purchases.filter((p) => p.collectionName === 'ExamPackDocument'),
    [purchases]
  );

  // Resolve 0ms MocktestTitles list for each purchased exam pack without downloading fullJsonStoragePath
  const resolvedExamRows = useMemo(() => {
    return examPurchases.map((record) => {
      const catalogMeta =
        examsMetaById.get(record.itemId) || examsMetaById.get(record.urlSlug);
      const localShards =
        savedExamPacksMap.shardsByPack.get(record.itemId) || [];
      const manifest = savedExamPacksMap.manifestByPack.get(record.itemId);
      const isPackSavedOffline = Boolean(manifest || localShards.length > 0);

      let sets: MocktestTitleItem[] = [];
      if (catalogMeta && catalogMeta.mocktestTitles.length > 0) {
        sets = catalogMeta.mocktestTitles;
      } else if (localShards.length > 0) {
        sets = localShards.map((s, idx) => ({
          id: s.setId || `exam_set_${idx + 1}`,
          title: s.setTitle || `Mock Set ${String(idx + 1).padStart(2, '0')}`,
          duration: s.duration || 60,
          totalQuestions: s.totalQuestions || 0,
          totalMarks: s.totalMarks || 0,
        }));
      } else {
        const fallbackCount = Math.max(1, record.totalMocktest || 1);
        sets = Array.from({ length: fallbackCount }, (_, idx) => ({
          id: `exam_set_${idx + 1}`,
          title: `Mock Set ${String(idx + 1).padStart(2, '0')}`,
          duration: 60,
          totalQuestions: 50,
          totalMarks: 100,
        }));
      }

      const savedAt =
        manifest?.savedAt ||
        (localShards.length > 0 ? localShards[0].savedAt : 0);
      const remoteAt =
        manifest?.remoteUpdatedAt ||
        (localShards.length > 0 ? localShards[0].remoteUpdatedAt : 0);
      const latestFirestoreMs = catalogMeta?.updatedAtMs || 0;
      const hasUpdateAvailable =
        isPackSavedOffline &&
        latestFirestoreMs > savedAt + 1000 &&
        latestFirestoreMs > remoteAt + 1000;

      return {
        record,
        sets,
        isPackSavedOffline,
        hasUpdateAvailable,
        remoteUpdatedAtMs: latestFirestoreMs,
      };
    });
  }, [examPurchases, examsMetaById, savedExamPacksMap]);

  // Sync in-progress CBT status for instant Resume detection
  useEffect(() => {
    if (!user?.uid) return;
    const syncInProgress = () => {
      const next: Record<string, boolean> = {};
      for (const row of resolvedExamRows) {
        for (const s of row.sets) {
          const sess = loadExamSessionSync(
            row.record.urlSlug,
            s.id,
            'full',
            user.uid
          );
          if (sess?.status === 'in_progress') {
            next[`${row.record.urlSlug}::${s.id}`] = true;
          }
        }
      }
      setResumableSets(next);
    };
    syncInProgress();
    window.addEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, syncInProgress);
    window.addEventListener('storage', syncInProgress);
    return () => {
      window.removeEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, syncInProgress);
      window.removeEventListener('storage', syncInProgress);
    };
  }, [resolvedExamRows, user?.uid]);

  const cancelActiveDownload = (taskKey: string) => {
    const ctrl = abortControllersRef.current.get(taskKey);
    if (ctrl) {
      ctrl.abort();
      abortControllersRef.current.delete(taskKey);
    }
    setDownloadProgress((prev) => {
      const next = { ...prev };
      delete next[taskKey];
      return next;
    });
  };

  const handleSaveBookOffline = async (
    record: UserPurchaseRecord,
    format: 'pdf' | 'markdown',
    remoteUpdatedAtMs: number
  ) => {
    if (!user?.uid) return;
    if (!isOnline) {
      showToast('Connect to the internet to save offline files.', 'danger');
      return;
    }

    const taskKey = `book:${record.itemId}:${format}`;
    cancelActiveDownload(taskKey);
    const controller = new AbortController();
    abortControllersRef.current.set(taskKey, controller);
    setDownloadProgress((prev) => ({ ...prev, [taskKey]: 2 }));

    try {
      await saveBookFormatOffline({
        uid: user.uid,
        itemId: record.itemId,
        urlSlug: record.urlSlug,
        format,
        remoteUpdatedAtMs,
        getIdToken,
        signal: controller.signal,
        onProgress: (pct) => {
          setDownloadProgress((prev) => ({ ...prev, [taskKey]: pct }));
        },
      });
      setBookFormatPref((prev) => ({ ...prev, [taskKey]: 'offline' }));
      showToast(
        `Saved ${format.toUpperCase()} edition for offline reading.`,
        'success'
      );
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === 'AbortError') ||
        controller.signal.aborted
      ) {
        showToast('Offline download cancelled.');
      } else {
        showToast(
          err instanceof Error
            ? err.message
            : 'Failed to save offline book copy.',
          'danger'
        );
      }
    } finally {
      abortControllersRef.current.delete(taskKey);
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[taskKey];
        return next;
      });
    }
  };

  const handleDeleteBookOffline = async (
    record: UserPurchaseRecord,
    format: 'pdf' | 'markdown'
  ) => {
    if (!user?.uid) return;
    const taskKey = `book:${record.itemId}:${format}`;
    await deleteBookFormatOffline(user.uid, record.itemId, format);
    setBookFormatPref((prev) => ({ ...prev, [taskKey]: 'online' }));
    showToast(`Removed offline ${format.toUpperCase()} file from device.`);
  };

  const handleLaunchBookReader = async (
    record: UserPurchaseRecord,
    format: 'pdf' | 'markdown',
    source: 'online' | 'offline'
  ) => {
    if (!user?.uid) return;
    const taskKey = `book:${record.itemId}:${format}`;
    setBookFormatPref((prev) => ({ ...prev, [taskKey]: source }));

    if (source === 'offline') {
      router.push(
        `/read/${record.urlSlug}?mode=full&format=${format}&source=offline`
      );
      return;
    }

    if (!isOnline) {
      showToast('Device is offline. Switch to Read Offline.', 'danger');
      return;
    }

    const launchId = `launch:${record.itemId}:${format}`;
    setLaunchingTaskKey(launchId);
    try {
      await requestSignedAssetUnlock({
        uid: user.uid,
        collectionName: 'books',
        urlSlug: record.urlSlug,
        getIdToken,
      });
      router.push(
        `/read/${record.urlSlug}?mode=full&format=${format}&source=online`
      );
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Unable to verify purchase entitlement.',
        'danger'
      );
    } finally {
      setLaunchingTaskKey(null);
    }
  };

  const handleSaveExamPackOffline = async (
    record: UserPurchaseRecord,
    remoteUpdatedAtMs: number
  ) => {
    if (!user?.uid) return;
    if (!isOnline) {
      showToast('Connect to the internet to save exam sets offline.', 'danger');
      return;
    }

    const taskKey = `exam:${record.itemId}`;
    cancelActiveDownload(taskKey);
    const controller = new AbortController();
    abortControllersRef.current.set(taskKey, controller);
    setDownloadProgress((prev) => ({ ...prev, [taskKey]: 2 }));

    try {
      const shards = await saveExamPackShardedOffline({
        uid: user.uid,
        packId: record.itemId,
        urlSlug: record.urlSlug,
        remoteUpdatedAtMs,
        getIdToken,
        signal: controller.signal,
        onProgress: (pct) => {
          setDownloadProgress((prev) => ({ ...prev, [taskKey]: pct }));
        },
      });
      setExamOfflineReadyToggle((prev) => ({
        ...prev,
        [record.itemId]: true,
      }));
      showToast(
        `Saved & sharded ${shards.length} mock ${
          shards.length === 1 ? 'set' : 'sets'
        } for offline execution.`,
        'success'
      );
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === 'AbortError') ||
        controller.signal.aborted
      ) {
        showToast('Offline exam download cancelled.');
      } else {
        showToast(
          err instanceof Error
            ? err.message
            : 'Unable to save exam pack offline.',
          'danger'
        );
      }
    } finally {
      abortControllersRef.current.delete(taskKey);
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[taskKey];
        return next;
      });
    }
  };

  const handleDeleteExamPackOffline = async (record: UserPurchaseRecord) => {
    if (!user?.uid) return;
    await deleteExamPackOffline(user.uid, record.itemId);
    setExamOfflineReadyToggle((prev) => ({
      ...prev,
      [record.itemId]: false,
    }));
    showToast('Removed offline exam shards from device.');
  };

  const handleLaunchExamSet = async (
    record: UserPurchaseRecord,
    setId: string,
    source: 'online' | 'offline'
  ) => {
    if (!user?.uid) return;
    const encodedSetId = encodeURIComponent(setId);

    if (source === 'offline') {
      router.push(
        `/attempt/${record.urlSlug}/${encodedSetId}?source=offline`
      );
      return;
    }

    if (!isOnline) {
      showToast(
        'Device is offline. Save this exam pack offline while connected first.',
        'danger'
      );
      return;
    }

    const launchId = `launch:exam:${record.itemId}:${setId}`;
    setLaunchingTaskKey(launchId);
    try {
      await requestSignedAssetUnlock({
        uid: user.uid,
        collectionName: 'ExamPackDocument',
        urlSlug: record.urlSlug,
        getIdToken,
      });
      router.push(`/attempt/${record.urlSlug}/${encodedSetId}?source=online`);
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Unable to verify exam pack entitlement.',
        'danger'
      );
    } finally {
      setLaunchingTaskKey(null);
    }
  };

  const handleClearAllCache = async () => {
    if (!user?.uid) return;
    setIsClearingCache(true);
    try {
      await clearAllUserOfflineAssets(user.uid);
      setBookFormatPref({});
      setExamOfflineReadyToggle({});
      setManageStorageOpen(false);
      showToast('Cleared all offline files from local storage.', 'success');
    } finally {
      setIsClearingCache(false);
    }
  };

  // Filtered Lists (All vs Saved Offline)
  const visibleBookRows = useMemo(() => {
    return bookPurchases.filter((record) => {
      if (filterMode === 'all') return true;
      return (
        savedBookAssetsMap.has(`${record.itemId}::pdf`) ||
        savedBookAssetsMap.has(`${record.itemId}::markdown`)
      );
    });
  }, [bookPurchases, filterMode, savedBookAssetsMap]);

  const visibleExamRows = useMemo(() => {
    return resolvedExamRows.filter((row) => {
      if (filterMode === 'all') return true;
      return row.isPackSavedOffline;
    });
  }, [filterMode, resolvedExamRows]);

  const savedItemCount = useMemo(() => {
    let count = 0;
    for (const b of bookPurchases) {
      if (
        savedBookAssetsMap.has(`${b.itemId}::pdf`) ||
        savedBookAssetsMap.has(`${b.itemId}::markdown`)
      ) {
        count += 1;
      }
    }
    for (const e of resolvedExamRows) {
      if (e.isPackSavedOffline) count += 1;
    }
    return count;
  }, [bookPurchases, resolvedExamRows, savedBookAssetsMap]);

  if (!isAuthReady) {
    return (
      <div className="ed-container py-8 space-y-3">
        <div className="h-14 w-full rounded-xl ed-skeleton" />
        <div className="h-24 w-full rounded-xl ed-skeleton" />
        <div className="h-28 w-full rounded-xl ed-skeleton" />
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
            Authenticate with Google to view your unlocked ebooks and mock test
            packs across online and offline study modes.
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

  const totalPurchasesCount = bookPurchases.length + examPurchases.length;

  return (
    <div className="ed-container py-6 sm:py-8 space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[var(--text-main)]">
          Purchased Library
        </h1>
        <span className="text-xs font-medium text-[var(--text-muted)] tabular-nums">
          {totalPurchasesCount}{' '}
          {totalPurchasesCount === 1 ? 'Item' : 'Items'} Unlocked
        </span>
      </div>

      {/* Top Minimal Offline Control Strip */}
      <div
        role="region"
        aria-label="Offline library controls"
        className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 sm:p-3 space-y-2.5 tabular-nums"
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* All | Saved Offline Filter */}
          <div
            role="tablist"
            aria-label="Filter library items"
            className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={filterMode === 'all'}
              onClick={() => setFilterMode('all')}
              className={cn(
                'min-h-[48px] px-4 rounded-md text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap',
                filterMode === 'all'
                  ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              )}
            >
              All ({totalPurchasesCount})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filterMode === 'offline'}
              onClick={() => setFilterMode('offline')}
              className={cn(
                'min-h-[48px] px-4 rounded-md text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap',
                filterMode === 'offline'
                  ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              )}
            >
              Saved Offline ({savedItemCount})
            </button>
          </div>

          {/* Right Status + Compact Local Storage Manage / Clear Cache */}
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 ms-auto">
            <span
              role="status"
              className={cn(
                'inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap px-2',
                isOnline
                  ? 'text-[var(--text-muted)]'
                  : 'text-[var(--status-warning)]'
              )}
            >
              {isOnline ? (
                <>
                  <Wifi
                    className="w-3.5 h-3.5 text-[var(--status-success)] shrink-0"
                    aria-hidden="true"
                  />
                  <span>Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Offline Mode</span>
                </>
              )}
            </span>

            <span
              aria-hidden="true"
              className="text-[var(--border-strong)] hidden sm:inline"
            >
              |
            </span>

            <button
              type="button"
              aria-expanded={manageStorageOpen}
              onClick={() => setManageStorageOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 min-h-[48px] px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-elevated)] text-xs font-semibold text-[var(--text-main)] transition-colors whitespace-nowrap"
            >
              <HardDrive
                className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0"
                aria-hidden="true"
              />
              <span>{formatBytesCompact(storageUsage.vaultBytes)}</span>
              <span className="text-[var(--text-muted)]">· Manage</span>
            </button>
          </div>
        </div>

        {/* Inline Storage Management Drawer (Zero window.confirm) */}
        {manageStorageOpen && (
          <div className="pt-2.5 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="text-[var(--text-muted)]">
              <span>
                Offline Vault:{' '}
                <strong className="text-[var(--text-main)]">
                  {formatBytesCompact(storageUsage.vaultBytes)}
                </strong>{' '}
                across {storageUsage.assetCount} saved{' '}
                {storageUsage.assetCount === 1 ? 'bundle' : 'bundles'}
              </span>
              {storageUsage.browserQuotaBytes ? (
                <span>
                  {' '}
                  · Device quota{' '}
                  {formatBytesCompact(storageUsage.browserQuotaBytes)}
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-2 ms-auto">
              <button
                type="button"
                disabled={storageUsage.vaultBytes === 0 || isClearingCache}
                onClick={() => void handleClearAllCache()}
                className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3.5 rounded-lg border border-[var(--status-danger)] text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)] disabled:opacity-40 text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {isClearingCache ? 'Clearing...' : 'Clear Cache'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setManageStorageOpen(false)}
                className="inline-flex items-center justify-center min-h-[48px] px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Empty States */}
      {totalPurchasesCount === 0 ? (
        <EmptyState
          title="Your Purchased Library is empty"
          description="Explore Books and Exam Packs to unlock digital study editions and full-length mock test sets."
          actionLabel="Explore Catalog"
          actionHref="/"
        />
      ) : visibleBookRows.length === 0 && visibleExamRows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center space-y-3">
          <p className="text-base font-bold text-[var(--text-main)]">
            No items saved offline yet
          </p>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] max-w-md mx-auto">
            Switch to All and tap Save Offline on any book or exam pack to store
            an eviction-proof local copy on this device.
          </p>
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs sm:text-sm font-semibold"
          >
            Show All Purchased Items
          </button>
        </div>
      ) : (
        /* 100% Locked Strict Minimal ListView */
        <div
          role="list"
          aria-label="Purchased items list"
          className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden tabular-nums"
        >
          {/* A. Purchased Book Rows (books) */}
          {visibleBookRows.map((record) => {
            const meta =
              booksMetaById.get(record.itemId) ||
              booksMetaById.get(record.urlSlug);
            const showPdf = meta ? meta.hasFullPdf : true;
            const showMarkdown = meta ? meta.hasFullMarkdown : false;
            const formatsToRender: Array<'pdf' | 'markdown'> = [];
            if (showPdf) formatsToRender.push('pdf');
            if (showMarkdown) formatsToRender.push('markdown');
            if (formatsToRender.length === 0) formatsToRender.push('pdf');

            const remoteUpdatedAtMs = meta?.updatedAtMs || 0;

            return (
              <div
                key={record.purchaseId}
                role="listitem"
                className="p-3.5 sm:p-4 flex items-start gap-3.5"
              >
                <MonogramThumbnail
                  title={record.title}
                  type="EB"
                  collectionName="books"
                  size="xs"
                  showBadge={false}
                />

                <div className="flex-1 min-w-0 space-y-2.5">
                  <h2 className="text-sm sm:text-base font-bold text-[var(--text-main)] line-clamp-1 sm:line-clamp-2 leading-snug">
                    {record.title}
                  </h2>

                  {/* Side-by-side PDF & Markdown Action Clusters (stacking cleanly on narrow mobile) */}
                  <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-2.5 lg:gap-5">
                    {formatsToRender.map((fmt) => {
                      const label = fmt === 'pdf' ? 'PDF:' : 'Markdown:';
                      const taskKey = `book:${record.itemId}:${fmt}`;
                      const launchKey = `launch:${record.itemId}:${fmt}`;
                      const activePct = downloadProgress[taskKey];
                      const isDownloading = typeof activePct === 'number';
                      const savedAsset = savedBookAssetsMap.get(
                        `${record.itemId}::${fmt}`
                      );
                      const isSaved = Boolean(savedAsset);
                      const hasUpdate =
                        isSaved &&
                        savedAsset !== undefined &&
                        remoteUpdatedAtMs > savedAsset.savedAt + 1000 &&
                        remoteUpdatedAtMs > savedAsset.remoteUpdatedAt + 1000;

                      const selectedMode: 'online' | 'offline' = !isOnline
                        ? 'offline'
                        : bookFormatPref[taskKey] || 'offline';

                      return (
                        <div
                          key={fmt}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <span className="text-xs font-semibold text-[var(--text-muted)] min-w-[4.5rem]">
                            {label}
                          </span>

                          {isDownloading ? (
                            <button
                              type="button"
                              onClick={() => cancelActiveDownload(taskKey)}
                              aria-label={`Cancel ${fmt.toUpperCase()} download (${activePct}%)`}
                              className="inline-flex items-center justify-center gap-2 min-h-[48px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] whitespace-nowrap"
                            >
                              <Loader2
                                className="w-3.5 h-3.5 animate-spin shrink-0"
                                aria-hidden="true"
                              />
                              <span>Saving {activePct}%</span>
                              <X
                                className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0"
                                aria-hidden="true"
                              />
                            </button>
                          ) : isSaved ? (
                            <div className="inline-flex flex-wrap items-center gap-1.5">
                              {/* [ Read Online | ● Read Offline ] */}
                              <div
                                role="group"
                                aria-label={`${record.title} ${fmt.toUpperCase()} reading mode`}
                                className="inline-flex items-center rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] overflow-hidden"
                              >
                                <button
                                  type="button"
                                  disabled={
                                    !isOnline || launchingTaskKey === launchKey
                                  }
                                  onClick={() =>
                                    void handleLaunchBookReader(
                                      record,
                                      fmt,
                                      'online'
                                    )
                                  }
                                  className={cn(
                                    'inline-flex items-center justify-center min-h-[48px] px-3 sm:px-3.5 text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-40',
                                    isOnline && selectedMode === 'online'
                                      ? 'bg-[var(--bg-elevated)] text-[var(--text-main)]'
                                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)]/60'
                                  )}
                                >
                                  {launchingTaskKey === launchKey
                                    ? 'Opening...'
                                    : 'Read Online'}
                                </button>
                                <span
                                  aria-hidden="true"
                                  className="w-px h-6 bg-[var(--border-subtle)]"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleLaunchBookReader(
                                      record,
                                      fmt,
                                      'offline'
                                    )
                                  }
                                  className={cn(
                                    'inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3 sm:px-3.5 text-xs font-semibold transition-colors whitespace-nowrap',
                                    selectedMode === 'offline'
                                      ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                                      : 'text-[var(--text-main)] hover:bg-[var(--bg-elevated)]'
                                  )}
                                >
                                  <span
                                    aria-hidden="true"
                                    className="w-2 h-2 rounded-full bg-current shrink-0"
                                  />
                                  <span>Read Offline</span>
                                </button>
                              </div>

                              {hasUpdate && isOnline && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleSaveBookOffline(
                                      record,
                                      fmt,
                                      remoteUpdatedAtMs
                                    )
                                  }
                                  aria-label={`Update offline ${fmt.toUpperCase()} for ${record.title}`}
                                  className="inline-flex items-center justify-center gap-1 min-h-[48px] px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-elevated)] text-xs font-semibold text-[var(--text-main)] whitespace-nowrap"
                                >
                                  <RefreshCw
                                    className="w-3.5 h-3.5 shrink-0"
                                    aria-hidden="true"
                                  />
                                  <span>Update</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() =>
                                  void handleDeleteBookOffline(record, fmt)
                                }
                                aria-label={`Delete offline ${fmt.toUpperCase()} copy of ${record.title}`}
                                className="inline-flex items-center justify-center min-h-[48px] min-w-[48px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--status-danger)] hover:border-[var(--status-danger)] transition-colors"
                              >
                                <Trash2 className="w-4 h-4" aria-hidden="true" />
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={
                                  !isOnline || launchingTaskKey === launchKey
                                }
                                onClick={() =>
                                  void handleLaunchBookReader(
                                    record,
                                    fmt,
                                    'online'
                                  )
                                }
                                className="inline-flex items-center justify-center min-h-[48px] px-3.5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity whitespace-nowrap"
                              >
                                {launchingTaskKey === launchKey
                                  ? 'Opening...'
                                  : 'Read Online'}
                              </button>

                              <button
                                type="button"
                                disabled={!isOnline}
                                onClick={() =>
                                  void handleSaveBookOffline(
                                    record,
                                    fmt,
                                    remoteUpdatedAtMs
                                  )
                                }
                                className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-elevated)] disabled:opacity-40 text-xs font-semibold text-[var(--text-main)] transition-colors whitespace-nowrap"
                              >
                                <Download
                                  className="w-3.5 h-3.5 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>Save Offline</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}

          {/* B. Purchased Exam Rows (ExamPackDocument — Set-1 Pinned + Collapsible Sets 2..N) */}
          {visibleExamRows.map((row) => {
            const {
              record,
              sets,
              isPackSavedOffline,
              hasUpdateAvailable,
              remoteUpdatedAtMs,
            } = row;
            const firstSet = sets[0];
            const remainingSets = sets.slice(1);

            // Quick-launch target for Header [ Attempt Online ]: resume last in_progress set or Set 1
            const resumableMatch = sets.find(
              (s) => resumableSets[`${record.urlSlug}::${s.id}`]
            );
            const quickOnlineSetId =
              resumableMatch?.id || firstSet?.id || 'exam_set_1';

            const packTaskKey = `exam:${record.itemId}`;
            const activePackPct = downloadProgress[packTaskKey];
            const isSavingPack = typeof activePackPct === 'number';
            const headerLaunchKey = `launch:exam:${record.itemId}:${quickOnlineSetId}`;

            const effectivePackOffline =
              isPackSavedOffline &&
              (!isOnline || (examOfflineReadyToggle[record.itemId] ?? true));

            const renderSetRow = (
              mockSet: MocktestTitleItem,
              isLastBranch: boolean
            ) => {
              const isResumable = Boolean(
                resumableSets[`${record.urlSlug}::${mockSet.id}`]
              );
              const setLaunchKey = `launch:exam:${record.itemId}:${mockSet.id}`;
              const setSource: 'online' | 'offline' = effectivePackOffline
                ? 'offline'
                : 'online';
              const canAttemptSet = isOnline || isPackSavedOffline;

              return (
                <div
                  key={mockSet.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2 border-t border-[var(--border-subtle)]/70 first:border-t-0"
                >
                  <div className="min-w-0 flex items-baseline gap-2">
                    <span
                      aria-hidden="true"
                      className="font-mono text-xs text-[var(--text-muted)] shrink-0 select-none"
                    >
                      {isLastBranch ? '└─' : '├─'}
                    </span>
                    <div className="min-w-0 text-xs sm:text-sm">
                      <span className="font-semibold text-[var(--text-main)]">
                        {mockSet.title}
                      </span>{' '}
                      <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                        ({mockSet.duration}m · {mockSet.totalQuestions}Q ·{' '}
                        {mockSet.totalMarks}M)
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={
                      !canAttemptSet || launchingTaskKey === setLaunchKey
                    }
                    onClick={() =>
                      void handleLaunchExamSet(record, mockSet.id, setSource)
                    }
                    className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-elevated)] disabled:opacity-40 text-xs font-semibold text-[var(--text-main)] transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
                  >
                    <span>
                      {launchingTaskKey === setLaunchKey
                        ? 'Opening...'
                        : isResumable
                        ? 'Resume'
                        : 'Attempt Now'}
                    </span>
                    <ArrowRight
                      className="w-3.5 h-3.5 shrink-0"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              );
            };

            return (
              <div
                key={record.purchaseId}
                role="listitem"
                className="p-3.5 sm:p-4 space-y-3"
              >
                {/* Pack Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <MonogramThumbnail
                      title={record.title}
                      type="EX"
                      collectionName="ExamPackDocument"
                      size="xs"
                      showBadge={false}
                    />
                    <h2 className="text-sm sm:text-base font-bold text-[var(--text-main)] line-clamp-1 sm:line-clamp-2 leading-snug">
                      {record.title}
                    </h2>
                  </div>

                  {/* Pack Header Actions */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0 sm:ms-auto">
                    <button
                      type="button"
                      disabled={
                        !isOnline || launchingTaskKey === headerLaunchKey
                      }
                      onClick={() =>
                        void handleLaunchExamSet(
                          record,
                          quickOnlineSetId,
                          'online'
                        )
                      }
                      className="inline-flex items-center justify-center min-h-[48px] px-3.5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity whitespace-nowrap"
                    >
                      {launchingTaskKey === headerLaunchKey
                        ? 'Opening...'
                        : resumableMatch
                        ? 'Resume Online'
                        : 'Attempt Online'}
                    </button>

                    {isSavingPack ? (
                      <button
                        type="button"
                        onClick={() => cancelActiveDownload(packTaskKey)}
                        aria-label={`Cancel exam pack download (${activePackPct}%)`}
                        className="inline-flex items-center justify-center gap-2 min-h-[48px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-main)] whitespace-nowrap"
                      >
                        <Loader2
                          className="w-3.5 h-3.5 animate-spin shrink-0"
                          aria-hidden="true"
                        />
                        <span>Saving {activePackPct}%</span>
                        <X
                          className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0"
                          aria-hidden="true"
                        />
                      </button>
                    ) : isPackSavedOffline ? (
                      <div className="inline-flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          aria-pressed={effectivePackOffline}
                          disabled={!isOnline}
                          onClick={() =>
                            setExamOfflineReadyToggle((prev) => ({
                              ...prev,
                              [record.itemId]: !(
                                prev[record.itemId] ?? true
                              ),
                            }))
                          }
                          className={cn(
                            'inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap',
                            effectivePackOffline
                              ? 'border-[var(--status-success)] bg-[var(--status-success)] text-white'
                              : 'border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)]'
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className="w-2 h-2 rounded-full bg-current shrink-0"
                          />
                          <span>Offline Ready</span>
                        </button>

                        {hasUpdateAvailable && isOnline && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleSaveExamPackOffline(
                                record,
                                remoteUpdatedAtMs
                              )
                            }
                            aria-label={`Update offline exam sets for ${record.title}`}
                            className="inline-flex items-center justify-center gap-1 min-h-[48px] px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-elevated)] text-xs font-semibold text-[var(--text-main)] whitespace-nowrap"
                          >
                            <RefreshCw
                              className="w-3.5 h-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            <span>Update</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            void handleDeleteExamPackOffline(record)
                          }
                          aria-label={`Delete offline exam sets for ${record.title}`}
                          className="inline-flex items-center justify-center min-h-[48px] min-w-[48px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--status-danger)] hover:border-[var(--status-danger)] transition-colors"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={!isOnline}
                        onClick={() =>
                          void handleSaveExamPackOffline(
                            record,
                            remoteUpdatedAtMs
                          )
                        }
                        className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-elevated)] disabled:opacity-40 text-xs font-semibold text-[var(--text-main)] transition-colors whitespace-nowrap"
                      >
                        <Download
                          className="w-3.5 h-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span>Save Offline</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Set-1 Always Pinned + Collapsible Sets 2..N */}
                {firstSet && (
                  <div className="ps-2 sm:ps-14 space-y-1">
                    {renderSetRow(firstSet, remainingSets.length === 0)}

                    {remainingSets.length > 0 && (
                      <details className="group">
                        <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none inline-flex items-center gap-2 min-h-[48px] px-2 -ms-2 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)]/60 transition-colors">
                          <span
                            aria-hidden="true"
                            className="font-mono text-[var(--text-muted)]"
                          >
                            └─
                          </span>
                          <ChevronDown
                            className="w-3.5 h-3.5 transition-transform duration-150 group-open:rotate-180 shrink-0"
                            aria-hidden="true"
                          />
                          <span>
                            Show {remainingSets.length} More Mock{' '}
                            {remainingSets.length === 1 ? 'Set' : 'Sets'}
                          </span>
                        </summary>

                        <div className="ps-4 sm:ps-6 pt-1 divide-y divide-[var(--border-subtle)]/70">
                          {remainingSets.map((s, idx) =>
                            renderSetRow(s, idx === remainingSets.length - 1)
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
