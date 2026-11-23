import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBookDetailJsonLd,
  buildCanonicalAlternates,
  buildCollectionHubJsonLd,
  buildExamDetailJsonLd,
  buildThumbUrls,
  normalizeSchemaLanguageTag,
  serializeSafeJsonLd,
} from './schema';
import {
  buildCatalogRssFeedXml,
  buildSitemapIndexXml,
  buildSitemapManifest,
  resolveSitemapShardXml,
  SITEMAP_BATCH_SIZE,
  SITEMAP_RECENT_UPDATES_LIMIT,
} from './sitemaps';
import { sanitizeCanonicalUrlBatch } from './indexnow';
import {
  buildPaginationHref,
  buildVisiblePageNumbers,
} from '../../components/ui/server-pagination';
import { prepareEditorialMarkdown } from '../../components/editorial/description-markdown';
import { apiUrl } from '../platform/api-base';
import { toCatalogCardDTO, type PublicBookDTO, type PublicExamDTO } from '../types/catalog';
import type { SitemapCatalogEntry } from '../../server/repositories/catalog-repository';

const SAMPLE_BOOK: PublicBookDTO = {
  id: 'book_101',
  collectionName: 'books',
  title: 'UPSC Modern History Question Bank',
  urlSlug: 'upsc-modern-history-101',
  seoDescription: 'Chapter-wise UPSC Modern History MCQs. Includes Free Sample.',
  fullDescription: '# UPSC Modern History Question Bank\n\n## Syllabus Coverage\nDetailed notes.',
  type: 'Question Bank',
  language: 'English',
  publisher: 'ExamDash',
  authorName: 'Dr. A. Verma',
  tags: ['UPSC', 'History'],
  currency: 'INR',
  listPrice: 299,
  buyPrice: 199,
  publishAtIso: '2026-01-10T00:00:00.000Z',
  updatedAtIso: '2026-02-15T12:30:00.000Z',
  createdAtIso: '2026-01-01T00:00:00.000Z',
  samplePdfUrl: 'https://example.com/sample.pdf',
  sampleMarkdownUrl: '',
  hasFullPdf: true,
  hasFullMarkdown: false,
};

const SAMPLE_EXAM: PublicExamDTO = {
  id: 'exam_202',
  collectionName: 'ExamPackDocument',
  title: 'SSC CGL Tier-1 Full Mock Series',
  urlSlug: 'ssc-cgl-tier-1-202',
  seoDescription: '20 full-length timed mock tests. Includes Free Sample.',
  fullDescription: '# SSC CGL Tier-1 Full Mock Series\n\nComplete CBT simulation.',
  type: 'Exam',
  language: 'English',
  publisher: 'ExamDash',
  authorName: 'ExamDash Faculty',
  tags: ['SSC', 'CGL'],
  currency: 'INR',
  listPrice: 499,
  buyPrice: 249,
  publishAtIso: '2026-01-10T00:00:00.000Z',
  updatedAtIso: '2026-02-20T08:00:00.000Z',
  createdAtIso: '2026-01-05T00:00:00.000Z',
  totalMocktest: 20,
  MocktestTitles: [
    { id: 'set_1', title: 'Mock 01', duration: 60, totalQuestions: 100, totalMarks: 200 },
  ],
  sampleJsonStoragePath: 'public/exam_samples/exam_202.json',
  hasFullJson: true,
};

test('buildThumbUrls generates immutable versioned sq and og PNG URLs', () => {
  const { sqPngUrl, ogPngUrl } = buildThumbUrls(
    'books',
    'upsc-modern-history-101',
    '2026-02-15T12:30:00.000Z'
  );
  const expectedV = new Date('2026-02-15T12:30:00.000Z').getTime();

  assert.ok(sqPngUrl.endsWith(`/thumbs/sq/books/upsc-modern-history-101.png?v=${expectedV}`));
  assert.ok(ogPngUrl.endsWith(`/thumbs/og/books/upsc-modern-history-101.png?v=${expectedV}`));
});

