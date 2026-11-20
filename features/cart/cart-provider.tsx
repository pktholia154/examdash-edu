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
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase/client';
import type { CatalogItemDTO, CartItem } from '../../lib/types/catalog';
import {
  calculateCartSummary,
  makeCompositeKey,
  makeFirestoreSafeCartKey,
  reconcileCartAgainstOwned,
  type CartSummary,
} from '../../lib/registry/content-type-registry';
import { useAuth } from '../auth/auth-provider';
import { useToast } from '../toast/toast-context';

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
  checkout: () => Promise<void>;
  claimFreeItem: (catalogItem: CatalogItemDTO) => Promise<void>;
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
  checkout: async () => {},
  claimFreeItem: async () => {},
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

  const { user, ownedCompositeKeys, recordCompletedPurchases } = useAuth();
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

  const claimFreeItem = useCallback(
    async (catalogItem: CatalogItemDTO) => {
      const compositeKey = makeCompositeKey(
        catalogItem.collectionName,
        catalogItem.id
      );
      if (ownedCompositeKeys.has(compositeKey)) return;

      const single: CartItem & { totalMocktest?: number } = {
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
        currency: (catalogItem.currency || 'INR').toUpperCase(),
        listPrice: catalogItem.listPrice,
        buyPrice: 0,
        ...(catalogItem.collectionName === 'ExamPackDocument'
          ? { totalMocktest: catalogItem.totalMocktest }
          : {}),
      };

      setIsCheckingOut(true);
      try {
        const ok = await recordCompletedPurchases([single]);
        if (ok) {
          showToast(`Unlocked "${catalogItem.title}" in your Library`, 'success');
        }
      } finally {
        setIsCheckingOut(false);
      }
    },
    [ownedCompositeKeys, recordCompletedPurchases, showToast]
  );

  const checkout = useCallback(async () => {
    if (items.length === 0) return;
    const summaryCheck = calculateCartSummary(items);
    if (summaryCheck.hasCurrencyConflict) {
      showToast('Please resolve mixed currencies in your cart before checkout.', 'danger');
      return;
    }

    setIsCheckingOut(true);
    try {
      const ok = await recordCompletedPurchases(items);
      if (ok) {
        writeCartStorage([]);
        setIsOpen(false);
        showToast('Checkout complete! Resources unlocked in your Library.', 'success');
      }
    } finally {
      setIsCheckingOut(false);
    }
  }, [items, recordCompletedPurchases, showToast]);

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
