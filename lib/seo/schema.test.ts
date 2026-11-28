import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { middleware } from '../../middleware';
import {
  buildBookDetailJsonLd,
  buildCanonicalAlternates,
  buildCategoryHubJsonLd,
  buildCollectionHubJsonLd,
  buildExamDetailJsonLd,
  buildItemCoverSchemaImage,
  buildSiteOgUrl,
  extractRequestHostname,
  getCanonicalOrigin,
  hasFacetFilterParams,
  isDefaultFirebaseOrCloudRunHost,
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
  executePublishWebhookPipeline,
  prewarmCanonicalUrls,
} from './publish-webhook';
import {
  buildPaginationHref,
  buildVisiblePageNumbers,
} from '../../components/ui/server-pagination';
import {
  prepareEditorialMarkdown,
  sanitizeEditorialUrl,
} from '../../components/editorial/description-markdown';
import { apiUrl } from '../platform/api-base';
import { toCatalogCardDTO, type PublicBookDTO, type PublicExamDTO } from '../types/catalog';
import type { SitemapCatalogEntry } from '../../server/repositories/catalog-repository';

const SAMPLE_COVER_URL =
  'https://firebasestorage.googleapis.com/v0/b/examdash-ed.firebasestorage.app/o/public%2Fcovers%2Fbook_101.png?alt=media&token=test';

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
  imageUrl: SAMPLE_COVER_URL,
  imageMeta: {
    alt: 'UPSC Modern History Question Bank Cover',
    title: 'UPSC Modern History Question Bank | ExamDash',
    caption: 'Book cover of UPSC Modern History Question Bank by Dr. A. Verma.',
    description: 'Chapter-wise UPSC Modern History MCQs cover.',
    keywords: 'UPSC, Modern History, Question Bank',
  },
  bookChapters: [
    'Chapter 1: Decline of the Mughal Empire',
    'Chapter 2: Advent of the Europeans',
  ],
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
  imageUrl: '',
  totalMocktest: 20,
  MocktestTitles: [
    { id: 'set_1', title: 'Mock 01', duration: 60, totalQuestions: 100, totalMarks: 200 },
  ],
  sampleJsonStoragePath: 'public/exam_samples/exam_202.json',
  hasFullJson: true,
};

test('buildItemCoverSchemaImage builds SEO ImageObject from imageUrl + imageMeta and falls back to brand PNG when empty', () => {
  const imgObj = buildItemCoverSchemaImage({
    pageUrl: 'https://exam-dash.com/books/upsc-modern-history-101',
    title: SAMPLE_BOOK.title,
    fallbackDescription: SAMPLE_BOOK.seoDescription,
    imageUrl: SAMPLE_BOOK.imageUrl,
    imageMeta: SAMPLE_BOOK.imageMeta,
  }) as Record<string, unknown>;

  assert.equal(imgObj['@type'], 'ImageObject');
  assert.equal(imgObj.url, SAMPLE_COVER_URL);
  assert.equal(imgObj.contentUrl, SAMPLE_COVER_URL);
  assert.equal(imgObj.encodingFormat, 'image/png');
  assert.equal(imgObj.name, 'UPSC Modern History Question Bank | ExamDash');
  assert.equal(
    imgObj.caption,
    'Book cover of UPSC Modern History Question Bank by Dr. A. Verma.'
  );
  assert.equal(imgObj.keywords, 'UPSC, Modern History, Question Bank');

  const fallback = buildItemCoverSchemaImage({
    pageUrl: 'https://exam-dash.com/exams/ssc-cgl-tier-1-202',
    title: SAMPLE_EXAM.title,
    fallbackDescription: SAMPLE_EXAM.seoDescription,
    imageUrl: '',
  });
  assert.equal(fallback, buildSiteOgUrl());
  assert.equal(String(fallback).includes('/thumbs/'), false);
});

