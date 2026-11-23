import { computeDiscountPercent } from '../registry/content-type-registry';
import type { CatalogCardDTO } from '../types/catalog';

function parseTimestampMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Returns books sorted newest-first by `publishAtIso` for the "Latest Books" carousel.
 */
export function buildLatestBooksShelf(
  books: CatalogCardDTO[],
  limit: number = 16
): CatalogCardDTO[] {
  return [...books]
    .sort((a, b) => {
      const timeDiff =
        parseTimestampMs(b.publishAtIso) - parseTimestampMs(a.publishAtIso);
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    })
    .slice(0, Math.max(0, limit));
}

/**
 * Returns books ranked deterministically for the "Bestsellers" carousel using only
 * real, verifiable Firestore & review signals:
 * 1. Explicit `isBestseller` editorial flag (when set in Firestore)
 * 2. Real `soldCount` descending (when tracked in Firestore)
 * 3. Real published review momentum (`reviewCount * averageRating`)
 * 4. Discount value percentage descending (highest-value study editions)
 * 5. Lower buyPrice, then newest publishAtIso as final tie-breaker
 */
export function buildBestsellerBooksShelf(
  books: CatalogCardDTO[],
  limit: number = 16
): CatalogCardDTO[] {
  return [...books]
    .sort((a, b) => {
      const flagA = a.isBestseller ? 1 : 0;
      const flagB = b.isBestseller ? 1 : 0;
      if (flagB !== flagA) return flagB - flagA;

      const soldA = typeof a.soldCount === 'number' && a.soldCount > 0 ? a.soldCount : 0;
      const soldB = typeof b.soldCount === 'number' && b.soldCount > 0 ? b.soldCount : 0;
      if (soldB !== soldA) return soldB - soldA;

      const revScoreA = (a.reviewCount ?? 0) * (a.averageRating ?? 0);
      const revScoreB = (b.reviewCount ?? 0) * (b.averageRating ?? 0);
      if (revScoreB !== revScoreA) return revScoreB - revScoreA;

      const discA = computeDiscountPercent(a.listPrice, a.buyPrice);
      const discB = computeDiscountPercent(b.listPrice, b.buyPrice);
      if (discB !== discA) return discB - discA;

      if (a.buyPrice !== b.buyPrice) return a.buyPrice - b.buyPrice;

      const timeDiff =
        parseTimestampMs(b.publishAtIso) - parseTimestampMs(a.publishAtIso);
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    })
    .slice(0, Math.max(0, limit));
}
