'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  deleteUser,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  testConnection,
} from '../../lib/firebase/client';
import type { CartItem, UserPurchaseRecord } from '../../lib/types/catalog';
import { makeCompositeKey } from '../../lib/registry/content-type-registry';
import { requestPersistentWebStorage } from '../../lib/platform/capacitor-bridge';
import { useToast } from '../toast/toast-context';

interface AuthContextValue {
  user: User | null;
  isAuthReady: boolean;
  isSigningIn: boolean;
  purchases: UserPurchaseRecord[];
  ownedCompositeKeys: Set<string>;
  ownedSlugs: Set<string>;
  signInWithGoogle: () => Promise<User | null>;
  signOutUser: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  recordCompletedPurchases: (
    items: Array<
      CartItem & {
        totalMocktest?: number;
      }
    >
  ) => Promise<boolean>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthReady: false,
  isSigningIn: false,
  purchases: [],
  ownedCompositeKeys: new Set(),
  ownedSlugs: new Set(),
  signInWithGoogle: async () => null,
  signOutUser: async () => {},
  deleteAccount: async () => {},
  recordCompletedPurchases: async () => false,
  getIdToken: async () => null,
});

function sanitizeBoundedString(val: string | null | undefined, maxLen: number, fallback: string): string {
  const trimmed = (val ?? '').trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLen);
}