test('buildBookDetailJsonLd emits ["Product", "Book"] with Brand @type, complete Offer, ImageObject, and omits aggregateRating/review when reviewCount is 0', () => {
  const graphDoc = buildBookDetailJsonLd(SAMPLE_BOOK);
  const serialized = serializeSafeJsonLd(graphDoc as unknown as Record<string, unknown>);

  assert.equal(graphDoc['@graph'].length, 2);
  const [breadcrumb, product] = graphDoc['@graph'];

  assert.equal(breadcrumb['@type'], 'BreadcrumbList');
  assert.deepEqual(product['@type'], ['Product', 'Book']);
  assert.equal(product.sku, 'book_101');
  const coverImage = product.image as Record<string, unknown>;
  assert.equal(coverImage['@type'], 'ImageObject');
  assert.equal(coverImage.url, SAMPLE_COVER_URL);
  assert.equal(serialized.includes('/thumbs/'), false);
  assert.deepEqual(product.brand, { '@type': 'Brand', name: 'ExamDash' });
  assert.equal(product.inLanguage, 'en');
  assert.equal(product.publisher['@type'], 'Organization');

  assert.equal(product.offers['@type'], 'Offer');
  assert.equal(product.offers.price, '119.00');
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
  assert.equal(ratedProduct.offers.price, '125.00');
  assert.equal(ratedProduct.url, breadcrumb.itemListElement[2].item);
  assert.equal(ratedProduct.url.endsWith('/'), false);

  const productAny = ratedProduct as Record<string, unknown>;
  assert.deepEqual(productAny.aggregateRating, {
    '@type': 'AggregateRating',
    ratingValue: 4.5,
    ratingCount: 2,
    reviewCount: 2,
    bestRating: 5,
    worstRating: 1,
  });
  const schemaReviews = productAny.review as Array<Record<string, unknown>>;
  assert.equal(schemaReviews.length, 2);
  assert.equal(schemaReviews[0]['@type'], 'Review');
  assert.equal(
    schemaReviews[0]['@id'],
    'https://exam-dash.com/exams/ssc-cgl-tier-1-202#review-ExamPackDocument_exam_202_u1'
  );
  assert.equal(schemaReviews[0].name, 'Accurate Tier-1 difficulty');
  assert.equal(schemaReviews[0].datePublished, '2026-11-20');

  // Guard against epoch 1970-01-01 dates leaking into Review.datePublished
  const bookWithEpochReview = buildBookDetailJsonLd(SAMPLE_BOOK, {
    targetKey: 'books_book_101',
    collectionName: 'books',
    itemId: 'book_101',
    reviewCount: 1,
    averageRating: 5,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
    reviews: [
      {
        reviewId: 'books_book_101_u9',
        targetKey: 'books_book_101',
        collectionName: 'books',
        itemId: 'book_101',
        urlSlug: 'upsc-modern-history-101',
        userId: 'u9',
        authorName: 'A. Patel',
        rating: 5,
        comment: 'Well-organized questions for revision.',
        verifiedPurchase: true,
        createdAtIso: new Date(0).toISOString(),
        updatedAtIso: new Date(0).toISOString(),
      },
    ],
  });
  const [, epochBookProduct] = bookWithEpochReview['@graph'];
  const epochReviews = (epochBookProduct as Record<string, unknown>).review as Array<
    Record<string, unknown>
  >;
  assert.equal(epochReviews.length, 1);
  assert.equal('datePublished' in epochReviews[0], false);
});

test('prepareEditorialMarkdown strips leading duplicate hero heading while preserving body and rich category headings', () => {
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

  const keptCategoryHeading = prepareEditorialMarkdown(
    '# Banking/IBPS Exam Books – Download Top eBooks, PDFs, Guides & PYQs\n\n## Syllabus Coverage\nDetails.',
    'Banking'
  );
  assert.equal(
    keptCategoryHeading,
    '# Banking/IBPS Exam Books – Download Top eBooks, PDFs, Guides & PYQs\n\n## Syllabus Coverage\nDetails.'
  );
});

