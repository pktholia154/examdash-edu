'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useRouter } from 'next/navigation';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase/client';
import type {
  CatalogItemDTO,
  CartItem,
  CollectionName,
  UserPurchaseRecord,
} from '../../lib/types/catalog';
import {
  calculateCartSummary,
  makeCompositeKey,
  makeFirestoreSafeCartKey,
  reconcileCartAgainstOwned,
  type CartSummary,
} from '../../lib/registry/content-type-registry';
import { openRazorpayCheckoutModal } from '../../lib/payments/razorpay-client';
import { createUuidV7 } from '../../lib/platform/capacitor-bridge';
import { useAuth } from '../auth/auth-provider';
import { useToast } from '../toast/toast-context';

interface BuyNowOptions {
  redirectToPurchased?: boolean;
}

interface CartContextValue {
  items: CartItem[];
  summary: CartSummary;
  isOpen: boolean;
  isCheckingOut: boolean;
  openCart: () => void;
  closeCart: () => void;
  isInCart: (compositeKey: string) => boolean;
  addItem: (catalogItem: CatalogItemDTO) => void;
  removeItem: (compositeKey: string) => void;
  clearCart: () => void;
  checkout: () => Promise<boolean>;
  buyNow: (
    catalogItem: CatalogItemDTO,
    options?: BuyNowOptions
  ) => Promise<boolean>;
  claimFreeItem: (catalogItem: CatalogItemDTO) => Promise<boolean>;
}

const CartContext = createContext<CartContextValue>({
  items: [],
  summary: {
    itemCount: 0,
    currency: null,
    listTotal: 0,
    buyTotal: 0,
    totalSavings: 0,
    hasCurrencyConflict: false,
  },
  isOpen: false,
  isCheckingOut: false,
  openCart: () => {},
  closeCart: () => {},
  isInCart: () => false,
  addItem: () => {},
  removeItem: () => {},
  clearCart: () => {},
  checkout: async () => false,
  buyNow: async () => false,
  claimFreeItem: async () => false,
});

const CART_STORAGE_KEY = 'ed-cart-v1';
const CART_EVENT = 'ed-cart-change';
const EMPTY_RAW = '[]';

function subscribeCartStorage(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CART_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CART_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

function getCartRawSnapshot(): string {
  if (typeof window === 'undefined') return EMPTY_RAW;
  try {
    return localStorage.getItem(CART_STORAGE_KEY) || EMPTY_RAW;
  } catch {
    return EMPTY_RAW;
  }
}

function getServerCartRawSnapshot(): string {
  return EMPTY_RAW;
}

function writeCartStorage(nextItems: CartItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextItems));
  } catch {
    // Ignore storage quota errors
  }
  window.dispatchEvent(new Event(CART_EVENT));
}

interface RazorpayOrderApiResponse {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  orderToken: string;
  description: string;
  itemCount: number;
  prefill?: {
    name?: string;
    email?: string;
  };
}

interface VerifyPaymentApiResponse {
  verified: boolean;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  purchases: UserPurchaseRecord[];
}

interface ClaimFreeApiResponse {
  claimed: boolean;
  purchases: UserPurchaseRecord[];
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const router = useRouter();

  const {
    user,
    ownedCompositeKeys,
    signInWithGoogle,
    mergeVerifiedPurchases,
  } = useAuth();
  const { showToast } = useToast();

  const rawCartJson = useSyncExternalStore(
    subscribeCartStorage,
    getCartRawSnapshot,
    getServerCartRawSnapshot
  );

  const storedItems = useMemo<CartItem[]>(() => {
    try {
      const parsed = JSON.parse(rawCartJson);
      return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
    } catch {
      return [];
    }
  }, [rawCartJson]);

  // Purely derive reconciled items against ownedCompositeKeys without cascading setState effects
  const items = useMemo(
    () => reconcileCartAgainstOwned(storedItems, ownedCompositeKeys).remaining,
    [ownedCompositeKeys, storedItems]
  );

  // Sync reconciled items back to localStorage externally when owned items strip entries
  useEffect(() => {
    if (items.length !== storedItems.length) {
      writeCartStorage(items);
    }
  }, [items, storedItems.length]);

