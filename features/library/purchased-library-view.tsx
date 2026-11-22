'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  Download,
  HardDrive,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { MonogramThumbnail } from '../../components/ui/monogram-thumbnail';
import { EmptyState } from '../../components/ui/state-blocks';
import { formatDurationCompact } from '../../lib/exam/grading';
import {
  EXAM_ATTEMPTS_UPDATED_EVENT,
  fetchAndMergeCloudExamAttempts,
  getHistoricalAttemptsSync,
  loadExamSessionSync,
} from '../../lib/exam/storage';
import type { HistoricalExamAttemptRecord } from '../../lib/exam/types';
import {
  clearAllUserOfflineAssets,
  deleteBookAllFormatsOffline,
  deleteExamPackOffline,
  formatBytesCompact,
  getStorageUsageSummary,
  listUserOfflineAssets,
  OFFLINE_VAULT_UPDATED_EVENT,
  requestSignedAssetUnlock,
  saveBookAllFormatsOffline,
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
  type?: string;
  category?: string;
  language?: string;
  hasFullPdf: boolean;
  hasFullMarkdown: boolean;
  updatedAtMs: number;
}

export interface PurchasedExamCatalogMeta {
  id: string;
  urlSlug: string;
  type?: string;
  category?: string;
  language?: string;
  totalMocktest: number;
  hasFullJson: boolean;
  updatedAtMs: number;
  mocktestTitles: MocktestTitleItem[];
}

type LibraryFilterTab = 'all' | 'books' | 'exams' | 'offline';

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

