import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBookFacetQueryString,
  classifyBookPriceBucket,
  deriveAvailableBookFacets,
  estimateCategoryHubCatalogReads,
  hasActiveBookFacets,
  matchesBookPriceBucket,
  parseBookFacetParams,
  parseStrictPageParam,
  partitionCategoryChipsForDisplay,
} from './facets';
import type { CategoryChipDTO } from '../types/catalog';

test('parseStrictPageParam handles missing, ?page=1 redirect, valid Page 2+, and invalid pages', () => {
  assert.deepEqual(parseStrictPageParam(undefined), { kind: 'ok', page: 1 });
  assert.deepEqual(parseStrictPageParam('1'), { kind: 'redirect_page_1' });
  assert.deepEqual(parseStrictPageParam('2'), { kind: 'ok', page: 2 });
  assert.deepEqual(parseStrictPageParam('15'), { kind: 'ok', page: 15 });
  assert.deepEqual(parseStrictPageParam('0'), { kind: 'invalid' });
  assert.deepEqual(parseStrictPageParam('-2'), { kind: 'invalid' });
  assert.deepEqual(parseStrictPageParam('02'), { kind: 'invalid' });
  assert.deepEqual(parseStrictPageParam('2.5'), { kind: 'invalid' });
  assert.deepEqual(parseStrictPageParam('abc'), { kind: 'invalid' });
  assert.deepEqual(parseStrictPageParam(['2', '3']), { kind: 'invalid' });
});

test('parseBookFacetParams normalizes type, language, price, and sort while ignoring defaults', () => {
  const parsed = parseBookFacetParams({
    type: ' Practice Tests ',
    language: 'Sanskrit',
    price: 'under-150',
    sort: 'price_asc',
  });
  assert.deepEqual(parsed, {
    type: 'Practice Tests',
    language: 'Sanskrit',
    price: 'under-150',
    sort: 'price_asc',
  });
  assert.equal(hasActiveBookFacets(parsed), true);

  const defaultsOnly = parseBookFacetParams({
    type: 'ALL',
    language: 'all',
    price: 'all',
    sort: 'publishAt_desc',
  });
  assert.deepEqual(defaultsOnly, {});
  assert.equal(hasActiveBookFacets(defaultsOnly), false);
});

test('classifyBookPriceBucket aligns 1:1 with 3-month discounted display price (40% off)', () => {
  // Free book (0 -> ₹0)
  assert.equal(classifyBookPriceBucket(0), 'free');
  assert.equal(matchesBookPriceBucket(0, 'free'), true);

  // buyPrice 200 -> discounted 3M payable ₹120 -> under-150
  assert.equal(classifyBookPriceBucket(200), 'under-150');
  assert.equal(matchesBookPriceBucket(200, 'under-150'), true);
  assert.equal(matchesBookPriceBucket(200, '150-300'), false);

  // buyPrice 400 -> discounted 3M payable ₹240 -> 150-300
  assert.equal(classifyBookPriceBucket(400), '150-300');
  assert.equal(matchesBookPriceBucket(400, '150-300'), true);

  // buyPrice 600 -> discounted 3M payable ₹360 -> above-300
  assert.equal(classifyBookPriceBucket(600), 'above-300');
  assert.equal(matchesBookPriceBucket(600, 'above-300'), true);
});

test('deriveAvailableBookFacets extracts sorted types, languages, and active price buckets', () => {
  const facets = deriveAvailableBookFacets([
    { type: 'Practice Tests', language: 'Sanskrit', buyPrice: 200 },
    { type: 'Practice Tests', language: 'English', buyPrice: 200 },
    { type: 'Ebook', language: 'Hindi', buyPrice: 0 },
  ]);

  assert.deepEqual(facets, {
    types: ['Ebook', 'Practice Tests'],
    languages: ['English', 'Hindi', 'Sanskrit'],
    priceBuckets: ['free', 'under-150'],
  });
});

test('buildBookFacetQueryString omits default values and page=1', () => {
  assert.equal(buildBookFacetQueryString({}, 1), '');
  assert.equal(buildBookFacetQueryString({}, 2), '?page=2');
  assert.equal(
    buildBookFacetQueryString(
      { language: 'Sanskrit', price: 'under-150', sort: 'price_asc' },
      1
    ),
    '?language=Sanskrit&price=under-150&sort=price_asc'
  );
  assert.equal(
    buildBookFacetQueryString({ type: 'Practice Tests' }, 3),
    '?type=Practice+Tests&page=3'
  );
});

test('partitionCategoryChipsForDisplay preserves full list across primary + overflow', () => {
  const sample: CategoryChipDTO[] = Array.from({ length: 10 }, (_, idx) => ({
    id: `cat-${idx + 1}`,
    slug: `cat-${idx + 1}`,
    title: `Category ${idx + 1}`,
    metaDescription: 'Desc',
    updatedAtIso: '2026-01-01T00:00:00.000Z',
    createdAtIso: '2026-01-01T00:00:00.000Z',
    liveBookCount: idx + 1,
  }));

  const partitioned = partitionCategoryChipsForDisplay(sample, 6);
  assert.equal(partitioned.primary.length, 6);
  assert.equal(partitioned.overflow.length, 4);
  assert.equal(partitioned.hasOverflow, true);
  assert.equal(partitioned.overflowCount, 4);
});

test('estimateCategoryHubCatalogReads calculates bounded FinOps reads accurately', () => {
  // Warm CDN / Next.js cache hit -> 0 reads
  assert.equal(
    estimateCategoryHubCatalogReads({
      cacheHit: true,
      categoryFound: true,
      manifestWarm: true,
      totalCategoryDocs: 40,
      returnedPageItems: 15,
    }),
    0
  );

  // Missing / deleted slug -> 1 read
  assert.equal(
    estimateCategoryHubCatalogReads({
      cacheHit: false,
      categoryFound: false,
      manifestWarm: false,
      totalCategoryDocs: 0,
      returnedPageItems: 0,
    }),
    1
  );

  // Warm manifest Page 2 (15 items) -> 1 category projection + 15 card projections = 16 reads
  assert.equal(
    estimateCategoryHubCatalogReads({
      cacheHit: false,
      categoryFound: true,
      manifestWarm: true,
      totalCategoryDocs: 45,
      returnedPageItems: 15,
    }),
    16
  );
});
