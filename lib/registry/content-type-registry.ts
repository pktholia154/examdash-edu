import type { CartItem, CollectionName } from '../types/catalog';

export function computeDiscountPercent(listPrice: number, buyPrice: number): number {
  if (!Number.isFinite(listPrice) || !Number.isFinite(buyPrice)) return 0;
  if (listPrice <= 0 || buyPrice < 0 || listPrice <= buyPrice) return 0;
  return Math.round(((listPrice - buyPrice) / listPrice) * 100);
}

export function formatPrice(amount: number, currency: string = 'INR'): string {
  const safeCurrency = /^[A-Z]{3}$/.test((currency || '').toUpperCase())
    ? currency.toUpperCase()
    : 'INR';
  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;

  try {
    return new Intl.NumberFormat(safeCurrency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency: safeCurrency,
      maximumFractionDigits: Number.isInteger(safeAmount) ? 0 : 2,
    })
      .format(safeAmount)
      .replace(/([₹$€£¥])[\s\u00A0\u202F]+/g, '$1')
      .replace(/[\u00A0\u202F]/g, ' ');
  } catch {
    return `${safeCurrency} ${safeAmount}`;
  }
}

export function makeCompositeKey(collectionName: CollectionName, itemId: string): string {
  return `${collectionName}:${itemId}`;
}

export function makeFirestoreSafeCartKey(collectionName: CollectionName, itemId: string): string {
  const safeId = itemId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${collectionName}__${safeId}`.slice(0, 120);
}

export interface CartSummary {
  itemCount: number;
  currency: string | null;
  listTotal: number;
  buyTotal: number;
  totalSavings: number;
  hasCurrencyConflict: boolean;
}

export function calculateCartSummary(items: CartItem[]): CartSummary {
  if (items.length === 0) {
    return {
      itemCount: 0,
      currency: null,
      listTotal: 0,
      buyTotal: 0,
      totalSavings: 0,
      hasCurrencyConflict: false,
    };
  }

  const primaryCurrency = (items[0].currency || 'INR').toUpperCase();
  let listTotal = 0;
  let buyTotal = 0;
  let hasCurrencyConflict = false;

  for (const item of items) {
    const itemCurrency = (item.currency || 'INR').toUpperCase();
    if (itemCurrency !== primaryCurrency) {
      hasCurrencyConflict = true;
    }
    const buy = Number.isFinite(item.buyPrice) ? Math.max(0, item.buyPrice) : 0;
    const list = Number.isFinite(item.listPrice) ? Math.max(buy, item.listPrice) : buy;
    buyTotal += buy;
    listTotal += list;
  }

  return {
    itemCount: items.length,
    currency: primaryCurrency,
    listTotal,
    buyTotal,
    totalSavings: Math.max(0, listTotal - buyTotal),
    hasCurrencyConflict,
  };
}

export function reconcileCartAgainstOwned(
  cartItems: CartItem[],
  ownedCompositeKeys: Set<string>
): { remaining: CartItem[]; removedCount: number } {
  const remaining = cartItems.filter((item) => !ownedCompositeKeys.has(item.compositeKey));
  return {
    remaining,
    removedCount: cartItems.length - remaining.length,
  };
}
