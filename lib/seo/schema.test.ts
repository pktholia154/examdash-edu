import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBookDetailJsonLd,
  buildExamDetailJsonLd,
  buildThumbUrls,
  normalizeSchemaLanguageTag,
  serializeSafeJsonLd,
} from './schema';
import { prepareEditorialMarkdown } from '../../components/editorial/description-markdown';
import { apiUrl } from '../platform/api-base';
import { toCatalogCardDTO, type PublicBookDTO, type PublicExamDTO } from '../types/catalog';

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
