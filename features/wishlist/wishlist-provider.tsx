'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiUrl } from '../../lib/platform/api-base';
import {
  makeCompositeKey,
  makeFirestoreSafeCartKey,
} from '../../lib/registry/content-type-registry';
import type {
  CatalogCardDTO,
  CatalogItemDTO,
  CollectionName,
  WishlistItem,
} from '../../lib/types/catalog';
import { useAuth } from '../auth/auth-provider';
import { useToast } from '../toast/toast-context';

export interface WishlistTargetItem {
  id: string;
  collectionName: CollectionName;
  urlSlug: string;
  title: string;
  authorName?: string;
  language?: string;
  type?: string;
  currency: string;
  listPrice: number;
  buyPrice: number;
  totalMocktest?: number;
}

interface WishlistContextValue {
  items: WishlistItem[];
  wishlistCount: number;
  isSyncing: boolean;
  isWishlisted: (compositeKey: string) => boolean;
  toggleWishlist: (
    item: CatalogCardDTO | CatalogItemDTO | WishlistTargetItem
  ) => void;
  removeFromWishlist: (compositeKey: string) => void;
  clearWishlist: () => void;
}

const WishlistContext = createContext<WishlistContextValue>({
  items: [],
  wishlistCount: 0,
  isSyncing: false,
  isWishlisted: () => false,
  toggleWishlist: () => {},
  removeFromWishlist: () => {},
  clearWishlist: () => {},
});

const WISHLIST_STORAGE_KEY = 'ed-wishlist-v1';
const WISHLIST_EVENT = 'ed-wishlist-change';
const EMPTY_RAW = '[]';

function getWishlistRawSnapshot(): string {
  if (typeof window === 'undefined') return EMPTY_RAW;
  try {
    return localStorage.getItem(WISHLIST_STORAGE_KEY) || EMPTY_RAW;
  } catch {
    return EMPTY_RAW;
  }
}

function writeWishlistStorage(nextItems: WishlistItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(nextItems));
  } catch {
    // Ignore storage quota errors
  }
  window.dispatchEvent(new Event(WISHLIST_EVENT));
}

