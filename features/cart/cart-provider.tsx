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
import {
  claimFreeThroughCheckoutAdapter,
  purchasePaidThroughCheckoutAdapter,
} from '../../lib/payments/checkout-adapter';
import {
  calculateCartSummary,
  makeCompositeKey,
  makeFirestoreSafeCartKey,
  reconcileCartAgainstOwned,
  type CartSummary,
} from '../../lib/registry/content-type-registry';
import type {
  CartItem,
  CatalogItemDTO,
  CollectionName,
} from '../../lib/types/catalog';
import { useAuth } from '../auth/auth-provider';
import { useToast } from '../toast/toast-context';

/**
 * Slim primitive-only purchase target so client islands (e.g. DetailBuyCard)
 * never need to serialize `fullDescription` into RSC hydration payloads.
 */
export interface BuyTargetItem {
  id: string;
  collectionName: CollectionName;
  title: string;
  urlSlug: string;
  currency: string;
  buyPrice: number;
  listPrice: number;
  type?: string;
  authorName?: string;
  language?: string;
}

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
  addItem: (catalogItem: CatalogItemDTO | BuyTargetItem) => void;
  removeItem: (compositeKey: string) => void;
  clearCart: () => void;
  checkout: () => Promise<boolean>;
  buyNow: (
    targetItem: BuyTargetItem,
    options?: BuyNowOptions
  ) => Promise<boolean>;
  claimFreeItem: (targetItem: BuyTargetItem) => Promise<boolean>;
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

  const items = useMemo(
    () => reconcileCartAgainstOwned(storedItems, ownedCompositeKeys).remaining,
    [ownedCompositeKeys, storedItems]
  );

  useEffect(() => {
    if (items.length !== storedItems.length) {
      writeCartStorage(items);
    }
  }, [items, storedItems.length]);

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

  const addItem = useCallback(
    (catalogItem: CatalogItemDTO | BuyTargetItem) => {
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
        authorName: catalogItem.authorName || 'ExamDash',
        language: catalogItem.language || 'English',
        type:
          catalogItem.type ||
          (catalogItem.collectionName === 'ExamPackDocument' ? 'Exam' : 'Ebook'),
        currency: incomingCurrency,
        listPrice: catalogItem.listPrice,
        buyPrice: catalogItem.buyPrice,
      };

      writeCartStorage([...items, newItem]);
      showToast(`Added "${catalogItem.title}" to cart`, 'success');
    },
    [items, openCart, ownedCompositeKeys, showToast]
  );

  const removeItem = useCallback(
    (compositeKey: string) => {
      writeCartStorage(items.filter((i) => i.compositeKey !== compositeKey));
    },
    [items]
  );

  const clearCart = useCallback(() => {
    writeCartStorage([]);
  }, []);

  const ensureAuthenticatedToken = useCallback(async () => {
    let activeUser = user;
    if (!activeUser) {
      activeUser = await signInWithGoogle();
    }
    if (!activeUser) {
      return null;
    }
    if (!activeUser.emailVerified) {
      showToast(
        'Please sign in with a verified account to complete purchases.',
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
  }, [showToast, signInWithGoogle, user]);

  const executeFreeClaim = useCallback(
    async (
      refs: Array<{ collectionName: CollectionName; id: string }>,
      options?: { redirectToPurchased?: boolean; closeDrawer?: boolean }
    ): Promise<boolean> => {
      const session = await ensureAuthenticatedToken();
      if (!session) return false;

      setIsCheckingOut(true);
      try {
        const outcome = await claimFreeThroughCheckoutAdapter({
          refs,
          token: session.token,
        });

        if (outcome.status === 'error') {
          showToast(outcome.message, 'danger');
          return false;
        }
        if (outcome.status === 'cancelled') {
          return false;
        }

        mergeVerifiedPurchases(outcome.purchases);

        const purchasedKeys = new Set(
          outcome.purchases.map((p) =>
            makeCompositeKey(p.collectionName, p.itemId)
          )
        );
        const remaining = items.filter((i) => !purchasedKeys.has(i.compositeKey));
        if (remaining.length !== items.length) {
          writeCartStorage(remaining);
        }

        if (options?.closeDrawer) {
          setIsOpen(false);
        }

        showToast(
          outcome.purchases.length === 1
            ? `Added "${outcome.purchases[0].title}" to your Purchased Library.`
            : `Added ${outcome.purchases.length} free resources to your Purchased Library.`,
          'success'
        );

        if (options?.redirectToPurchased) {
          router.push('/purchased');
        }
        return true;
      } finally {
        setIsCheckingOut(false);
      }
    },
    [ensureAuthenticatedToken, items, mergeVerifiedPurchases, router, showToast]
  );

  const executePaidPurchase = useCallback(
    async (
      refs: Array<{ collectionName: CollectionName; id: string }>,
      options?: { redirectToPurchased?: boolean; closeDrawer?: boolean }
    ): Promise<boolean> => {
      const session = await ensureAuthenticatedToken();
      if (!session) return false;

      setIsCheckingOut(true);
      try {
        const outcome = await purchasePaidThroughCheckoutAdapter({
          refs,
          user: session.activeUser,
          initialToken: session.token,
        });

        if (outcome.status === 'cancelled') {
          showToast('Payment cancelled. Your items are still saved.');
          return false;
        }

        if (outcome.status === 'error') {
          showToast(outcome.message, 'danger');
          return false;
        }

        if (outcome.alreadyOwned) {
          showToast('You already own these items in your Purchased Library.');
          if (options?.closeDrawer) setIsOpen(false);
          if (options?.redirectToPurchased !== false) {
            router.push('/purchased');
          }
          return true;
        }

        mergeVerifiedPurchases(outcome.purchases);

        const purchasedKeys = new Set(
          outcome.purchases.map((p) =>
            makeCompositeKey(p.collectionName, p.itemId)
          )
        );
        const remaining = items.filter((i) => !purchasedKeys.has(i.compositeKey));
        if (remaining.length !== items.length) {
          writeCartStorage(remaining);
        }

        if (options?.closeDrawer) {
          setIsOpen(false);
        }

        const count = outcome.purchases.length;
        showToast(
          count === 1
            ? `Payment verified! "${outcome.purchases[0].title}" added to your Purchased Library.`
            : `Payment verified! ${count} items added to your Purchased Library.`,
          'success'
        );

        if (options?.redirectToPurchased !== false) {
          router.push('/purchased');
        }
        return true;
      } finally {
        setIsCheckingOut(false);
      }
    },
    [ensureAuthenticatedToken, items, mergeVerifiedPurchases, router, showToast]
  );

  const claimFreeItem = useCallback(
    async (targetItem: BuyTargetItem): Promise<boolean> => {
      const compositeKey = makeCompositeKey(
        targetItem.collectionName,
        targetItem.id
      );
      if (ownedCompositeKeys.has(compositeKey)) return true;

      return executeFreeClaim(
        [{ collectionName: targetItem.collectionName, id: targetItem.id }],
        { redirectToPurchased: false, closeDrawer: false }
      );
    },
    [executeFreeClaim, ownedCompositeKeys]
  );

  const buyNow = useCallback(
    async (
      targetItem: BuyTargetItem,
      options?: BuyNowOptions
    ): Promise<boolean> => {
      const compositeKey = makeCompositeKey(
        targetItem.collectionName,
        targetItem.id
      );
      if (ownedCompositeKeys.has(compositeKey)) {
        if (options?.redirectToPurchased !== false) {
          router.push('/purchased');
        }
        return true;
      }

      if (targetItem.buyPrice === 0) {
        return executeFreeClaim(
          [{ collectionName: targetItem.collectionName, id: targetItem.id }],
          { redirectToPurchased: options?.redirectToPurchased === true }
        );
      }

      return executePaidPurchase(
        [{ collectionName: targetItem.collectionName, id: targetItem.id }],
        {
          redirectToPurchased: options?.redirectToPurchased !== false,
          closeDrawer: false,
        }
      );
    },
    [executeFreeClaim, executePaidPurchase, ownedCompositeKeys, router]
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

    return executePaidPurchase(refs, {
      redirectToPurchased: true,
      closeDrawer: true,
    });
  }, [executeFreeClaim, executePaidPurchase, items, showToast]);

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
