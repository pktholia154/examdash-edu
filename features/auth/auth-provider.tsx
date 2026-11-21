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
import type { UserPurchaseRecord } from '../../lib/types/catalog';
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
  mergeVerifiedPurchases: (records: UserPurchaseRecord[]) => void;
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
  mergeVerifiedPurchases: () => {},
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
            paymentProvider:
              d.paymentProvider === 'razorpay'
                ? 'razorpay'
                : d.paymentProvider === 'free'
                ? 'free'
                : undefined,
            razorpayOrderId:
              typeof d.razorpayOrderId === 'string'
                ? d.razorpayOrderId
                : undefined,
            razorpayPaymentId:
              typeof d.razorpayPaymentId === 'string'
                ? d.razorpayPaymentId
                : undefined,
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

  const mergeVerifiedPurchases = useCallback(
    (incomingRecords: UserPurchaseRecord[]) => {
      if (!Array.isArray(incomingRecords) || incomingRecords.length === 0) return;
      setPurchases((prev) => {
        const byId = new Map<string, UserPurchaseRecord>();
        for (const item of prev) {
          byId.set(item.purchaseId, item);
        }
        for (const item of incomingRecords) {
          byId.set(item.purchaseId, item);
        }
        const merged = Array.from(byId.values());
        merged.sort(
          (a, b) =>
            new Date(b.createdAtIso).getTime() -
            new Date(a.createdAtIso).getTime()
        );
        return merged;
      });
    },
    []
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
        mergeVerifiedPurchases,
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