test('buildBookDetailJsonLd emits ["Product", "Book"] with Brand @type, complete Offer, images, and omits aggregateRating/review when reviewCount is 0', () => {
  const graphDoc = buildBookDetailJsonLd(SAMPLE_BOOK);
  const serialized = serializeSafeJsonLd(graphDoc as unknown as Record<string, unknown>);

  assert.equal(graphDoc['@graph'].length, 2);
  const [breadcrumb, product] = graphDoc['@graph'];

  assert.equal(breadcrumb['@type'], 'BreadcrumbList');
  assert.deepEqual(product['@type'], ['Product', 'Book']);
  assert.equal(product.sku, 'book_101');
  assert.equal(Array.isArray(product.image), true);
  assert.equal(product.image.length, 2);
  assert.ok(product.image[0].includes('/thumbs/sq/books/'));
  assert.ok(product.image[1].includes('/thumbs/og/books/'));
  assert.deepEqual(product.brand, { '@type': 'Brand', name: 'ExamDash' });
  assert.equal(product.inLanguage, 'en');
  assert.equal(product.publisher['@type'], 'Organization');

  assert.equal(product.offers['@type'], 'Offer');
  assert.equal(product.offers.price, '199.00');
  assert.equal(product.offers.priceCurrency, 'INR');
  assert.equal(product.offers.availability, 'https://schema.org/InStock');
  assert.equal(product.offers.itemCondition, 'https://schema.org/NewCondition');
  assert.deepEqual(product.offers.seller, { '@id': 'https://exam-dash.com/#organization' });
  assert.equal(product.offers.shippingDetails['@type'], 'OfferShippingDetails');
  assert.equal(product.offers.shippingDetails.shippingRate.value, '0.00');
  assert.equal(product.offers.hasMerchantReturnPolicy['@type'], 'MerchantReturnPolicy');

  // Ensure zero fake/empty review fields and zero paywall hasPart/isAccessibleForFree
  assert.equal('aggregateRating' in product, false);
  assert.equal('review' in product, false);
  assert.equal(serialized.includes('"hasPart"'), false);
  assert.equal(serialized.includes('"isAccessibleForFree"'), false);
  assert.equal(
    graphDoc['@graph'].some((node) => (node as { '@type'?: unknown })['@type'] === 'Organization'),
    false
  );
});

test('buildBookDetailJsonLd and buildExamDetailJsonLd include 1:1 AggregateRating and Review nodes strictly when real reviews exist', () => {
  const examNoReviews = buildExamDetailJsonLd(SAMPLE_EXAM, {
    targetKey: 'ExamPackDocument_exam_202',
    collectionName: 'ExamPackDocument',
    itemId: 'exam_202',
    reviewCount: 0,
    averageRating: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    reviews: [],
  });
  const [, emptyExamProduct] = examNoReviews['@graph'];
  assert.deepEqual(emptyExamProduct.brand, { '@type': 'Brand', name: 'ExamDash' });
  assert.equal(emptyExamProduct.releaseDate, '2026-01-10T00:00:00.000Z');
  assert.equal('aggregateRating' in emptyExamProduct, false);
  assert.equal('review' in emptyExamProduct, false);

  const examWithRealReview = buildExamDetailJsonLd(SAMPLE_EXAM, {
    targetKey: 'ExamPackDocument_exam_202',
    collectionName: 'ExamPackDocument',
    itemId: 'exam_202',
    reviewCount: 2,
    averageRating: 4.5,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 },
    reviews: [
      {
        reviewId: 'ExamPackDocument_exam_202_u1',
        targetKey: 'ExamPackDocument_exam_202',
        collectionName: 'ExamPackDocument',
        itemId: 'exam_202',
        urlSlug: 'ssc-cgl-tier-1-202',
        userId: 'u1',
        authorName: 'R. Sharma',
        rating: 5,
        title: 'Accurate Tier-1 difficulty',
        comment: 'Timed sections and detailed explanations closely mirror the real exam.',
        verifiedPurchase: true,
        createdAtIso: '2026-11-20T10:00:00.000Z',
        updatedAtIso: '2026-11-20T10:00:00.000Z',
      },
      {
        reviewId: 'ExamPackDocument_exam_202_u2',
        targetKey: 'ExamPackDocument_exam_202',
        collectionName: 'ExamPackDocument',
        itemId: 'exam_202',
        urlSlug: 'ssc-cgl-tier-1-202',
        userId: 'u2',
        authorName: 'K. Nair',
        rating: 4,
        comment: 'Strong quantitative aptitude sets with clear step-by-step solutions.',
        verifiedPurchase: false,
        createdAtIso: '2026-11-19T08:00:00.000Z',
        updatedAtIso: '2026-11-19T08:00:00.000Z',
      },
    ],
  });

  const [breadcrumb, ratedProduct] = examWithRealReview['@graph'];
  assert.equal(breadcrumb['@type'], 'BreadcrumbList');
  assert.equal(ratedProduct['@type'], 'Product');
  assert.equal(ratedProduct.sku, 'exam_202');
  assert.equal(ratedProduct.offers.price, '249.00');
  assert.equal(ratedProduct.url, breadcrumb.itemListElement[2].item);
  assert.equal(ratedProduct.url.endsWith('/'), false);

  const productAny = ratedProduct as Record<string, unknown>;
  assert.deepEqual(productAny.aggregateRating, {
    '@type': 'AggregateRating',
    ratingValue: 4.5,
    reviewCount: 2,
    bestRating: 5,
    worstRating: 1,
  });
  const schemaReviews = productAny.review as Array<Record<string, unknown>>;
  assert.equal(schemaReviews.length, 2);
  assert.equal(schemaReviews[0]['@type'], 'Review');
  assert.equal(schemaReviews[0].name, 'Accurate Tier-1 difficulty');
  assert.equal(schemaReviews[0].datePublished, '2026-11-20');
});