function parseStoredWishlist(raw: string): WishlistItem[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as WishlistItem[]).filter(
      (i) => i && typeof i.compositeKey === 'string' && typeof i.id === 'string'
    );
  } catch {
    return [];
  }
}

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const { user, getIdToken } = useAuth();
  const { showToast } = useToast();
  const [rawStore, setRawStore] = useState<string>(EMPTY_RAW);
  const [isSyncing, setIsSyncing] = useState(false);

  const syncedUidRef = useRef<string | null>(null);
  const getIdTokenRef = useRef(getIdToken);
  useEffect(() => {
    getIdTokenRef.current = getIdToken;
  }, [getIdToken]);

  useEffect(() => {
    const syncLocal = () => {
      setRawStore(getWishlistRawSnapshot());
    };
    syncLocal();
    window.addEventListener(WISHLIST_EVENT, syncLocal);
    window.addEventListener('storage', syncLocal);
    return () => {
      window.removeEventListener(WISHLIST_EVENT, syncLocal);
      window.removeEventListener('storage', syncLocal);
    };
  }, []);

  const items = useMemo(() => parseStoredWishlist(rawStore), [rawStore]);

  const activeUid = user?.uid || null;

  // Hydrate and merge cloud wishlist when user signs in
  useEffect(() => {
    if (!activeUid) {
      syncedUidRef.current = null;
      return;
    }
    if (syncedUidRef.current === activeUid) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    let cancelled = false;
    syncedUidRef.current = activeUid;

    void (async () => {
      setIsSyncing(true);
      try {
        const token = await getIdTokenRef.current();
        if (!token || cancelled) return;

        const res = await fetch(apiUrl('/api/v1/wishlist'), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-store',
          },
          cache: 'no-store',
        });

        if (!res.ok || cancelled) return;
        const payload = (await res.json().catch(() => ({}))) as {
          items?: WishlistItem[];
        };
        const cloudItems = Array.isArray(payload.items) ? payload.items : [];
        const localItems = parseStoredWishlist(getWishlistRawSnapshot());

        const mergedByKey = new Map<string, WishlistItem>();
        for (const item of cloudItems) {
          mergedByKey.set(item.compositeKey, item);
        }

        // Push any guest/local wishlist items not yet in cloud
        const cloudKeys = new Set(cloudItems.map((c) => c.compositeKey));
        const localOnly: WishlistItem[] = [];
        for (const item of localItems) {
          if (!mergedByKey.has(item.compositeKey)) {
            mergedByKey.set(item.compositeKey, item);
          }
          if (!cloudKeys.has(item.compositeKey)) {
            localOnly.push(item);
          }
        }

        const mergedList = Array.from(mergedByKey.values()).sort(
          (a, b) =>
            new Date(b.createdAtIso).getTime() -
            new Date(a.createdAtIso).getTime()
        );

        if (!cancelled) {
          writeWishlistStorage(mergedList);
        }

        if (localOnly.length > 0 && !cancelled) {
          await Promise.all(
            localOnly.slice(0, 20).map((item) =>
              fetch(apiUrl('/api/v1/wishlist'), {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(item),
              }).catch(() => {})
            )
          );
        }
      } catch {
        // Offline or transient failure — retain local wishlist
      } finally {
        if (!cancelled) setIsSyncing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeUid]);

  const wishlistedSet = useMemo(
    () => new Set(items.map((i) => i.compositeKey)),
    [items]
  );

  const isWishlisted = useCallback(
    (compositeKey: string) => wishlistedSet.has(compositeKey),
    [wishlistedSet]
  );

  const syncAddToCloud = useCallback(async (newItem: WishlistItem) => {
    if (!activeUid) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      const token = await getIdTokenRef.current();
      if (!token) return;
      await fetch(apiUrl('/api/v1/wishlist'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newItem),
      });
    } catch {
      // Local state already persisted
    }
  }, [activeUid]);

  const syncRemoveFromCloud = useCallback(
    async (wishlistKey: string) => {
      if (!activeUid) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      try {
        const token = await getIdTokenRef.current();
        if (!token) return;
        await fetch(
          `${apiUrl('/api/v1/wishlist')}?wishlistKey=${encodeURIComponent(
            wishlistKey
          )}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
      } catch {
        // Local state already updated
      }
    },
    [activeUid]
  );

  const removeFromWishlist = useCallback(
    (compositeKey: string) => {
      const target = items.find((i) => i.compositeKey === compositeKey);
      if (!target) return;
      writeWishlistStorage(items.filter((i) => i.compositeKey !== compositeKey));
      void syncRemoveFromCloud(target.wishlistKey);
      showToast(`Removed "${target.title}" from wishlist`);
    },
    [items, showToast, syncRemoveFromCloud]
  );

  const toggleWishlist = useCallback(
    (catalogItem: CatalogCardDTO | CatalogItemDTO | WishlistTargetItem) => {
      const compositeKey = makeCompositeKey(
        catalogItem.collectionName,
        catalogItem.id
      );

      if (wishlistedSet.has(compositeKey)) {
        removeFromWishlist(compositeKey);
        return;
      }

      const totalMocktest =
        'totalMocktest' in catalogItem &&
        typeof catalogItem.totalMocktest === 'number'
          ? catalogItem.totalMocktest
          : undefined;

      const newItem: WishlistItem = {
        compositeKey,
        wishlistKey: makeFirestoreSafeCartKey(
          catalogItem.collectionName,
          catalogItem.id
        ),
        id: catalogItem.id,
        collectionName: catalogItem.collectionName,
        urlSlug: catalogItem.urlSlug,
        title: catalogItem.title,
        authorName: catalogItem.authorName || 'ExamDash',
        language: catalogItem.language || 'English',
        type:
          catalogItem.type ||
          (catalogItem.collectionName === 'ExamPackDocument' ? 'Exam' : 'Ebook'),
        currency: (catalogItem.currency || 'INR').toUpperCase(),
        listPrice: catalogItem.listPrice,
        buyPrice: catalogItem.buyPrice,
        ...(totalMocktest !== undefined ? { totalMocktest } : {}),
        createdAtIso: new Date().toISOString(),
      };

      writeWishlistStorage([newItem, ...items]);
      void syncAddToCloud(newItem);
      showToast(`Saved "${catalogItem.title}" to wishlist`, 'success');
    },
    [items, removeFromWishlist, showToast, syncAddToCloud, wishlistedSet]
  );

  const clearWishlist = useCallback(() => {
    const existing = [...items];
    writeWishlistStorage([]);
    for (const item of existing) {
      void syncRemoveFromCloud(item.wishlistKey);
    }
    showToast('Cleared wishlist');
  }, [items, showToast, syncRemoveFromCloud]);

  return (
    <WishlistContext.Provider
      value={{
        items,
        wishlistCount: items.length,
        isSyncing,
        isWishlisted,
        toggleWishlist,
        removeFromWishlist,
        clearWishlist,
      }}
    >
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  return useContext(WishlistContext);
}