async function ensureUserProfileSynced(firebaseUser: User) {
  if (!firebaseUser.emailVerified) return;

  const uid = firebaseUser.uid;
  const userRef = doc(db, 'users', uid);
  const privateRef = doc(db, 'users', uid, 'private', 'contact');

  try {
    const existingSnap = await getDoc(userRef);
    const batch = writeBatch(db);
    const displayName = sanitizeBoundedString(
      firebaseUser.displayName || firebaseUser.email?.split('@')[0],
      120,
      'ExamDash Learner'
    );
    const photoURL = sanitizeBoundedString(firebaseUser.photoURL, 1024, '');

    if (!existingSnap.exists()) {
      const profilePayload: Record<string, unknown> = {
        uid,
        displayName,
        preferredView: 'grid',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (photoURL) {
        profilePayload.photoURL = photoURL;
      }
      batch.set(userRef, profilePayload);
    } else {
      const updatePayload: Record<string, unknown> = {
        displayName,
        preferredView: existingSnap.data()?.preferredView === 'list' ? 'list' : 'grid',
        updatedAt: serverTimestamp(),
      };
      if (photoURL) {
        updatePayload.photoURL = photoURL;
      }
      batch.update(userRef, updatePayload);
    }

    if (firebaseUser.email) {
      batch.set(privateRef, {
        uid,
        email: firebaseUser.email.slice(0, 254),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [purchases, setPurchases] = useState<UserPurchaseRecord[]>([]);
  const { showToast } = useToast();

  useEffect(() => {
    void testConnection();
    void requestPersistentWebStorage();

    const unsub = onAuthStateChanged(auth, (current) => {
      setUser(current);
      setIsAuthReady(true);
      if (current) {
        void ensureUserProfileSynced(current);
      } else {
        setPurchases([]);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!isAuthReady || !user) {
      return;
    }

    const purchasesPath = `users/${user.uid}/purchases`;
    const purchasesQuery = query(
      collection(db, 'users', user.uid, 'purchases'),
      where('userId', '==', user.uid)
    );

    const unsub = onSnapshot(
      purchasesQuery,
      (snap) => {
        const list: UserPurchaseRecord[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          const createdMs =
            d.createdAt && typeof d.createdAt.toMillis === 'function'
              ? d.createdAt.toMillis()
              : Date.now();
          list.push({
            purchaseId: String(d.purchaseId || docSnap.id),
            userId: String(d.userId || user.uid),
            itemId: String(d.itemId || ''),
            collectionName:
              d.collectionName === 'ExamPackDocument' ? 'ExamPackDocument' : 'books',
            urlSlug: String(d.urlSlug || ''),
            title: String(d.title || 'Untitled'),
            type: String(d.type || 'Ebook'),
            authorName: String(d.authorName || 'ExamDash'),
            language: String(d.language || 'English'),
            currency: String(d.currency || 'INR'),
            listPrice: Number(d.listPrice) || 0,
            paidPrice: Number(d.paidPrice) || 0,
            totalMocktest:
              typeof d.totalMocktest === 'number' ? d.totalMocktest : undefined,
            status: 'completed',
            createdAtIso: new Date(createdMs).toISOString(),
          });
        });
        list.sort(
          (a, b) =>
            new Date(b.createdAtIso).getTime() - new Date(a.createdAtIso).getTime()
        );
        setPurchases(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, purchasesPath);
      }
    );

    return () => unsub();
  }, [isAuthReady, user]);

  const signInWithGoogle = useCallback(async (): Promise<User | null> => {
    setIsSigningIn(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await ensureUserProfileSynced(cred.user);
      showToast(`Signed in as ${cred.user.displayName || cred.user.email}`, 'success');
      return cred.user;
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code !== 'auth/popup-closed-by-user') {
        showToast('Sign-in could not be completed. Please try again.', 'danger');
      }
      return null;
    } finally {
      setIsSigningIn(false);
    }
  }, [showToast]);

  const signOutUser = useCallback(async () => {
    await signOut(auth);
    showToast('Signed out of ExamDash');
  }, [showToast]);

  const deleteAccount = useCallback(async () => {
    const activeUser = auth.currentUser;
    if (!activeUser) return;
    const uid = activeUser.uid;
    try {
      await deleteDoc(doc(db, 'users', uid, 'private', 'contact')).catch(() => {});
      await deleteDoc(doc(db, 'users', uid)).catch(() => {});
      await deleteUser(activeUser);
      showToast('Your ExamDash account and profile data have been deleted.', 'success');
    } catch {
      showToast(
        'Please sign in again before deleting your account for security verification.',
        'danger'
      );
    }
  }, [showToast]);

  const recordCompletedPurchases = useCallback(
    async (
      items: Array<
        CartItem & {
          totalMocktest?: number;
        }
      >
    ): Promise<boolean> => {
      let activeUser = auth.currentUser;
      if (!activeUser) {
        activeUser = await signInWithGoogle();
      }
      if (!activeUser) return false;

      const uid = activeUser.uid;
      const purchasesPath = `users/${uid}/purchases`;

      try {
        await ensureUserProfileSynced(activeUser);
        const batch = writeBatch(db);

        for (const item of items) {
          const safeItemId = item.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
          const purchaseId = `${item.collectionName}_${safeItemId}`.slice(0, 120);
          const purchaseRef = doc(db, 'users', uid, 'purchases', purchaseId);

          const paidPrice = Math.max(0, Number(item.buyPrice) || 0);
          const listPrice = Math.max(paidPrice, Number(item.listPrice) || paidPrice);
          const cleanSlug = item.urlSlug
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .slice(0, 200);

          const payload: Record<string, unknown> = {
            purchaseId,
            userId: uid,
            itemId: safeItemId,
            collectionName: item.collectionName,
            urlSlug: cleanSlug || 'item',
            title: sanitizeBoundedString(item.title, 300, 'ExamDash Resource'),
            type: sanitizeBoundedString(item.type, 64, 'Ebook'),
            authorName: sanitizeBoundedString(item.authorName, 160, 'ExamDash'),
            language: sanitizeBoundedString(item.language, 64, 'English'),
            currency: /^[A-Z]{3}$/.test((item.currency || '').toUpperCase())
              ? item.currency.toUpperCase()
              : 'INR',
            listPrice,
            paidPrice,
            status: 'completed',
            createdAt: serverTimestamp(),
          };

          if (typeof item.totalMocktest === 'number' && item.totalMocktest >= 0) {
            payload.totalMocktest = Math.floor(item.totalMocktest);
          }

          batch.set(purchaseRef, payload);

          // Also clear item from synced Firestore cart if present
          const cartRef = doc(db, 'users', uid, 'cart', item.firestoreKey);
          batch.delete(cartRef);
        }

        await batch.commit();
        return true;
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, purchasesPath);
      }
    },
    [signInWithGoogle]
  );

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!auth.currentUser) return null;
    try {
      return await auth.currentUser.getIdToken();
    } catch {
      return null;
    }
  }, []);

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
        isSigningIn,
        purchases: activePurchases,
        ownedCompositeKeys,
        ownedSlugs,
        signInWithGoogle,
        signOutUser,
        deleteAccount,
        recordCompletedPurchases,
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
