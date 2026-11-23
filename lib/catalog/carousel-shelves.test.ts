import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBestsellerBooksShelf,
  buildLatestBooksShelf,
} from './carousel-shelves';
import type { CatalogCardDTO } from '../types/catalog';

function makeBook(overrides: Partial<CatalogCardDTO>): CatalogCardDTO {
  return {
    id: 'B1',
    collectionName: 'books',
    title: 'Sample Book',
    urlSlug: 'sample-book-b1',
    type: 'Question Bank',
    language: 'English',
    authorName: 'ExamDash Editorial',
    tags: ['General'],
    currency: 'INR',
    listPrice: 200,
    buyPrice: 100,
    publishAtIso: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('buildLatestBooksShelf sorts newest publishAtIso first without mutating input', () => {
  const input = [
    makeBook({ id: 'B1', publishAtIso: '2026-01-01T00:00:00.000Z' }),
    makeBook({ id: 'B3', publishAtIso: '2026-03-01T00:00:00.000Z' }),
    makeBook({ id: 'B2', publishAtIso: '2026-02-01T00:00:00.000Z' }),
  ];

  const sorted = buildLatestBooksShelf(input, 2);
  assert.deepEqual(
    sorted.map((b) => b.id),
    ['B3', 'B2']
  );
  assert.deepEqual(
    input.map((b) => b.id),
    ['B1', 'B3', 'B2']
  );
});

test('buildBestsellerBooksShelf prioritizes isBestseller, soldCount, real reviews, then discount value', () => {
  const books = [
    makeBook({ id: 'B_LOW_DISC', listPrice: 120, buyPrice: 100 }), // 17% OFF
    makeBook({ id: 'B_HIGH_DISC', listPrice: 120, buyPrice: 30 }), // 75% OFF
    makeBook({ id: 'B_REVIEWED', listPrice: 120, buyPrice: 100, reviewCount: 4, averageRating: 4.8 }),
    makeBook({ id: 'B_SOLD', listPrice: 120, buyPrice: 100, soldCount: 25 }),
    makeBook({ id: 'B_FLAGGED', listPrice: 120, buyPrice: 110, isBestseller: true }),
  ];

  const ranked = buildBestsellerBooksShelf(books, 10);
  assert.deepEqual(
    ranked.map((b) => b.id),
    ['B_FLAGGED', 'B_SOLD', 'B_REVIEWED', 'B_HIGH_DISC', 'B_LOW_DISC']
  );
});