test('toCatalogCardDTO omits fullDescription, seoDescription, bookChapters, and MocktestTitles while retaining imageUrl & imageAlt', () => {
  const slimBook = toCatalogCardDTO(SAMPLE_BOOK);
  const slimExam = toCatalogCardDTO(SAMPLE_EXAM);
  const json = JSON.stringify([slimBook, slimExam]);

  assert.equal(json.includes('fullDescription'), false);
  assert.equal(json.includes('seoDescription'), false);
  assert.equal(json.includes('bookChapters'), false);
  assert.equal(json.includes('MocktestTitles'), false);
  assert.equal(slimBook.imageUrl, SAMPLE_COVER_URL);
  assert.equal(slimBook.imageAlt, 'UPSC Modern History Question Bank Cover');
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
    ...(collectionName === 'books'
      ? {
          imageUrl: `https://firebasestorage.googleapis.com/v0/b/examdash-ed.firebasestorage.app/o/public%2Fcovers%2Fbook_${idx}.png?alt=media`,
          imageMeta: {
            title: `Book #${idx} Cover`,
            caption: `Cover of Book #${idx}`,
          },
        }
      : {}),
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
  assert.ok(books3Xml.includes('<image:caption>Cover of Book #2500</image:caption>'));
  assert.equal(books3Xml.includes('/thumbs/'), false);
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
  assert.deepEqual(buildVisiblePageNumbers(1, 10), [1, 2, 3, 'ellipsis-end', 10]);
  assert.deepEqual(buildVisiblePageNumbers(10, 10), [1, 'ellipsis-start', 8, 9, 10]);

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

test('hasFacetFilterParams flags filter/sort/search query params for GSC noindex while allowing clean pagination & utm params', () => {
  assert.equal(hasFacetFilterParams({ page: '2' }), false);
  assert.equal(hasFacetFilterParams(new URLSearchParams('page=3&utm_source=google')), false);
  assert.equal(hasFacetFilterParams({ sort: 'price' }), true);
  assert.equal(hasFacetFilterParams(new URLSearchParams('page=2&filter=free')), true);
  assert.equal(hasFacetFilterParams(new URLSearchParams('q=upsc')), true);
  assert.equal(hasFacetFilterParams({ tag: 'history' }), true);
});

test('sanitizeEditorialUrl blocks unsafe javascript: and data: schemes while preserving https and relative anchors', () => {
  assert.equal(sanitizeEditorialUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeEditorialUrl('data:text/html;base64,PHNjcmlwdD4='), '');
  assert.equal(sanitizeEditorialUrl('//evil.example/payload'), '');
  assert.equal(sanitizeEditorialUrl('/books/upsc-modern-history-101'), '/books/upsc-modern-history-101');
  assert.equal(sanitizeEditorialUrl('#syllabus'), '#syllabus');
  assert.equal(sanitizeEditorialUrl('https://exam-dash.com/books'), 'https://exam-dash.com/books');
});

test('executePublishWebhookPipeline validates Zod payload, computes revalidated paths, and blocks SSRF prewarm hosts', async () => {
  const badPayload = await executePublishWebhookPipeline(
    { items: [{ collectionName: 'unknown_col', urlSlug: '' }] },
    { skipPrewarmInTests: true }
  );
  assert.equal(badPayload.ok, false);
  assert.equal(badPayload.statusCode, 400);

  const validRun = await executePublishWebhookPipeline(
    {
      items: [
        {
          collectionName: 'books',
          urlSlug: 'upsc-modern-history-101',
          action: 'publish',
        },
      ],
      urls: ['/exams/ssc-cgl-tier-1-202'],
    },
    { skipPrewarmInTests: true }
  );
  assert.equal(validRun.ok, true);
  assert.equal(validRun.cacheInvalidated, true);
  assert.ok(validRun.revalidatedPaths?.includes('/'));
  assert.ok(validRun.revalidatedPaths?.includes('/books'));
  assert.ok(validRun.revalidatedPaths?.includes('/books/upsc-modern-history-101'));
  assert.ok(validRun.revalidatedPaths?.includes('/exams/ssc-cgl-tier-1-202'));

  // SSRF guard: loopback, metadata IP, and external origins are rejected before any network call
  const blockedPrewarm = await prewarmCanonicalUrls(
    [
      'http://127.0.0.1:8080/admin',
      'http://169.254.169.254/latest/meta-data/',
      'https://attacker.example/books/test',
    ],
    'https://exam-dash.com'
  );
  assert.deepEqual(blockedPrewarm, []);
});

test('getCanonicalOrigin and isDefaultFirebaseOrCloudRunHost enforce https://exam-dash.com and isolate .web.app, .firebaseapp.com, and .run.app mirrors', () => {
  const prevAppUrl = process.env.APP_URL;
  const prevCanonicalOrigin = process.env.CANONICAL_ORIGIN;
  try {
    process.env.APP_URL = 'https://examdash-ed.web.app';
    process.env.CANONICAL_ORIGIN = 'https://examdash-ed.firebaseapp.com';
    assert.equal(getCanonicalOrigin(), 'https://exam-dash.com');
    assert.equal(
      buildCanonicalAlternates('/').canonical,
      'https://exam-dash.com'
    );
    assert.equal(
      buildCanonicalAlternates('/books/upsc-modern-history-101').canonical,
      'https://exam-dash.com/books/upsc-modern-history-101'
    );
  } finally {
    if (prevAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prevAppUrl;
    if (prevCanonicalOrigin === undefined) delete process.env.CANONICAL_ORIGIN;
    else process.env.CANONICAL_ORIGIN = prevCanonicalOrigin;
  }

  // Default Firebase Hosting & Cloud Run domains -> true
  assert.equal(isDefaultFirebaseOrCloudRunHost('examdash-ed.web.app'), true);
  assert.equal(isDefaultFirebaseOrCloudRunHost('EXAMDASH-ED.FIREBASEAPP.COM'), true);
  assert.equal(
    isDefaultFirebaseOrCloudRunHost('examdash-edu-513220259814.asia-south1.run.app'),
    true
  );
  assert.equal(isDefaultFirebaseOrCloudRunHost('examdash-ed.web.app:443'), true);
  assert.equal(
    isDefaultFirebaseOrCloudRunHost('examdash-ed.web.app, examdash-edu.a.run.app'),
    true
  );

  // Production custom domain (including multi-hop x-forwarded-host behind Firebase Hosting -> Cloud Run) -> false
  assert.equal(isDefaultFirebaseOrCloudRunHost('exam-dash.com'), false);
  assert.equal(isDefaultFirebaseOrCloudRunHost('exam-dash.com:443'), false);
  assert.equal(
    extractRequestHostname('exam-dash.com, examdash-edu-xyz.asia-south1.run.app'),
    'exam-dash.com'
  );
  assert.equal(
    isDefaultFirebaseOrCloudRunHost('exam-dash.com, examdash-edu-xyz.asia-south1.run.app'),
    false
  );
  assert.equal(isDefaultFirebaseOrCloudRunHost('localhost:3000'), false);
  assert.equal(isDefaultFirebaseOrCloudRunHost(''), false);
});

test('middleware returns NextResponse.next() with zero redirects and sets X-Robots-Tag: noindex, nofollow strictly on .web.app, .firebaseapp.com, and .run.app', async () => {
  // 1. Custom domain behind Firebase Hosting -> Cloud Run rewrite: untouched (no X-Robots-Tag, zero redirects)
  const prodReq = new NextRequest('https://examdash-edu.asia-south1.run.app/books', {
    headers: {
      host: 'examdash-edu.asia-south1.run.app',
      'x-forwarded-host': 'exam-dash.com',
    },
  });
  const prodRes = await middleware(prodReq);
  assert.equal(prodRes.status, 200);
  assert.equal(prodRes.headers.get('location'), null);
  assert.equal(prodRes.headers.get('x-robots-tag'), null);

  // 2. .web.app mirror -> 200 OK (no redirect) + X-Robots-Tag: noindex, nofollow
  const webAppReq = new NextRequest('https://examdash-edu.asia-south1.run.app/books', {
    headers: {
      host: 'examdash-edu.asia-south1.run.app',
      'x-forwarded-host': 'examdash-ed.web.app',
    },
  });
  const webAppRes = await middleware(webAppReq);
  assert.equal(webAppRes.status, 200);
  assert.equal(webAppRes.headers.get('location'), null);
  assert.equal(webAppRes.headers.get('x-robots-tag'), 'noindex, nofollow');

  // 3. .firebaseapp.com mirror -> 200 OK (no redirect) + X-Robots-Tag: noindex, nofollow
  const fbAppReq = new NextRequest('https://examdash-edu.asia-south1.run.app/', {
    headers: {
      host: 'examdash-edu.asia-south1.run.app',
      'x-forwarded-host': 'examdash-ed.firebaseapp.com',
    },
  });
  const fbAppRes = await middleware(fbAppReq);
  assert.equal(fbAppRes.status, 200);
  assert.equal(fbAppRes.headers.get('location'), null);
  assert.equal(fbAppRes.headers.get('x-robots-tag'), 'noindex, nofollow');

  // 4. Direct .run.app Cloud Run URL -> 200 OK (no redirect) + X-Robots-Tag: noindex, nofollow
  const runAppReq = new NextRequest('https://examdash-edu.asia-south1.run.app/exams', {
    headers: {
      host: 'examdash-edu.asia-south1.run.app',
    },
  });
  const runAppRes = await middleware(runAppReq);
  assert.equal(runAppRes.status, 200);
  assert.equal(runAppRes.headers.get('location'), null);
  assert.equal(runAppRes.headers.get('x-robots-tag'), 'noindex, nofollow');

  // 5. www.exam-dash.com without ?page=1 -> zero host redirects (status 200, no location header)
  const wwwReq = new NextRequest('https://exam-dash.com/books', {
    headers: {
      host: 'examdash-edu.asia-south1.run.app',
      'x-forwarded-host': 'www.exam-dash.com',
    },
  });
  const wwwRes = await middleware(wwwReq);
  assert.equal(wwwRes.status, 200);
  assert.equal(wwwRes.headers.get('location'), null);
  assert.equal(wwwRes.headers.get('x-robots-tag'), null);

  // 6. ?page=1 on /books and /books/category/[slug] -> single-hop 301 preserving host
  const page1CatReq = new NextRequest(
    'https://examdash-edu.asia-south1.run.app/books/category/cuet-pg?page=1',
    {
      headers: {
        host: 'examdash-edu.asia-south1.run.app',
        'x-forwarded-host': 'exam-dash.com',
        'x-forwarded-proto': 'https',
      },
    }
  );
  const page1CatRes = await middleware(page1CatReq);
  assert.equal(page1CatRes.status, 301);
  assert.equal(
    page1CatRes.headers.get('location'),
    'https://exam-dash.com/books/category/cuet-pg'
  );

  // 7. Legacy /category/[slug]?page=1 -> single-hop 301 to /books/category/[slug]
  const legacyCatReq = new NextRequest(
    'https://examdash-edu.asia-south1.run.app/category/cuet-pg?page=1',
    {
      headers: {
        host: 'examdash-edu.asia-south1.run.app',
        'x-forwarded-host': 'exam-dash.com',
        'x-forwarded-proto': 'https',
      },
    }
  );
  const legacyCatRes = await middleware(legacyCatReq);
  assert.equal(legacyCatRes.status, 301);
  assert.equal(
    legacyCatRes.headers.get('location'),
    'https://exam-dash.com/books/category/cuet-pg'
  );

  // 8. Faceted filter query on Category Hub -> 200 OK + X-Robots-Tag: noindex, follow
  const filteredCatReq = new NextRequest(
    'https://examdash-edu.asia-south1.run.app/books/category/cuet-pg?type=Practice+Tests&language=Sanskrit&price=under-150',
    {
      headers: {
        host: 'examdash-edu.asia-south1.run.app',
        'x-forwarded-host': 'exam-dash.com',
      },
    }
  );
  const filteredCatRes = await middleware(filteredCatReq);
  assert.equal(filteredCatRes.status, 200);
  assert.equal(filteredCatRes.headers.get('x-robots-tag'), 'noindex, follow');
});

test('Hub-and-Spoke Category JSON-LD, 4-level Book Breadcrumbs, Categories Sitemap Shard, and Category Publish Webhook', async () => {
  // 1. Unfiltered Page 2 Category Hub JSON-LD emits global ItemList positions (16, 17)
  const catPage2Graph = buildCategoryHubJsonLd({
    category: {
      slug: 'cuet-pg',
      title: 'CUET PG',
      metaDescription: 'Verified CUET PG practice tests & study books.',
      updatedAtIso: '2026-11-20T00:00:00.000Z',
    },
    pageNum: 2,
    pageSize: 15,
    isFiltered: false,
    items: [
      { title: 'CUET PG Sanskrit Mock Papers', urlSlug: 'cuet-pg-sanskrit' },
      { title: 'CUET PG English Question Bank </script>', urlSlug: 'cuet-pg-english' },
    ],
  });
  const serializedCat = serializeSafeJsonLd(catPage2Graph);
  assert.equal(serializedCat.includes('</script>'), false);
  assert.equal(serializedCat.includes('\\u003c/script>'), true);

  const parsedCat = JSON.parse(serializedCat);
  assert.equal(parsedCat['@graph'][0].itemListElement.length, 4);
  assert.equal(
    parsedCat['@graph'][0].itemListElement[2].item,
    'https://exam-dash.com/books/category/cuet-pg'
  );
  assert.equal(
    parsedCat['@graph'][1].url,
    'https://exam-dash.com/books/category/cuet-pg?page=2'
  );
  assert.equal(parsedCat['@graph'][1].mainEntity.itemListElement[0].position, 16);
  assert.equal(parsedCat['@graph'][1].mainEntity.itemListElement[1].position, 17);

  // 2. Filtered Category Hub JSON-LD omits ItemList and canonicalizes to base Hub URL
  const filteredGraph = buildCategoryHubJsonLd({
    category: {
      slug: 'cuet-pg',
      title: 'CUET PG',
      metaDescription: 'Verified CUET PG practice tests & study books.',
      updatedAtIso: '2026-11-20T00:00:00.000Z',
    },
    pageNum: 2,
    pageSize: 15,
    isFiltered: true,
    items: [{ title: 'CUET PG Sanskrit Mock Papers', urlSlug: 'cuet-pg-sanskrit' }],
  });
  assert.equal(
    filteredGraph['@graph'][1].url,
    'https://exam-dash.com/books/category/cuet-pg'
  );
  assert.equal('mainEntity' in filteredGraph['@graph'][1], false);

  // 3. Book Detail JSON-LD emits 4-crumb BreadcrumbList when category & categorySlug exist
  const categorizedBookJsonLd = buildBookDetailJsonLd({
    ...SAMPLE_BOOK,
    category: 'CUET PG',
    categorySlug: 'cuet-pg',
  });
  const crumbs = categorizedBookJsonLd['@graph'][0].itemListElement as Array<{
    position: number;
    name: string;
    item: string;
  }>;
  assert.equal(crumbs.length, 4);
  assert.equal(crumbs[2].name, 'CUET PG');
  assert.equal(crumbs[2].item, 'https://exam-dash.com/books/category/cuet-pg');
  assert.equal(crumbs[3].position, 4);

  // 4. Sitemaps emit categories-1.xml strictly for non-empty clean Page 1 Category Hubs
  const manifest = buildSitemapManifest({
    books: [],
    exams: [],
    categories: [
      {
        slug: 'cuet-pg',
        title: 'CUET PG',
        updatedAtIso: '2026-11-25T10:00:00.000Z',
        liveBookCount: 2,
      },
      {
        slug: 'empty-category',
        title: 'Empty Category',
        updatedAtIso: '2026-11-25T10:00:00.000Z',
        liveBookCount: 0,
      },
    ],
  });
  assert.equal(
    manifest.shards.some((s) => s.shardName === 'categories-1.xml'),
    true
  );
  const catShardXml = resolveSitemapShardXml({
    rawShardParam: 'categories-1.xml',
    books: [],
    exams: [],
    categories: [
      {
        slug: 'cuet-pg',
        title: 'CUET PG',
        updatedAtIso: '2026-11-25T10:00:00.000Z',
        liveBookCount: 2,
      },
      {
        slug: 'empty-category',
        title: 'Empty Category',
        updatedAtIso: '2026-11-25T10:00:00.000Z',
        liveBookCount: 0,
      },
    ],
  });
  assert.ok(catShardXml);
  assert.match(catShardXml, /https:\/\/exam-dash\.com\/books\/category\/cuet-pg/);
  assert.doesNotMatch(catShardXml, /empty-category/);
  assert.doesNotMatch(catShardXml, /\?page=/);

  // 5. Publish webhook invalidates category paths
  const webhookRes = await executePublishWebhookPipeline(
    {
      items: [{ collectionName: 'category', urlSlug: 'cuet-pg', action: 'update' }],
      invalidateOnly: true,
    },
    { skipPrewarmInTests: true }
  );
  assert.equal(webhookRes.ok, true);
  assert.equal(
    webhookRes.revalidatedPaths?.includes('/books/category/cuet-pg'),
    true
  );
});


