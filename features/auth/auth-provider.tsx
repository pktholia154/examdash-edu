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
import {
  deleteCurrentAuthUserAdapter,
  getActiveAuthUser,
  signInWithGoogleAdapter,
  signOutPlatformAdapter,
  subscribeLazyAuthState,
  type AppAuthUser,
} from '../../lib/auth/auth-adapter';
import { apiUrl } from '../../lib/platform/api-base';
import {
  readPersistedAuthHint,
  requestPersistentWebStorage,
  writePersistedAuthHint,
} from '../../lib/platform/capacitor-bridge';
import { makeCompositeKey } from '../../lib/registry/content-type-registry';
import type { UserPurchaseRecord } from '../../lib/types/catalog';
import {
  filterActivePurchases,
  resolvePurchaseExpiryMeta,
} from '../../lib/validity/pricing';
import { useToast } from '../toast/toast-context';

interface AuthContextValue {
  user: AppAuthUser | null;
  isAuthReady: boolean;
  isRestoringSession: boolean;
  isEntitlementsReady: boolean;
  isSigningIn: boolean;
  purchases: UserPurchaseRecord[];
  ownedCompositeKeys: Set<string>;
  ownedSlugs: Set<string>;
  signInWithGoogle: () => Promise<AppAuthUser | null>;
  signOutUser: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  mergeVerifiedPurchases: (records: UserPurchaseRecord[]) => void;
  refreshLibraryEntitlements: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthReady: false,
  isRestoringSession: false,
  isEntitlementsReady: false,
  isSigningIn: false,
  purchases: [],
  ownedCompositeKeys: new Set(),
  ownedSlugs: new Set(),
  signInWithGoogle: async () => null,
  signOutUser: async () => {},
  deleteAccount: async () => {},
  mergeVerifiedPurchases: () => {},
  refreshLibraryEntitlements: async () => {},
  getIdToken: async () => null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppAuthUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(false);
  const [isEntitlementsReady, setIsEntitlementsReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [purchases, setPurchases] = useState<UserPurchaseRecord[]>([]);
  const { showToast } = useToast();

  const authUnsubRef = useRef<(() => void) | null>(null);
  const fetchedUidRef = useRef<string | null>(null);

  const purgeExpiredPurchasesLocally = useCallback(
    async (uid: string, expiredRecords: UserPurchaseRecord[]) => {
      if (!uid || expiredRecords.length === 0) return;
      try {
        const { deleteBookAllFormatsOffline, deleteExamPackOffline } =
          await import('../../lib/offline/offline-vault');
        await Promise.allSettled(
          expiredRecords.map((rec) =>
            rec.collectionName === 'books'
              ? deleteBookAllFormatsOffline(uid, rec.itemId)
              : deleteExamPackOffline(uid, rec.itemId)
          )
        );
      } catch {
        // Non-blocking cleanup
      }
    },
    []
  );

  const fetchOneShotLibraryEntitlements = useCallback(
    async (activeUser: AppAuthUser, syncProfile: boolean = false) => {
      try {
        const { readCachedUserEntitlements, writeCachedUserEntitlements } =
          await import('../../lib/offline/offline-vault');

        // 1. Hydrate local cached entitlements immediately, stripping & purging any expired items
        const cached = await readCachedUserEntitlements(activeUser.uid);
        const { active: activeCached, expired: expiredCached } =
          filterActivePurchases(cached);
        if (expiredCached.length > 0) {
          await writeCachedUserEntitlements(activeUser.uid, activeCached);
          void purgeExpiredPurchasesLocally(activeUser.uid, expiredCached);
        }
        if (activeCached.length > 0) {
          setPurchases((prev) => (prev.length > 0 ? prev : activeCached));
        }

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          return;
        }

        // 2. One-shot authenticated GET /api/v1/library (server also deletes expired Firestore docs)
        const token = await activeUser.getIdToken();
        const endpoint = syncProfile
          ? apiUrl('/api/v1/library?syncProfile=1')
          : apiUrl('/api/v1/library');

        const res = await fetch(endpoint, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-store',
          },
          cache: 'no-store',
        });

        if (!res.ok) return;

        const data = (await res.json().catch(() => ({}))) as {
          purchases?: UserPurchaseRecord[];
        };

        if (Array.isArray(data.purchases)) {
          const { active: activeServer, expired: expiredServer } =
            filterActivePurchases(data.purchases);
          const sorted = [...activeServer].sort(
            (a, b) =>
              new Date(b.createdAtIso).getTime() -
              new Date(a.createdAtIso).getTime()
          );
          setPurchases(sorted);
          await writeCachedUserEntitlements(activeUser.uid, sorted);

          // Also purge offline vault for any previously cached item that is no longer active
          const activeIds = new Set(sorted.map((p) => p.purchaseId));
          const disappearedCached = activeCached.filter(
            (p) => !activeIds.has(p.purchaseId)
          );
          const toPurge = [...expiredServer, ...disappearedCached];
          if (toPurge.length > 0) {
            void purgeExpiredPurchasesLocally(activeUser.uid, toPurge);
          }
        }
      } catch {
        // Offline or transient network issue — cached active entitlements remain
      } finally {
        setIsEntitlementsReady(true);
      }
    },
    [purgeExpiredPurchasesLocally]
  );

  const attachLazyAuthSubscription = useCallback(async () => {
    if (authUnsubRef.current) return;

    const unsub = await subscribeLazyAuthState((current) => {
      setUser(current);
      setIsAuthReady(true);
      setIsRestoringSession(false);

      if (current) {
        void writePersistedAuthHint(true);
        void requestPersistentWebStorage();
        if (fetchedUidRef.current !== current.uid) {
          fetchedUidRef.current = current.uid;
          setIsEntitlementsReady(false);
          void fetchOneShotLibraryEntitlements(current, true);
        }
      } else {
        fetchedUidRef.current = null;
        setPurchases([]);
        setIsEntitlementsReady(true);
        void writePersistedAuthHint(false);
      }
    });

    authUnsubRef.current = unsub;
  }, [fetchOneShotLibraryEntitlements]);

  useEffect(() => {
    let cancelled = false;

    const bootAuthCheck = async () => {
      const previouslyAuthed = await readPersistedAuthHint();
      if (cancelled) return;

      // Anonymous visitors & Googlebot: zero Firebase Auth/Firestore chunks, iframes, or XHRs!
      if (!previouslyAuthed) {
        setIsAuthReady(true);
        setIsRestoringSession(false);
        setIsEntitlementsReady(true);
        return;
      }

      setIsRestoringSession(true);
      try {
        await attachLazyAuthSubscription();
      } catch {
        if (!cancelled) {
          setIsAuthReady(true);
          setIsRestoringSession(false);
          setIsEntitlementsReady(true);
        }
      }
    };

    void bootAuthCheck();

    return () => {
      cancelled = true;
      if (authUnsubRef.current) {
        authUnsubRef.current();
        authUnsubRef.current = null;
      }
    };
  }, [attachLazyAuthSubscription]);

  const signInWithGoogle = useCallback(async (): Promise<AppAuthUser | null> => {
    setIsSigningIn(true);
    try {
      const signedInUser = await signInWithGoogleAdapter();
      if (!signedInUser) return null;

      await writePersistedAuthHint(true);
      setUser(signedInUser);
      setIsAuthReady(true);
      await attachLazyAuthSubscription();

      fetchedUidRef.current = signedInUser.uid;
      await fetchOneShotLibraryEntitlements(signedInUser, true);

      showToast(
        `Signed in as ${signedInUser.displayName || signedInUser.email}`,
        'success'
      );
      return signedInUser;
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code !== 'auth/popup-closed-by-user') {
        showToast('Sign-in could not be completed. Please try again.', 'danger');
      }
      return null;
    } finally {
      setIsSigningIn(false);
    }
  }, [attachLazyAuthSubscription, fetchOneShotLibraryEntitlements, showToast]);

  const signOutUser = useCallback(async () => {
    const activeUid = user?.uid || (await getActiveAuthUser().catch(() => null))?.uid || '';
    fetchedUidRef.current = null;
    await writePersistedAuthHint(false);
    if (activeUid) {
      const [{ purgeOfflineVaultForUser }, { purgeUserExamLocalState }] =
        await Promise.all([
          import('../../lib/offline/offline-vault'),
          import('../../lib/exam/storage'),
        ]);
      await purgeOfflineVaultForUser(activeUid).catch(() => {});
      purgeUserExamLocalState(activeUid);
    }
    await signOutPlatformAdapter().catch(() => {});
    setUser(null);
    setPurchases([]);
    showToast('Signed out of ExamDash');
  }, [showToast, user?.uid]);

  const deleteAccount = useCallback(async () => {
    const activeUser = user || (await getActiveAuthUser().catch(() => null));
    if (!activeUser) return;
    const uid = activeUser.uid;
    try {
      const token = await activeUser.getIdToken().catch(() => null);
      if (token) {
        await fetch(apiUrl('/api/v1/library'), {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
      const [{ purgeOfflineVaultForUser }, { purgeUserExamLocalState }] =
        await Promise.all([
          import('../../lib/offline/offline-vault'),
          import('../../lib/exam/storage'),
        ]);
      await purgeOfflineVaultForUser(uid).catch(() => {});
      purgeUserExamLocalState(uid);
      await writePersistedAuthHint(false);
      await deleteCurrentAuthUserAdapter();
      fetchedUidRef.current = null;
      setUser(null);
      setPurchases([]);
      showToast('Your ExamDash account and profile data have been deleted.', 'success');
    } catch {
      showToast(
        'Please sign in again before deleting your account for security verification.',
        'danger'
      );
    }
  }, [showToast, user]);

  const mergeVerifiedPurchases = useCallback(
    (incomingRecords: UserPurchaseRecord[]) => {
      if (!Array.isArray(incomingRecords) || incomingRecords.length === 0) return;
      const targetUid = incomingRecords[0]?.userId || user?.uid || '';
      setPurchases((prev) => {
        const byId = new Map<string, UserPurchaseRecord>();
        for (const item of prev) {
          byId.set(item.purchaseId, item);
        }
        for (const item of incomingRecords) {
          byId.set(item.purchaseId, item);
        }
        const { active: merged, expired } = filterActivePurchases(
          Array.from(byId.values())
        );
        merged.sort(
          (a, b) =>
            new Date(b.createdAtIso).getTime() -
            new Date(a.createdAtIso).getTime()
        );
        if (targetUid) {
          void import('../../lib/offline/offline-vault').then(
            ({ writeCachedUserEntitlements }) =>
              writeCachedUserEntitlements(targetUid, merged)
          );
          if (expired.length > 0) {
            void purgeExpiredPurchasesLocally(targetUid, expired);
          }
        }
        return merged;
      });
    },
    [purgeExpiredPurchasesLocally, user?.uid]
  );

  // Reactive expiry timer: removes products immediately when their validity expires
  const soonestExpiryMs = useMemo(() => {
    if (!user || purchases.length === 0) return null;
    let soonest = Number.POSITIVE_INFINITY;
    for (const p of purchases) {
      const meta = resolvePurchaseExpiryMeta(p);
      if (meta.expiresAtMs < soonest) {
        soonest = meta.expiresAtMs;
      }
    }
    return Number.isFinite(soonest) ? soonest : null;
  }, [purchases, user]);

  useEffect(() => {
    if (!user || soonestExpiryMs === null) return;
    const delayMs = Math.max(
      1000,
      Math.min(soonestExpiryMs - Date.now() + 500, 2_147_483_000)
    );
    const activeUser = user;
    const timer = window.setTimeout(() => {
      let removedExpired: UserPurchaseRecord[] = [];
      let nextActive: UserPurchaseRecord[] = [];
      setPurchases((prev) => {
        const partitioned = filterActivePurchases(prev, Date.now());
        removedExpired = partitioned.expired;
        nextActive = partitioned.active;
        return partitioned.expired.length > 0 ? partitioned.active : prev;
      });
      if (removedExpired.length > 0) {
        void import('../../lib/offline/offline-vault').then(
          ({ writeCachedUserEntitlements }) =>
            writeCachedUserEntitlements(activeUser.uid, nextActive)
        );
        void purgeExpiredPurchasesLocally(activeUser.uid, removedExpired);
        if (typeof navigator === 'undefined' || navigator.onLine !== false) {
          void fetchOneShotLibraryEntitlements(activeUser, false);
        }
      }
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [
    fetchOneShotLibraryEntitlements,
    purgeExpiredPurchasesLocally,
    soonestExpiryMs,
    user,
  ]);

  const refreshLibraryEntitlements = useCallback(async () => {
    if (!user) return;
    await fetchOneShotLibraryEntitlements(user, false);
  }, [fetchOneShotLibraryEntitlements, user]);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    const active = user || (await getActiveAuthUser().catch(() => null));
    if (!active) return null;
    try {
      return await active.getIdToken();
    } catch {
      return null;
    }
  }, [user]);

  const activePurchases = useMemo(
    () => (user ? purchases : []),
    [purchases, user]
  );

  const ownedCompositeKeys = useMemo(() => {
    const set = new Set<string>();
    for (const p of activePurchases) {
      set.add(makeCompositeKey(p.collectionName, p.itemId));
    }
    return set;
  }, [activePurchases]);

  const ownedSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const p of activePurchases) {
      set.add(`${p.collectionName}:${p.urlSlug}`);
    }
    return set;
  }, [activePurchases]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthReady,
        isRestoringSession,
        isEntitlementsReady,
        isSigningIn,
        purchases: activePurchases,
        ownedCompositeKeys,
        ownedSlugs,
        signInWithGoogle,
        signOutUser,
        deleteAccount,
        mergeVerifiedPurchases,
        refreshLibraryEntitlements,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
