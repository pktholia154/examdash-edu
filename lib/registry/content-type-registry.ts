import type { CartItem, CollectionName } from '../types/catalog';

export type ContentVisualKind = 'ebook' | 'exam' | 'quizbook';

export interface ContentTypeVisual {
  kind: ContentVisualKind;
  bgCssVar: string;
  inkCssVar: string;
  bgHex: string;
  inkHex: string;
  badgeLabel: string;
}

const REGISTRY: Record<ContentVisualKind, ContentTypeVisual> = {
  ebook: {
    kind: 'ebook',
    bgCssVar: 'var(--thumb-ebook)',
    inkCssVar: 'var(--thumb-ebook-ink)',
    bgHex: '#81D44C',
    inkHex: '#0F172A',
    badgeLabel: 'EBOOK',
  },
  exam: {
    kind: 'exam',
    bgCssVar: 'var(--thumb-exam)',
    inkCssVar: 'var(--thumb-exam-ink)',
    bgHex: '#4CC2D4',
    inkHex: '#0F172A',
    badgeLabel: 'EXAM',
  },
  quizbook: {
    kind: 'quizbook',
    bgCssVar: 'var(--thumb-quizbook)',
    inkCssVar: 'var(--thumb-quizbook-ink)',
    bgHex: '#924CD4',
    inkHex: '#FFFFFF',
    badgeLabel: 'QUIZBOOK',
  },
};

/**
 * Case-insensitive content-type match with deterministic collection fallback.
 * - Ebooks: #81D44C (ink #0F172A)
 * - Exams: #4CC2D4 (ink #0F172A)
 * - Quizbooks: #924CD4 (ink #FFFFFF)
 */
export function resolveContentTypeVisual(
  rawType: string | undefined | null,
  collectionName: CollectionName
): ContentTypeVisual {
  const normalized = (rawType ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');

  if (
    normalized.includes('quizbook') ||
    normalized.includes('quiz book') ||
    normalized === 'quiz' ||
    normalized.includes('question bank') ||
    normalized.includes('mcq')
  ) {
    return REGISTRY.quizbook;
  }

  if (
    normalized.includes('ebook') ||
    normalized.includes('e book') ||
    normalized === 'book' ||
    normalized === 'books'
  ) {
    return REGISTRY.ebook;
  }

  if (
    normalized.includes('exam') ||
    normalized.includes('test series') ||
    normalized.includes('mock')
  ) {
    return REGISTRY.exam;
  }

  return collectionName === 'ExamPackDocument' ? REGISTRY.exam : REGISTRY.ebook;
}

/**
 * Derives a bold 2-letter uppercase monogram:
 * - First letters of the first two alphanumeric words of title
 * - 2-character fallback for single-word titles
 * - Deterministic 'ED' fallback if empty
 */
export function deriveMonogram(title: string | undefined | null): string {
  const cleaned = (title ?? '').trim();
  if (!cleaned) return 'ED';

  const words = cleaned
    .split(/[\s\-_/|:,.()[\]]+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((w) => w.length > 0);

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  if (words.length === 1) {
    const single = words[0].toUpperCase();
    return single.length >= 2 ? single.slice(0, 2) : `${single}X`;
  }

  return 'ED';
}

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