function formatPurchaseDateShort(iso: string): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(ms));
  } catch {
    return '';
  }
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
    isEntitlementsReady,
    isSigningIn,
    purchases,
    signInWithGoogle,
    refreshLibraryEntitlements,
    getIdToken,
  } = useAuth();
  const { showToast } = useToast();

  const isOnline = useSyncExternalStore(
    subscribeNetworkStatus,
    getNetworkSnapshot,
    () => true
  );

  const [filterTab, setFilterTab] = useState<LibraryFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSyncingEntitlements, setIsSyncingEntitlements] = useState(false);

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
  const [bookSourcePref, setBookSourcePref] = useState<
    Record<string, 'online' | 'offline'>
  >({});
  const [examOfflineReadyToggle, setExamOfflineReadyToggle] = useState<
    Record<string, boolean>
  >({});
  const [expandedRemainingSets, setExpandedRemainingSets] = useState<
    Record<string, boolean>
  >({});

  // Track resumable in-progress exam set IDs & full historical attempt records
  const [resumableSets, setResumableSets] = useState<Record<string, boolean>>(
    {}
  );
  const [historicalAttempts, setHistoricalAttempts] = useState<
    HistoricalExamAttemptRecord[]
  >([]);

  const getIdTokenRef = useRef(getIdToken);
  useEffect(() => {
    getIdTokenRef.current = getIdToken;
  }, [getIdToken]);

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

  // Resolve 0ms Book rows with full format & offline bundle awareness
  const resolvedBookRows = useMemo(() => {
    return bookPurchases.map((record) => {
      const meta =
        booksMetaById.get(record.itemId) || booksMetaById.get(record.urlSlug);
      const hasFullPdf = meta ? meta.hasFullPdf : true;
      const hasFullMarkdown = meta ? meta.hasFullMarkdown : false;

      const savedPdf = savedBookAssetsMap.get(`${record.itemId}::pdf`);
      const savedMd = savedBookAssetsMap.get(`${record.itemId}::markdown`);

      const requiredFormats: Array<'pdf' | 'markdown'> = [];
      if (hasFullPdf) requiredFormats.push('pdf');
      if (hasFullMarkdown) requiredFormats.push('markdown');
      if (requiredFormats.length === 0) requiredFormats.push('pdf');

      const hasAnySavedFormat = Boolean(savedPdf || savedMd);
      const isAllRequiredSaved = requiredFormats.every((fmt) =>
        fmt === 'pdf' ? Boolean(savedPdf) : Boolean(savedMd)
      );

      const savedBytes =
        (savedPdf?.byteSize || 0) + (savedMd?.byteSize || 0);
      const remoteUpdatedAtMs = meta?.updatedAtMs || 0;

      const oldestSavedAt = Math.min(
        savedPdf ? savedPdf.savedAt : Number.POSITIVE_INFINITY,
        savedMd ? savedMd.savedAt : Number.POSITIVE_INFINITY
      );
      const oldestRemoteAt = Math.min(
        savedPdf ? savedPdf.remoteUpdatedAt : Number.POSITIVE_INFINITY,
        savedMd ? savedMd.remoteUpdatedAt : Number.POSITIVE_INFINITY
      );

      const hasUpdateAvailable =
        isAllRequiredSaved &&
        Number.isFinite(oldestSavedAt) &&
        remoteUpdatedAtMs > oldestSavedAt + 1000 &&
        remoteUpdatedAtMs > oldestRemoteAt + 1000;

      const editionLabel =
        hasFullPdf && hasFullMarkdown
          ? 'Full PDF & Markdown'
          : hasFullMarkdown
          ? 'Full Markdown Edition'
          : 'Full PDF Edition';

      return {
        record,
        meta,
        hasFullPdf,
        hasFullMarkdown,
        savedPdf,
        savedMd,
        hasAnySavedFormat,
        isAllRequiredSaved,
        savedBytes,
        remoteUpdatedAtMs,
        hasUpdateAvailable,
        editionLabel,
      };
    });
  }, [bookPurchases, booksMetaById, savedBookAssetsMap]);

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

      const savedBytes =
        manifest?.byteSize ||
        localShards.reduce((sum, s) => sum + (s.byteSize || 0), 0);

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
        catalogMeta,
        sets,
        isPackSavedOffline,
        savedBytes,
        hasUpdateAvailable,
        remoteUpdatedAtMs: latestFirestoreMs,
      };
    });
  }, [examPurchases, examsMetaById, savedExamPacksMap]);

  // Sync in-progress CBT status & historical attempt records for signed-in users
  useEffect(() => {
    if (!userId) return;
    const syncExamState = () => {
      const nextResumable: Record<string, boolean> = {};
      for (const row of resolvedExamRows) {
        for (const s of row.sets) {
          const sess = loadExamSessionSync(
            row.record.urlSlug,
            s.id,
            'full',
            userId
          );
          if (sess?.status === 'in_progress') {
            nextResumable[`${row.record.urlSlug}::${s.id}`] = true;
          }
        }
      }
      setResumableSets(nextResumable);
      setHistoricalAttempts(getHistoricalAttemptsSync(userId));
    };
    syncExamState();
    window.addEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, syncExamState);
    window.addEventListener('storage', syncExamState);
    return () => {
      window.removeEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, syncExamState);
      window.removeEventListener('storage', syncExamState);
    };
  }, [resolvedExamRows, userId]);

  // Hydrate full historical exam attempts from Firebase Firestore on mount / reconnect
  useEffect(() => {
    if (!userId || !isOnline) return;
    let active = true;
    void (async () => {
      try {
        const token = await getIdTokenRef.current();
        if (!active || !token) return;
        const merged = await fetchAndMergeCloudExamAttempts({
          bearerToken: token,
          uid: userId,
        });
        if (active) {
          setHistoricalAttempts(merged);
        }
      } catch {
        // Ignore transient network errors; local cache remains active
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, isOnline]);

  const attemptsBySetKeyMap = useMemo(() => {
    const map = new Map<string, HistoricalExamAttemptRecord[]>();
    for (const row of resolvedExamRows) {
      for (const s of row.sets) {
        const matches = historicalAttempts.filter(
          (att) =>
            att.setId === s.id &&
            (att.examSlug === row.record.urlSlug ||
              (Boolean(row.record.itemId) && att.packId === row.record.itemId))
        );
        if (matches.length > 0) {
          map.set(`${row.record.itemId}::${s.id}`, matches);
        }
      }
    }
    return map;
  }, [resolvedExamRows, historicalAttempts]);

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

  const handleSaveBookBundleOffline = async (
    record: UserPurchaseRecord,
    remoteUpdatedAtMs: number
  ) => {
    if (!user?.uid) return;
    if (!isOnline) {
      showToast('Connect to the internet to save offline files.', 'danger');
      return;
    }

    const taskKey = `book:${record.itemId}`;
    cancelActiveDownload(taskKey);
    const controller = new AbortController();
    abortControllersRef.current.set(taskKey, controller);
    setDownloadProgress((prev) => ({ ...prev, [taskKey]: 2 }));

    try {
      const savedRecords = await saveBookAllFormatsOffline({
        uid: user.uid,
        itemId: record.itemId,
        urlSlug: record.urlSlug,
        remoteUpdatedAtMs,
        getIdToken,
        signal: controller.signal,
        onProgress: (pct) => {
          setDownloadProgress((prev) => ({ ...prev, [taskKey]: pct }));
        },
      });
      setBookSourcePref((prev) => ({ ...prev, [record.itemId]: 'offline' }));
      const savedLabels = savedRecords
        .map((r) => (r.format === 'pdf' ? 'PDF' : 'Markdown'))
        .join(' & ');
      showToast(
        `Saved full ${savedLabels} ${
          savedRecords.length > 1 ? 'editions' : 'edition'
        } for offline reading.`,
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
            : 'Failed to save full book files offline.',
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

  const handleDeleteBookBundleOffline = async (record: UserPurchaseRecord) => {
    if (!user?.uid) return;
    await deleteBookAllFormatsOffline(user.uid, record.itemId);
    setBookSourcePref((prev) => ({ ...prev, [record.itemId]: 'online' }));
    showToast('Removed offline book files from device.');
  };

  const handleLaunchBookReader = async (
    row: (typeof resolvedBookRows)[number],
    source: 'online' | 'offline'
  ) => {
    if (!user?.uid) return;
    const { record, hasFullPdf, savedPdf } = row;
    setBookSourcePref((prev) => ({ ...prev, [record.itemId]: source }));

    if (source === 'offline') {
      const offlineLaunchFormat = savedPdf ? 'pdf' : 'markdown';
      router.push(
        `/read/${record.urlSlug}?mode=full&format=${offlineLaunchFormat}&source=offline`
      );
      return;
    }

    if (!isOnline) {
      if (row.hasAnySavedFormat) {
        const offlineLaunchFormat = savedPdf ? 'pdf' : 'markdown';
        router.push(
          `/read/${record.urlSlug}?mode=full&format=${offlineLaunchFormat}&source=offline`
        );
        return;
      }
      showToast(
        'Device is offline. Save this book offline while connected first.',
        'danger'
      );
      return;
    }

    const launchId = `launch:book:${record.itemId}`;
    setLaunchingTaskKey(launchId);
    try {
      const grant = await requestSignedAssetUnlock({
        uid: user.uid,
        collectionName: 'books',
        urlSlug: record.urlSlug,
        getIdToken,
      });
      const onlineFormat =
        grant.hasFullPdf ||
        Boolean(grant.assets.pdfUrl) ||
        Boolean(grant.storagePaths?.fullPdfStoragePath)
          ? 'pdf'
          : grant.hasFullMarkdown ||
            Boolean(grant.assets.markdownUrl) ||
            Boolean(grant.storagePaths?.fullMarkdownStoragePath)
          ? 'markdown'
          : hasFullPdf
          ? 'pdf'
          : 'markdown';

      router.push(
        `/read/${record.urlSlug}?mode=full&format=${onlineFormat}&source=online`
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
    remoteUpdatedAtMs: number,
    expectedSetIds: string[]
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
        expectedSetIds,
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
        `Saved & sharded ${shards.length} full mock ${
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
        `/attempt/${record.urlSlug}/${encodedSetId}?mode=full&source=offline`
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
      router.push(
        `/attempt/${record.urlSlug}/${encodedSetId}?mode=full&source=online`
      );
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

  const handleOpenSetAttemptHistory = (
    record: UserPurchaseRecord,
    setId: string,
    attemptId: string,
    source: 'online' | 'offline'
  ) => {
    const encodedSetId = encodeURIComponent(setId);
    const encodedAttemptId = encodeURIComponent(attemptId);
    router.push(
      `/attempt/${record.urlSlug}/${encodedSetId}?mode=full&source=${source}&view=review&attemptId=${encodedAttemptId}`
    );
  };

  const handleSyncEntitlements = async () => {
    if (!isOnline) {
      showToast('Reconnect to sync your latest cloud purchases.', 'danger');
      return;
    }
    setIsSyncingEntitlements(true);
    try {
      const syncTasks: Promise<unknown>[] = [
        refreshLibraryEntitlements(),
        refreshVaultSnapshot(),
      ];
      if (user?.uid) {
        syncTasks.push(
          getIdToken().then((token) =>
            token
              ? fetchAndMergeCloudExamAttempts({
                  bearerToken: token,
                  uid: user.uid,
                }).then((merged) => setHistoricalAttempts(merged))
              : undefined
          )
        );
      }
      await Promise.all(syncTasks);
      showToast('Library purchases and exam history synced.', 'success');
    } finally {
      setIsSyncingEntitlements(false);
    }
  };

  const handleClearAllCache = async () => {
    if (!user?.uid) return;
    setIsClearingCache(true);
    try {
      await clearAllUserOfflineAssets(user.uid);
      setBookSourcePref({});
      setExamOfflineReadyToggle({});
      setManageStorageOpen(false);
      showToast('Cleared all offline files from local storage.', 'success');
    } finally {
      setIsClearingCache(false);
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();

  // Filtered Lists (Tab + Search Query)
  const visibleBookRows = useMemo(() => {
    if (filterTab === 'exams') return [];
    return resolvedBookRows.filter((row) => {
      if (filterTab === 'offline' && !row.hasAnySavedFormat) {
        return false;
      }
      if (normalizedQuery) {
        const hay = `${row.record.title} ${row.meta?.category || ''} ${
          row.meta?.language || row.record.language || ''
        }`.toLowerCase();
        if (!hay.includes(normalizedQuery)) return false;
      }
      return true;
    });
  }, [filterTab, normalizedQuery, resolvedBookRows]);

  const visibleExamRows = useMemo(() => {
    if (filterTab === 'books') return [];
    return resolvedExamRows.filter((row) => {
      if (filterTab === 'offline' && !row.isPackSavedOffline) {
        return false;
      }
      if (normalizedQuery) {
        const setNames = row.sets.map((s) => s.title).join(' ');
        const hay = `${row.record.title} ${row.catalogMeta?.category || ''} ${
          row.catalogMeta?.language || row.record.language || ''
        } ${setNames}`.toLowerCase();
        if (!hay.includes(normalizedQuery)) return false;
      }
      return true;
    });
  }, [filterTab, normalizedQuery, resolvedExamRows]);

  const savedItemCount = useMemo(() => {
    let count = 0;
    for (const b of resolvedBookRows) {
      if (b.hasAnySavedFormat) count += 1;
    }
    for (const e of resolvedExamRows) {
      if (e.isPackSavedOffline) count += 1;
    }
    return count;
  }, [resolvedBookRows, resolvedExamRows]);

  if (!isAuthReady || (user && !isEntitlementsReady && purchases.length === 0)) {
    return (
      <div className="ed-container py-8 space-y-3">
        <div className="h-14 w-full rounded-xl ed-skeleton" />
        <div className="h-28 w-full rounded-xl ed-skeleton" />
        <div className="h-32 w-full rounded-xl ed-skeleton" />
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
            Authenticate with Google to view your unlocked full ebooks and mock
            test packs across online and offline study modes.
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
      {/* Header Row */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[var(--text-main)]">
            Purchased Library
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-[var(--text-muted)] tabular-nums">
            <span>
              {totalPurchasesCount}{' '}
              {totalPurchasesCount === 1 ? 'Item' : 'Items'} Unlocked
            </span>
            {bookPurchases.length > 0 && (
              <>
                <span aria-hidden="true"> · </span>
                <span>
                  {bookPurchases.length}{' '}
                  {bookPurchases.length === 1 ? 'Book' : 'Books'}
                </span>
              </>
            )}
            {examPurchases.length > 0 && (
              <>
                <span aria-hidden="true"> · </span>
                <span>
                  {examPurchases.length}{' '}
                  {examPurchases.length === 1 ? 'Exam Pack' : 'Exam Packs'}
                </span>
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          disabled={!isOnline || isSyncingEntitlements}
          onClick={() => void handleSyncEntitlements()}
          className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] disabled:opacity-40 text-xs font-semibold text-[var(--text-main)] transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw
            className={cn(
              'w-3.5 h-3.5 text-[var(--text-muted)] shrink-0',
              isSyncingEntitlements && 'animate-spin'
            )}
            aria-hidden="true"
          />
          <span>{isSyncingEntitlements ? 'Syncing...' : 'Sync Purchases'}</span>
        </button>
      </div>

      {/* Top Control Bar: Filter Tabs + Search + Offline Vault Storage */}
      <div
        role="region"
        aria-label="Purchased library controls"
        className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:p-3.5 space-y-3 tabular-nums"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Interactive Filter Tabs */}
          <div
            role="tablist"
            aria-label="Filter library items"
            className="flex items-center gap-1 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1"
          >
            {(
              [
                { id: 'all', label: `All (${totalPurchasesCount})` },
                { id: 'books', label: `Books (${bookPurchases.length})` },
                { id: 'exams', label: `Exams (${examPurchases.length})` },
                {
                  id: 'offline',
                  label: `Saved Offline (${savedItemCount})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filterTab === tab.id}
                onClick={() => setFilterTab(tab.id)}
                className={cn(
                  'min-h-[44px] px-3 sm:px-3.5 rounded-md text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0',
                  filterTab === tab.id
                    ? 'bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-subtle)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)] border border-transparent'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search + Network + Vault Storage */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
            {totalPurchasesCount > 1 && (
              <div className="relative flex-1 sm:w-60 min-w-[180px]">
                <Search
                  className="w-4 h-4 text-[var(--text-muted)] absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter unlocked items..."
                  aria-label="Filter unlocked items"
                  className="w-full min-h-[44px] ps-9 pe-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-base sm:text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand-primary)]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear filter query"
                    className="absolute end-1.5 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)]"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

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

            <button
              type="button"
              aria-expanded={manageStorageOpen}
              onClick={() => setManageStorageOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-elevated)] text-xs font-semibold text-[var(--text-main)] transition-colors whitespace-nowrap shrink-0 ms-auto sm:ms-0"
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

        {/* Inline Storage Management Drawer */}
        {manageStorageOpen && (
          <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="text-[var(--text-muted)]">
              <span>
                Offline Vault:{' '}
                <strong className="text-[var(--text-main)]">
                  {formatBytesCompact(storageUsage.vaultBytes)}
                </strong>{' '}
                across {storageUsage.assetCount} saved{' '}
                {storageUsage.assetCount === 1 ? 'file' : 'files'}
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
                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border border-[var(--status-danger)] text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)] disabled:opacity-40 text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{isClearingCache ? 'Clearing...' : 'Clear Cache'}</span>
              </button>
              <button
                type="button"
                onClick={() => setManageStorageOpen(false)}
                className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors whitespace-nowrap"
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
          description="Explore Books and Exam Packs to unlock full digital study editions and full-length mock test sets."
          actionLabel="Explore Catalog"
          actionHref="/"
        />
      ) : visibleBookRows.length === 0 && visibleExamRows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center space-y-3">
          <p className="text-base font-bold text-[var(--text-main)]">
            {normalizedQuery
              ? 'No purchased items match your search'
              : filterTab === 'offline'
              ? 'No items saved offline yet'
              : 'No items in this category yet'}
          </p>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] max-w-md mx-auto">
            {normalizedQuery
              ? 'Clear the search filter to see all unlocked books and exam packs.'
              : filterTab === 'offline'
              ? 'Tap Save Offline on any book or exam pack to store full PDF, Markdown, or mock exam files on this device.'
              : 'Switch back to All to view your unlocked items.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setFilterTab('all');
              setSearchQuery('');
            }}
            className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs sm:text-sm font-semibold whitespace-nowrap"
          >
            Show All Purchased Items
          </button>
        </div>
      ) : (
        /* Purchased Items List View with Larger Thumbnails */
        <div
          role="list"
          aria-label="Purchased items list"
          className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden tabular-nums"
        >
          {/* A. Purchased Book Rows (Unified Read Online + Save Offline) */}
          {visibleBookRows.map((row) => {
            const {
              record,
              meta,
              isAllRequiredSaved,
              hasAnySavedFormat,
              savedBytes,
              remoteUpdatedAtMs,
              hasUpdateAvailable,
              editionLabel,
            } = row;

            const taskKey = `book:${record.itemId}`;
            const launchKey = `launch:book:${record.itemId}`;
            const activePct = downloadProgress[taskKey];
            const isDownloading = typeof activePct === 'number';
            const isBookOfflineReady = isOnline
              ? isAllRequiredSaved
              : hasAnySavedFormat;

            const selectedMode: 'online' | 'offline' = !isOnline
              ? 'offline'
              : bookSourcePref[record.itemId] || 'offline';

            const purchasedDate = formatPurchaseDateShort(record.createdAtIso);
            const displayCategory = meta?.category || '';
            const displayLang = meta?.language || record.language || '';

            return (
              <div
                key={record.purchaseId}
                role="listitem"
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-start sm:items-center gap-4 min-w-0 flex-1">
                  <Link
                    href={`/books/${record.urlSlug}`}
                    aria-label={`View details for ${record.title}`}
                    className="shrink-0 rounded-[var(--radius-thumb)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
                  >
                    <MonogramThumbnail
                      title={record.title}
                      type={meta?.type || record.type || 'EB'}
                      collectionName="books"
                      size="list"
                      showBadge={true}
                    />
                  </Link>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Link
                      href={`/books/${record.urlSlug}`}
                      className="text-base sm:text-lg font-bold text-[var(--text-main)] hover:underline line-clamp-2 leading-snug block"
                    >
                      {record.title}
                    </Link>

                    {/* Clean Unboxed Metadata (Zero-Pill) */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]">
                      <span className="font-medium text-[var(--text-main)]">
                        {editionLabel}
                      </span>
                      {displayCategory && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{displayCategory}</span>
                        </>
                      )}
                      {displayLang && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{displayLang}</span>
                        </>
                      )}
                      {purchasedDate && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Unlocked {purchasedDate}</span>
                        </>
                      )}
                      {savedBytes > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-[var(--status-success)]">
                            Saved {formatBytesCompact(savedBytes)}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="pt-0.5">
                      <Link
                        href={`/books/${record.urlSlug}#reviews`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors whitespace-nowrap"
                      >
                        <span>Book Details & Verified Review</span>
                        <ArrowRight
                          className="w-3 h-3 shrink-0"
                          aria-hidden="true"
                        />
                      </Link>
                    </div>
                  </div>
                </div>

                {/* Single Unified Book Action Cluster */}
                <div className="flex flex-wrap items-center gap-2 shrink-0 sm:ms-4">
                  {isDownloading ? (
                    <button
                      type="button"
                      onClick={() => cancelActiveDownload(taskKey)}
                      aria-label={`Cancel offline book download (${activePct}%)`}
                      className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-xs sm:text-sm font-bold text-[var(--text-main)] whitespace-nowrap"
                    >
                      <Loader2
                        className="w-4 h-4 animate-spin shrink-0"
                        aria-hidden="true"
                      />
                      <span>Saving {activePct}%</span>
                      <X
                        className="w-4 h-4 text-[var(--text-muted)] shrink-0"
                        aria-hidden="true"
                      />
                    </button>
                  ) : isBookOfflineReady ? (
                    <div className="inline-flex flex-wrap items-center gap-2">
                      <div
                        role="group"
                        aria-label={`${record.title} reading mode`}
                        className="inline-flex items-center rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] overflow-hidden"
                      >
                        <button
                          type="button"
                          disabled={!isOnline || launchingTaskKey === launchKey}
                          onClick={() =>
                            void handleLaunchBookReader(row, 'online')
                          }
                          className={cn(
                            'inline-flex items-center justify-center min-h-[48px] px-3.5 sm:px-4 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap disabled:opacity-40',
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
                            void handleLaunchBookReader(row, 'offline')
                          }
                          className={cn(
                            'inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3.5 sm:px-4 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap',
                            selectedMode === 'offline'
                              ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                              : 'text-[var(--text-main)] hover:bg-[var(--bg-elevated)]'
                          )}
                        >
                          <Check
                            className="w-3.5 h-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span>Read Offline</span>
                        </button>
                      </div>

                      {hasUpdateAvailable && isOnline && (
                        <button
                          type="button"
                          onClick={() =>
                            void handleSaveBookBundleOffline(
                              record,
                              remoteUpdatedAtMs
                            )
                          }
                          aria-label={`Update offline files for ${record.title}`}
                          className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-elevated)] text-xs sm:text-sm font-semibold text-[var(--text-main)] whitespace-nowrap"
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
                        onClick={() => void handleDeleteBookBundleOffline(record)}
                        aria-label={`Delete offline copy of ${record.title}`}
                        className="inline-flex items-center justify-center min-h-[48px] min-w-[48px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--status-danger)] hover:border-[var(--status-danger)] transition-colors"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <div className="inline-flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!isOnline || launchingTaskKey === launchKey}
                        onClick={() =>
                          void handleLaunchBookReader(row, 'online')
                        }
                        className="inline-flex items-center justify-center min-h-[48px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs sm:text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity whitespace-nowrap"
                      >
                        {launchingTaskKey === launchKey
                          ? 'Opening...'
                          : 'Read Online'}
                      </button>

                      <button
                        type="button"
                        disabled={!isOnline}
                        onClick={() =>
                          void handleSaveBookBundleOffline(
                            record,
                            remoteUpdatedAtMs
                          )
                        }
                        className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-elevated)] disabled:opacity-40 text-xs sm:text-sm font-semibold text-[var(--text-main)] transition-colors whitespace-nowrap"
                      >
                        <Download
                          className="w-4 h-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span>Save Offline</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* B. Purchased Exam Rows (Larger Thumbnail + Full Pack Shards + Set Progress) */}
          {visibleExamRows.map((row) => {
            const {
              record,
              catalogMeta,
              sets,
              isPackSavedOffline,
              savedBytes,
              hasUpdateAvailable,
              remoteUpdatedAtMs,
            } = row;
            const firstSet = sets[0];
            const remainingSets = sets.slice(1);
            const expectedSetIds = sets.map((s) => s.id);

            // Completed stats & historical attempt counts across sets in this pack
            let completedSetsCount = 0;
            let totalPackAttemptsCount = 0;
            let bestAccuracyPct: number | null = null;
            for (const s of sets) {
              const setAttempts =
                attemptsBySetKeyMap.get(`${record.itemId}::${s.id}`) || [];
              if (setAttempts.length > 0) {
                completedSetsCount += 1;
                totalPackAttemptsCount += setAttempts.length;
                for (const att of setAttempts) {
                  const roundedAcc = Math.round(att.accuracyPct);
                  if (
                    bestAccuracyPct === null ||
                    roundedAcc > bestAccuracyPct
                  ) {
                    bestAccuracyPct = roundedAcc;
                  }
                }
              }
            }

            // Quick-launch target for Header [ Attempt Online ]: resume last in_progress set or first unattempted set or Set 1
            const resumableMatch = sets.find(
              (s) => resumableSets[`${record.urlSlug}::${s.id}`]
            );
            const nextUnattemptedSet = sets.find(
              (s) => !attemptsBySetKeyMap.has(`${record.itemId}::${s.id}`)
            );
            const quickOnlineSetId =
              resumableMatch?.id ||
              nextUnattemptedSet?.id ||
              firstSet?.id ||
              'exam_set_1';

            const packTaskKey = `exam:${record.itemId}`;
            const activePackPct = downloadProgress[packTaskKey];
            const isSavingPack = typeof activePackPct === 'number';
            const headerLaunchKey = `launch:exam:${record.itemId}:${quickOnlineSetId}`;

            const effectivePackOffline =
              isPackSavedOffline &&
              (!isOnline || (examOfflineReadyToggle[record.itemId] ?? true));

            const hasActiveOrAttemptedRemainingSet = remainingSets.some(
              (s) =>
                Boolean(resumableSets[`${record.urlSlug}::${s.id}`]) ||
                attemptsBySetKeyMap.has(`${record.itemId}::${s.id}`)
            );
            const isRemainingOpen =
              expandedRemainingSets[record.itemId] ??
              hasActiveOrAttemptedRemainingSet;

            const purchasedDate = formatPurchaseDateShort(record.createdAtIso);
            const displayCategory = catalogMeta?.category || '';

            const renderSetRow = (
              mockSet: MocktestTitleItem,
              isLastBranch: boolean
            ) => {
              const isResumable = Boolean(
                resumableSets[`${record.urlSlug}::${mockSet.id}`]
              );
              const setAttempts =
                attemptsBySetKeyMap.get(`${record.itemId}::${mockSet.id}`) ||
                [];
              const latestAttempt = setAttempts[0] || null;
              const bestScore =
                setAttempts.length > 1
                  ? setAttempts.reduce(
                      (best, cur) =>
                        cur.totalScore > best ? cur.totalScore : best,
                      setAttempts[0].totalScore
                    )
                  : null;
              const setLaunchKey = `launch:exam:${record.itemId}:${mockSet.id}`;
              const setSource: 'online' | 'offline' = effectivePackOffline
                ? 'offline'
                : 'online';
              const reviewSource: 'online' | 'offline' =
                isOnline && !effectivePackOffline ? 'online' : 'offline';
              const canAttemptSet = isOnline || isPackSavedOffline;

              return (
                <div
                  key={mockSet.id}
                  className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 py-2.5 border-t border-[var(--border-subtle)]/70 first:border-t-0"
                >
                  <div className="min-w-0 flex items-baseline gap-2">
                    <span
                      aria-hidden="true"
                      className="font-mono text-xs text-[var(--text-muted)] shrink-0 select-none"
                    >
                      {isLastBranch ? '└─' : '├─'}
                    </span>
                    <div className="min-w-0 text-xs sm:text-sm flex flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
                      <span className="font-semibold text-[var(--text-main)]">
                        {mockSet.title}
                      </span>
                      <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                        ({mockSet.duration}m · {mockSet.totalQuestions}Q ·{' '}
                        {mockSet.totalMarks}M)
                      </span>
                      {latestAttempt && (
                        <span className="text-xs font-medium text-[var(--status-success)] whitespace-nowrap">
                          · Last: {latestAttempt.totalScore}/
                          {latestAttempt.maxScore} (
                          {Math.round(latestAttempt.accuracyPct)}%) ·{' '}
                          {formatDurationCompact(
                            latestAttempt.totalTimeSpentMs
                          )}
                        </span>
                      )}
                      {setAttempts.length > 1 && bestScore !== null && (
                        <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                          · {setAttempts.length} Attempts (Best {bestScore}/
                          {latestAttempt?.maxScore ?? mockSet.totalMarks})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0 self-start lg:self-auto">
                    {latestAttempt && (
                      <button
                        type="button"
                        onClick={() =>
                          handleOpenSetAttemptHistory(
                            record,
                            mockSet.id,
                            latestAttempt.attemptId,
                            reviewSource
                          )
                        }
                        aria-label={`View full telemetry, solution review, and analysis for ${mockSet.title}`}
                        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border border-[var(--brand-primary)]/40 bg-[var(--bg-elevated)] hover:border-[var(--brand-primary)] text-xs font-semibold text-[var(--text-main)] transition-colors whitespace-nowrap shrink-0"
                      >
                        <BarChart3
                          className="w-3.5 h-3.5 text-[var(--brand-primary)] shrink-0"
                          aria-hidden="true"
                        />
                        <span>
                          {setAttempts.length > 1
                            ? `Analysis & Solutions (${setAttempts.length})`
                            : 'Analysis & Solutions'}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={
                        !canAttemptSet || launchingTaskKey === setLaunchKey
                      }
                      onClick={() =>
                        void handleLaunchExamSet(record, mockSet.id, setSource)
                      }
                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-elevated)] disabled:opacity-40 text-xs font-semibold text-[var(--text-main)] transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>
                        {launchingTaskKey === setLaunchKey
                          ? 'Opening...'
                          : isResumable
                          ? 'Resume'
                          : latestAttempt
                          ? 'Retake Set'
                          : 'Attempt Now'}
                      </span>
                      <ArrowRight
                        className="w-3.5 h-3.5 shrink-0"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>
              );
            };

            return (
              <div
                key={record.purchaseId}
                role="listitem"
                className="p-4 sm:p-5 space-y-3.5"
              >
                {/* Pack Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start sm:items-center gap-4 min-w-0 flex-1">
                    <Link
                      href={`/exams/${record.urlSlug}`}
                      aria-label={`View details for ${record.title}`}
                      className="shrink-0 rounded-[var(--radius-thumb)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
                    >
                      <MonogramThumbnail
                        title={record.title}
                        type={catalogMeta?.type || record.type || 'EX'}
                        collectionName="ExamPackDocument"
                        size="list"
                        showBadge={true}
                      />
                    </Link>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Link
                        href={`/exams/${record.urlSlug}`}
                        className="text-base sm:text-lg font-bold text-[var(--text-main)] hover:underline line-clamp-2 leading-snug block"
                      >
                        {record.title}
                      </Link>

                      {/* Clean Unboxed Metadata (Zero-Pill) */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]">
                        <span className="font-medium text-[var(--text-main)]">
                          Full Pack · {sets.length} Mock{' '}
                          {sets.length === 1 ? 'Set' : 'Sets'}
                        </span>
                        {completedSetsCount > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              Completed {completedSetsCount}/{sets.length}
                            </span>
                          </>
                        )}
                        {totalPackAttemptsCount > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {totalPackAttemptsCount}{' '}
                              {totalPackAttemptsCount === 1
                                ? 'Attempt'
                                : 'Attempts'}{' '}
                              Saved
                            </span>
                          </>
                        )}
                        {bestAccuracyPct !== null && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-[var(--status-success)]">
                              Best Accuracy {bestAccuracyPct}%
                            </span>
                          </>
                        )}
                        {displayCategory && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{displayCategory}</span>
                          </>
                        )}
                        {purchasedDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Unlocked {purchasedDate}</span>
                          </>
                        )}
                        {savedBytes > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-[var(--status-success)]">
                              Saved {formatBytesCompact(savedBytes)}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="pt-0.5">
                        <Link
                          href={`/exams/${record.urlSlug}#reviews`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors whitespace-nowrap"
                        >
                          <span>Exam Syllabus & Verified Review</span>
                          <ArrowRight
                            className="w-3 h-3 shrink-0"
                            aria-hidden="true"
                          />
                        </Link>
                      </div>
                    </div>
                  </div>

                  {/* Pack Header Actions */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0 sm:ms-4">
                    <button
                      type="button"
                      disabled={
                        (!isOnline && !isPackSavedOffline) ||
                        launchingTaskKey === headerLaunchKey
                      }
                      onClick={() =>
                        void handleLaunchExamSet(
                          record,
                          quickOnlineSetId,
                          effectivePackOffline ? 'offline' : 'online'
                        )
                      }
                      className="inline-flex items-center justify-center min-h-[48px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs sm:text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity whitespace-nowrap"
                    >
                      {launchingTaskKey === headerLaunchKey
                        ? 'Opening...'
                        : resumableMatch
                        ? effectivePackOffline
                          ? 'Resume Set'
                          : 'Resume Online'
                        : effectivePackOffline
                        ? 'Attempt Offline'
                        : 'Attempt Online'}
                    </button>

                    {isSavingPack ? (
                      <button
                        type="button"
                        onClick={() => cancelActiveDownload(packTaskKey)}
                        aria-label={`Cancel exam pack download (${activePackPct}%)`}
                        className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-xs sm:text-sm font-bold text-[var(--text-main)] whitespace-nowrap"
                      >
                        <Loader2
                          className="w-4 h-4 animate-spin shrink-0"
                          aria-hidden="true"
                        />
                        <span>Saving {activePackPct}%</span>
                        <X
                          className="w-4 h-4 text-[var(--text-muted)] shrink-0"
                          aria-hidden="true"
                        />
                      </button>
                    ) : isPackSavedOffline ? (
                      <div className="inline-flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          aria-pressed={effectivePackOffline}
                          disabled={!isOnline}
                          onClick={() =>
                            setExamOfflineReadyToggle((prev) => ({
                              ...prev,
                              [record.itemId]: !(prev[record.itemId] ?? true),
                            }))
                          }
                          className={cn(
                            'inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3.5 sm:px-4 rounded-lg border text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap',
                            effectivePackOffline
                              ? 'border-[var(--status-success)] bg-[var(--status-success)] text-white'
                              : 'border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)]'
                          )}
                        >
                          <Check
                            className="w-3.5 h-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span>Offline Ready</span>
                        </button>

                        {hasUpdateAvailable && isOnline && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleSaveExamPackOffline(
                                record,
                                remoteUpdatedAtMs,
                                expectedSetIds
                              )
                            }
                            aria-label={`Update offline exam sets for ${record.title}`}
                            className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-elevated)] text-xs sm:text-sm font-semibold text-[var(--text-main)] whitespace-nowrap"
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
                            remoteUpdatedAtMs,
                            expectedSetIds
                          )
                        }
                        className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-elevated)] disabled:opacity-40 text-xs sm:text-sm font-semibold text-[var(--text-main)] transition-colors whitespace-nowrap"
                      >
                        <Download
                          className="w-4 h-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span>Save Offline</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Set-1 Always Pinned + Expandable Sets 2..N (Auto-expanded when any remaining set has attempts or in-progress state) */}
                {firstSet && (
                  <div className="ps-2 sm:ps-28 space-y-1">
                    {renderSetRow(firstSet, remainingSets.length === 0)}

                    {remainingSets.length > 0 && (
                      <div>
                        <button
                          type="button"
                          aria-expanded={isRemainingOpen}
                          onClick={() =>
                            setExpandedRemainingSets((prev) => ({
                              ...prev,
                              [record.itemId]: !isRemainingOpen,
                            }))
                          }
                          className="inline-flex items-center gap-2 min-h-[44px] px-2 -ms-2 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)]/60 transition-colors whitespace-nowrap"
                        >
                          <span
                            aria-hidden="true"
                            className="font-mono text-[var(--text-muted)]"
                          >
                            └─
                          </span>
                          <ChevronDown
                            className={cn(
                              'w-3.5 h-3.5 transition-transform duration-150 shrink-0',
                              isRemainingOpen && 'rotate-180'
                            )}
                            aria-hidden="true"
                          />
                          <span>
                            {isRemainingOpen
                              ? `Hide ${remainingSets.length} Mock ${
                                  remainingSets.length === 1 ? 'Set' : 'Sets'
                                }`
                              : `Show ${remainingSets.length} More Mock ${
                                  remainingSets.length === 1 ? 'Set' : 'Sets'
                                }`}
                          </span>
                        </button>

                        {isRemainingOpen && (
                          <div className="ps-4 sm:ps-6 pt-1 divide-y divide-[var(--border-subtle)]/70">
                            {remainingSets.map((s, idx) =>
                              renderSetRow(s, idx === remainingSets.length - 1)
                            )}
                          </div>
                        )}
                      </div>
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