test('prepareEditorialMarkdown strips leading duplicate hero heading while preserving body headings', () => {
  const stripped = prepareEditorialMarkdown(
    '# UPSC Modern History Question Bank\n\n## Chapter 1\nContent here.',
    'UPSC Modern History Question Bank'
  );
  assert.equal(stripped, '## Chapter 1\nContent here.');

  const kept = prepareEditorialMarkdown(
    '# Key Exam Strategy\n\nFocus on PYQs.',
    'UPSC Modern History Question Bank'
  );
  assert.equal(kept, '# Key Exam Strategy\n\nFocus on PYQs.');
});

test('toCatalogCardDTO omits fullDescription, seoDescription, and MocktestTitles from RSC card payloads', () => {
  const slimBook = toCatalogCardDTO(SAMPLE_BOOK);
  const slimExam = toCatalogCardDTO(SAMPLE_EXAM);
  const json = JSON.stringify([slimBook, slimExam]);

  assert.equal(json.includes('fullDescription'), false);
  assert.equal(json.includes('seoDescription'), false);
  assert.equal(json.includes('MocktestTitles'), false);
  assert.equal(slimExam.totalMocktest, 20);
});

test('apiUrl prefixes relative API paths and preserves absolute URLs', () => {
  assert.equal(apiUrl('/api/v1/library'), '/api/v1/library');
  assert.equal(apiUrl('https://exam-dash.com/api/v1/library'), 'https://exam-dash.com/api/v1/library');
});

test('normalizeSchemaLanguageTag normalizes prose language labels to standard BCP-47 tags', () => {
  assert.equal(normalizeSchemaLanguageTag('English'), 'en');
  assert.equal(normalizeSchemaLanguageTag('Hindi'), 'hi');
  assert.equal(normalizeSchemaLanguageTag('Bilingual'), 'en-IN');
  assert.equal(normalizeSchemaLanguageTag('en-IN'), 'en-IN');
  assert.equal(normalizeSchemaLanguageTag(''), 'en');
});