  // Wire Android Predictive Back / browser history stack when drawer opens
  useEffect(() => {
    if (!isOpen) return;
    const handlePopState = () => {
      setIsOpen(false);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isOpen]);

  const openCart = useCallback(() => {
    setIsOpen((prev) => {
      if (!prev && typeof window !== 'undefined') {
        window.history.pushState({ edDrawer: 'cart' }, '');
      }
      return true;
    });
  }, []);

  const closeCart = useCallback(() => {
    setIsOpen(false);
  }, []);

  const isInCart = useCallback(
    (compositeKey: string) => items.some((i) => i.compositeKey === compositeKey),
    [items]
  );

  const syncCartItemToFirestore = useCallback(
    async (cartItem: CartItem) => {
      if (!user || !user.emailVerified) return;
      try {
        const cartRef = doc(db, 'users', user.uid, 'cart', cartItem.firestoreKey);
        const cleanSlug = cartItem.urlSlug
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .slice(0, 200);
        await setDoc(cartRef, {
          cartKey: cartItem.firestoreKey,
          userId: user.uid,
          itemId: cartItem.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128),
          collectionName: cartItem.collectionName,
          urlSlug: cleanSlug || 'item',
          title: cartItem.title.slice(0, 300),
          authorName: (cartItem.authorName || 'ExamDash').slice(0, 160),
          language: (cartItem.language || 'English').slice(0, 64),
          type: (cartItem.type || 'Ebook').slice(0, 64),
          currency: /^[A-Z]{3}$/.test((cartItem.currency || '').toUpperCase())
            ? cartItem.currency.toUpperCase()
            : 'INR',
          listPrice: Math.max(0, cartItem.listPrice),
          buyPrice: Math.max(0, cartItem.buyPrice),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking cloud sync fallback to localStorage
      }
    },
    [user]
  );

  const addItem = useCallback(
    (catalogItem: CatalogItemDTO) => {
      const compositeKey = makeCompositeKey(
        catalogItem.collectionName,
        catalogItem.id
      );

      if (ownedCompositeKeys.has(compositeKey)) {
        showToast('You already own this resource in your Library.');
        return;
      }

      if (items.some((existing) => existing.compositeKey === compositeKey)) {
        openCart();
        return;
      }

      const incomingCurrency = (catalogItem.currency || 'INR').toUpperCase();
      if (items.length > 0) {
        const activeCurrency = (items[0].currency || 'INR').toUpperCase();
        if (activeCurrency !== incomingCurrency) {
          showToast(
            `Cart currency is locked to ${activeCurrency}. Complete or clear your cart before adding ${incomingCurrency} items.`,
            'danger'
          );
          return;
        }
      }

      const newItem: CartItem = {
        compositeKey,
        firestoreKey: makeFirestoreSafeCartKey(
          catalogItem.collectionName,
          catalogItem.id
        ),
        id: catalogItem.id,
        collectionName: catalogItem.collectionName,
        urlSlug: catalogItem.urlSlug,
        title: catalogItem.title,
        authorName: catalogItem.authorName,
        language: catalogItem.language,
        type: catalogItem.type,
        currency: incomingCurrency,
        listPrice: catalogItem.listPrice,
        buyPrice: catalogItem.buyPrice,
      };

      writeCartStorage([...items, newItem]);
      void syncCartItemToFirestore(newItem);
      showToast(`Added "${catalogItem.title}" to cart`, 'success');
    },
    [items, openCart, ownedCompositeKeys, showToast, syncCartItemToFirestore]
  );

  const removeItem = useCallback(
    (compositeKey: string) => {
      const target = items.find((i) => i.compositeKey === compositeKey);
      writeCartStorage(items.filter((i) => i.compositeKey !== compositeKey));
      if (target && user) {
        void deleteDoc(doc(db, 'users', user.uid, 'cart', target.firestoreKey)).catch(
          () => {}
        );
      }
    },
    [items, user]
  );

  const clearCart = useCallback(() => {
    const snapshot = [...items];
    writeCartStorage([]);
    if (user) {
      for (const item of snapshot) {
        void deleteDoc(doc(db, 'users', user.uid, 'cart', item.firestoreKey)).catch(
          () => {}
        );
      }
    }
  }, [items, user]);

  const ensureAuthenticatedToken = useCallback(async () => {
    let activeUser = auth.currentUser;
    if (!activeUser) {
      activeUser = await signInWithGoogle();
    }
    if (!activeUser) {
      return null;
    }
    if (!activeUser.emailVerified) {
      showToast(
        'Please sign in with a verified Google account to complete purchases.',
        'danger'
      );
      return null;
    }
    try {
      const token = await activeUser.getIdToken();
      return { activeUser, token };
    } catch {
      showToast('Authentication session expired. Please sign in again.', 'danger');
      return null;
    }
  }, [showToast, signInWithGoogle]);

  const executeFreeClaim = useCallback(
    async (
      refs: Array<{ collectionName: CollectionName; id: string }>,
      options?: { redirectToPurchased?: boolean; closeDrawer?: boolean }
    ): Promise<boolean> => {
      const session = await ensureAuthenticatedToken();
      if (!session) return false;

      setIsCheckingOut(true);
      try {
        const res = await fetch('/api/v1/payments/claim-free', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
            'Idempotency-Key': createUuidV7(),
          },
          body: JSON.stringify({ items: refs }),
        });

        const payload = (await res.json().catch(() => ({}))) as Partial<ClaimFreeApiResponse> & {
          error?: string;
        };

        if (!res.ok || !Array.isArray(payload.purchases)) {
          showToast(
            payload.error || 'Could not claim free resource. Please try again.',
            'danger'
          );
          return false;
        }

        mergeVerifiedPurchases(payload.purchases);

        const purchasedKeys = new Set(
          payload.purchases.map((p) => makeCompositeKey(p.collectionName, p.itemId))
        );
        const remaining = items.filter((i) => !purchasedKeys.has(i.compositeKey));
        if (remaining.length !== items.length) {
          writeCartStorage(remaining);
        }

        if (options?.closeDrawer) {
          setIsOpen(false);
        }

        showToast(
          payload.purchases.length === 1
            ? `Added "${payload.purchases[0].title}" to your Purchased Library.`
            : `Added ${payload.purchases.length} free resources to your Purchased Library.`,
          'success'
        );

        if (options?.redirectToPurchased) {
          router.push('/purchased');
        }
        return true;
      } catch {
        showToast('Network error while claiming free resource.', 'danger');
        return false;
      } finally {
        setIsCheckingOut(false);
      }
    },
    [ensureAuthenticatedToken, items, mergeVerifiedPurchases, router, showToast]
  );