test('batched sitemaps organize 3,900+ products into 1,000-URL shards with isolated per-batch lastmod and zero priority/changefreq', () => {
  const makeEntry = (
    collectionName: 'books' | 'ExamPackDocument',
    idx: number,
    updatedIso: string
  ): SitemapCatalogEntry => ({
    id: `${collectionName}_${idx}`,
    collectionName,
    title: `${collectionName === 'books' ? 'Book' : 'Exam'} #${idx}`,
    urlSlug: `${collectionName === 'books' ? 'book' : 'exam'}-slug-${idx}`,
    seoDescription: `Verified resource #${idx}`,
    type: collectionName === 'books' ? 'Ebook' : 'Exam',
    authorName: 'ExamDash Editorial',
    currency: 'INR',
    buyPrice: 99,
    publishAtIso: '2026-01-01T00:00:00.000Z',
    updatedAtIso: updatedIso,
  });

  // 2,500 books -> 3 shards (1000, 1000, 500)
  const books: SitemapCatalogEntry[] = [];
  for (let i = 1; i <= 2500; i++) {
    const batchIso =
      i <= 1000
        ? '2026-03-01T00:00:00.000Z'
        : i === 1500
        ? '2026-11-22T18:00:00.000Z' // Substantive edit inside batch 2!
        : '2026-06-01T00:00:00.000Z';
    books.push(makeEntry('books', i, batchIso));
  }

  // 1,400 exams -> 2 shards (1000, 400)
  const exams: SitemapCatalogEntry[] = [];
  for (let i = 1; i <= 1400; i++) {
    exams.push(
      makeEntry(
        'ExamPackDocument',
        i,
        i > 1000 ? '2026-11-20T10:00:00.000Z' : '2026-04-01T00:00:00.000Z'
      )
    );
  }

  assert.equal(SITEMAP_BATCH_SIZE, 1000);
  assert.equal(SITEMAP_RECENT_UPDATES_LIMIT, 200);

  const manifest = buildSitemapManifest({
    books,
    exams,
    origin: 'https://exam-dash.com',
  });

  // pages.xml + updates.xml + books-1..3 + exams-1..2 = 7 shards
  assert.deepEqual(
    manifest.shards.map((s) => s.shardName),
    [
      'pages.xml',
      'updates.xml',
      'books-1.xml',
      'books-2.xml',
      'books-3.xml',
      'exams-1.xml',
      'exams-2.xml',
    ]
  );

  // Batch 1 lastmod remains untouched while Batch 2 & updates.xml reflect the newest edit!
  const shardByName = new Map(manifest.shards.map((s) => [s.shardName, s]));
  assert.equal(shardByName.get('books-1.xml')?.lastmod, '2026-03-01T00:00:00.000Z');
  assert.equal(shardByName.get('books-2.xml')?.lastmod, '2026-11-22T18:00:00.000Z');
  assert.equal(shardByName.get('books-3.xml')?.lastmod, '2026-06-01T00:00:00.000Z');
  assert.equal(shardByName.get('exams-1.xml')?.lastmod, '2026-04-01T00:00:00.000Z');
  assert.equal(shardByName.get('exams-2.xml')?.lastmod, '2026-11-20T10:00:00.000Z');
  assert.equal(shardByName.get('updates.xml')?.lastmod, '2026-11-22T18:00:00.000Z');

  const indexXml = buildSitemapIndexXml(manifest.shards);
  assert.ok(indexXml.includes('<sitemapindex'));
  assert.ok(indexXml.includes('https://exam-dash.com/sitemaps/books-2.xml'));
  assert.equal(indexXml.includes('<priority>'), false);
  assert.equal(indexXml.includes('<changefreq>'), false);

  const books3Xml = resolveSitemapShardXml({
    rawShardParam: 'books-3.xml',
    books,
    exams,
    origin: 'https://exam-dash.com',
  });
  assert.ok(books3Xml);
  assert.ok(books3Xml.includes('https://exam-dash.com/books/book-slug-2500'));
  assert.ok(books3Xml.includes('<image:image>'));
  assert.equal(books3Xml.includes('<priority>'), false);
  assert.equal(books3Xml.includes('<changefreq>'), false);

  // Out-of-bounds shard returns null (404)
  assert.equal(
    resolveSitemapShardXml({
      rawShardParam: 'books-4.xml',
      books,
      exams,
      origin: 'https://exam-dash.com',
    }),
    null
  );

  // RSS 2.0 + Atom feed puts the freshly updated item (#1500) at position 1
  const rssXml = buildCatalogRssFeedXml({
    books,
    exams,
    origin: 'https://exam-dash.com',
    limit: 20,
  });
  assert.ok(rssXml.includes('<rss version="2.0"'));
  assert.ok(rssXml.includes('<atom:updated>2026-11-22T18:00:00.000Z</atom:updated>'));
  assert.ok(
    rssXml.indexOf('book-slug-1500') < rssXml.indexOf('exam-slug-1001')
  );
});

test('IndexNow batch sanitizer locks URLs strictly to canonical origin and blocks private/trap routes', () => {
  const sanitized = sanitizeCanonicalUrlBatch(
    [
      '/books/upsc-modern-history-101',
      'https://exam-dash.com/exams/ssc-cgl-tier-1-202#reviews',
      'https://evil-attacker.example/books/phish',
      'http://exam-dash.com/books/insecure-http',
      'https://exam-dash.com/purchased',
      'https://exam-dash.com/search?q=upsc',
      'https://exam-dash.com/attempt/ssc-cgl-tier-1-202/set_1',
      '/books/upsc-modern-history-101', // duplicate
    ],
    'https://exam-dash.com'
  );

  assert.deepEqual(sanitized, [
    'https://exam-dash.com/books/upsc-modern-history-101',
    'https://exam-dash.com/exams/ssc-cgl-tier-1-202',
  ]);
});

test('ServerPagination and buildCanonicalAlternates enforce ?page=1-free base URLs and CollectionPage JSON-LD', () => {
  assert.equal(buildPaginationHref('/books', 1), '/books');
  assert.equal(buildPaginationHref('/books', 2), '/books?page=2');

  const windowTokens = buildVisiblePageNumbers(50, 200);
  assert.deepEqual(windowTokens, [1, 'ellipsis-start', 49, 50, 51, 'ellipsis-end', 200]);

  const alts = buildCanonicalAlternates('/books?page=3', { includeRssFeed: true });
  assert.equal(alts.canonical, 'https://exam-dash.com/books?page=3');
  assert.equal(alts.languages['en-IN'], 'https://exam-dash.com/books?page=3');
  assert.equal(alts.types?.['application/rss+xml'], 'https://exam-dash.com/feed.xml');

  const hubGraph = buildCollectionHubJsonLd({
    collection: 'books',
    title: 'Books Page 2',
    description: 'Catalog page 2',
    pageNum: 2,
    items: [SAMPLE_BOOK],
  });
  assert.equal(hubGraph['@graph'].length, 2);
  assert.equal(hubGraph['@graph'][1]['@type'], 'CollectionPage');
  assert.equal(hubGraph['@graph'][1].mainEntity?.itemListElement[0].position, 21);
});