  const executeRazorpayPurchase = useCallback(
    async (
      refs: Array<{ collectionName: CollectionName; id: string }>,
      options?: { redirectToPurchased?: boolean; closeDrawer?: boolean }
    ): Promise<boolean> => {
      const session = await ensureAuthenticatedToken();
      if (!session) return false;

      setIsCheckingOut(true);
      try {
        // 1. Create authoritative Razorpay Order on server
        const orderRes = await fetch('/api/v1/payments/razorpay/order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
            'Idempotency-Key': createUuidV7(),
          },
          body: JSON.stringify({ items: refs }),
        });

        const orderData = (await orderRes.json().catch(() => ({}))) as Partial<
          RazorpayOrderApiResponse
        > & { error?: string; alreadyOwned?: boolean };

        if (!orderRes.ok) {
          if (orderRes.status === 409 && orderData.alreadyOwned) {
            showToast(
              orderData.error || 'You already own these items in your Purchased Library.'
            );
            if (options?.closeDrawer) setIsOpen(false);
            if (options?.redirectToPurchased !== false) {
              router.push('/purchased');
            }
            return true;
          }
          showToast(
            orderData.error || 'Unable to start Razorpay checkout. Please try again.',
            'danger'
          );
          return false;
        }

        if (
          !orderData.keyId ||
          !orderData.orderId ||
          !orderData.amount ||
          !orderData.currency ||
          !orderData.orderToken
        ) {
          showToast('Incomplete order response from payment server.', 'danger');
          return false;
        }

        // 2. Open production Razorpay Checkout modal
        const modalOutcome = await openRazorpayCheckoutModal({
          key: orderData.keyId,
          amount: orderData.amount,
          currency: orderData.currency,
          name: 'ExamDash',
          description: orderData.description || 'ExamDash Study Resources',
          image: 'https://exam-dash.com/pwa-192x192.png',
          order_id: orderData.orderId,
          prefill: {
            name: orderData.prefill?.name || session.activeUser.displayName || '',
            email: orderData.prefill?.email || session.activeUser.email || '',
          },
          notes: {
            website: 'https://exam-dash.com',
          },
          theme: {
            color: '#0F172A',
          },
        });

        if (modalOutcome.status === 'dismissed') {
          showToast('Payment cancelled. Your items are still saved.');
          return false;
        }

        if (modalOutcome.status === 'failed') {
          showToast(modalOutcome.message, 'danger');
          return false;
        }

        // 3. Verify payment signature & server-side capture, then unlock in Firestore `/users/{uid}/purchases`
        const freshToken = await session.activeUser.getIdToken();
        const verifyRes = await fetch('/api/v1/payments/razorpay/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${freshToken}`,
            'Idempotency-Key': createUuidV7(),
          },
          body: JSON.stringify({
            razorpay_order_id: modalOutcome.payload.razorpay_order_id,
            razorpay_payment_id: modalOutcome.payload.razorpay_payment_id,
            razorpay_signature: modalOutcome.payload.razorpay_signature,
            orderToken: orderData.orderToken,
          }),
        });

        const verifyData = (await verifyRes.json().catch(() => ({}))) as Partial<
          VerifyPaymentApiResponse
        > & { error?: string };

        if (!verifyRes.ok || !verifyData.verified || !Array.isArray(verifyData.purchases)) {
          showToast(
            verifyData.error ||
              `Payment verification failed. Save payment ID ${modalOutcome.payload.razorpay_payment_id} and contact support.`,
            'danger'
          );
          return false;
        }

        // 4. Immediately reflect newly purchased Books & Exam Packs in Auth state & clear from Cart
        mergeVerifiedPurchases(verifyData.purchases);

        const purchasedKeys = new Set(
          verifyData.purchases.map((p) => makeCompositeKey(p.collectionName, p.itemId))
        );
        const remaining = items.filter((i) => !purchasedKeys.has(i.compositeKey));
        if (remaining.length !== items.length) {
          writeCartStorage(remaining);
        }

        if (options?.closeDrawer) {
          setIsOpen(false);
        }

        const count = verifyData.purchases.length;
        showToast(
          count === 1
            ? `Payment verified! "${verifyData.purchases[0].title}" added to your Purchased Library.`
            : `Payment verified! ${count} items added to your Purchased Library.`,
          'success'
        );

        if (options?.redirectToPurchased !== false) {
          router.push('/purchased');
        }
        return true;
      } catch (err) {
        showToast(
          err instanceof Error
            ? err.message
            : 'Unable to complete Razorpay checkout. Please try again.',
          'danger'
        );
        return false;
      } finally {
        setIsCheckingOut(false);
      }
    },
    [ensureAuthenticatedToken, items, mergeVerifiedPurchases, router, showToast]
  );

  const claimFreeItem = useCallback(
    async (catalogItem: CatalogItemDTO): Promise<boolean> => {
      const compositeKey = makeCompositeKey(
        catalogItem.collectionName,
        catalogItem.id
      );
      if (ownedCompositeKeys.has(compositeKey)) return true;

      return executeFreeClaim(
        [{ collectionName: catalogItem.collectionName, id: catalogItem.id }],
        { redirectToPurchased: false, closeDrawer: false }
      );
    },
    [executeFreeClaim, ownedCompositeKeys]
  );

  const buyNow = useCallback(
    async (
      catalogItem: CatalogItemDTO,
      options?: BuyNowOptions
    ): Promise<boolean> => {
      const compositeKey = makeCompositeKey(
        catalogItem.collectionName,
        catalogItem.id
      );
      if (ownedCompositeKeys.has(compositeKey)) {
        if (options?.redirectToPurchased !== false) {
          router.push('/purchased');
        }
        return true;
      }

      if (catalogItem.buyPrice === 0) {
        return executeFreeClaim(
          [{ collectionName: catalogItem.collectionName, id: catalogItem.id }],
          { redirectToPurchased: options?.redirectToPurchased === true }
        );
      }

      return executeRazorpayPurchase(
        [{ collectionName: catalogItem.collectionName, id: catalogItem.id }],
        {
          redirectToPurchased: options?.redirectToPurchased !== false,
          closeDrawer: false,
        }
      );
    },
    [executeFreeClaim, executeRazorpayPurchase, ownedCompositeKeys, router]
  );

  const checkout = useCallback(async (): Promise<boolean> => {
    if (items.length === 0) return false;
    const summaryCheck = calculateCartSummary(items);
    if (summaryCheck.hasCurrencyConflict) {
      showToast(
        'Please resolve mixed currencies in your cart before checkout.',
        'danger'
      );
      return false;
    }

    const refs = items.map((i) => ({
      collectionName: i.collectionName,
      id: i.id,
    }));

    if (summaryCheck.buyTotal <= 0) {
      return executeFreeClaim(refs, {
        redirectToPurchased: true,
        closeDrawer: true,
      });
    }

    return executeRazorpayPurchase(refs, {
      redirectToPurchased: true,
      closeDrawer: true,
    });
  }, [executeFreeClaim, executeRazorpayPurchase, items, showToast]);

  const summary = useMemo(() => calculateCartSummary(items), [items]);

  return (
    <CartContext.Provider
      value={{
        items,
        summary,
        isOpen,
        isCheckingOut,
        openCart,
        closeCart,
        isInCart,
        addItem,
        removeItem,
        clearCart,
        checkout,
        buyNow,
        claimFreeItem,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
