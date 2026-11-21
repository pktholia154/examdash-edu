import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeterministicReviewId,
  buildReviewTargetKey,
  computeItemReviewSummary,
  computeReviewAggregateMap,
  validateReviewSubmission,
} from './validation';
import { toCatalogCardDTO, type PublicBookDTO } from '../types/catalog';

const TEST_BOOK: PublicBookDTO = {
  id: 'B1',
  collectionName: 'books',
  title: 'Indian History MCQs',
  urlSlug: 'indian-history-mcqs-free-sample-book-b1',
  seoDescription: 'Indian History Question Bank (Includes Free Sample)',
  fullDescription: 'Comprehensive chapter-wise MCQs.',
  type: 'Question Bank',
  language: 'English',
  publisher: 'ExamDash',
  authorName: 'ExamDash Editorial',
  tags: ['History'],
  currency: 'INR',
  listPrice: 199,
  buyPrice: 99,
  publishAtIso: '2026-01-01T00:00:00.000Z',
  updatedAtIso: '2026-02-01T00:00:00.000Z',
  createdAtIso: '2026-01-01T00:00:00.000Z',
  samplePdfUrl: '',
  sampleMarkdownUrl: '',
  hasFullPdf: true,
  hasFullMarkdown: true,
};

test('deterministic review IDs and target keys match firestore.rules composite format', () => {
  assert.equal(buildReviewTargetKey('books', 'B1'), 'books_B1');
  assert.equal(
    buildDeterministicReviewId('books', 'B1', 'uid_abc123'),
    'books_B1_uid_abc123'
  );
  assert.equal(
    buildDeterministicReviewId('ExamPackDocument', 'E1', 'uid_abc123'),
    'ExamPackDocument_E1_uid_abc123'
  );
});

test('validateReviewSubmission enforces integer 1..5 stars, optional <=120 headline, and 10..2000 char comment', () => {
  assert.equal(
    validateReviewSubmission({ rating: 0, comment: 'Valid length review comment.' }).ok,
    false
  );
  assert.equal(
    validateReviewSubmission({ rating: 6, comment: 'Valid length review comment.' }).ok,
    false
  );
  assert.equal(
    validateReviewSubmission({ rating: 4.5, comment: 'Valid length review comment.' }).ok,
    false
  );
  assert.equal(
    validateReviewSubmission({ rating: 5, comment: 'Too short' }).ok,
    false
  );
  assert.equal(
    validateReviewSubmission({
      rating: 5,
      title: 'x'.repeat(121),
      comment: 'Valid length review comment.',
    }).ok,
    false
  );

  const valid = validateReviewSubmission({
    rating: 5,
    title: '  Clear chapter organization  ',
    comment: '  Well structured explanations for modern history topics.  ',
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.rating, 5);
    assert.equal(valid.title, 'Clear chapter organization');
    assert.equal(
      valid.comment,
      'Well structured explanations for modern history topics.'
    );
  }
});

test('computeItemReviewSummary returns zero counts with empty list and accurate distribution when real reviews exist', () => {
  const empty = computeItemReviewSummary('books', 'B1', []);
  assert.equal(empty.reviewCount, 0);
  assert.equal(empty.averageRating, 0);
  assert.deepEqual(empty.distribution, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  assert.equal(empty.reviews.length, 0);

  const populated = computeItemReviewSummary('books', 'B1', [
    {
      reviewId: 'books_B1_u1',
      targetKey: 'books_B1',
      collectionName: 'books',
      itemId: 'B1',
      urlSlug: 'indian-history-mcqs-free-sample-book-b1',
      userId: 'u1',
      authorName: 'Learner One',
      rating: 4,
      comment: 'Detailed chronological questions with helpful hints.',
      verifiedPurchase: false,
      createdAtIso: '2026-11-18T10:00:00.000Z',
      updatedAtIso: '2026-11-18T10:00:00.000Z',
    },
    {
      reviewId: 'books_B1_u2',
      targetKey: 'books_B1',
      collectionName: 'books',
      itemId: 'B1',
      urlSlug: 'indian-history-mcqs-free-sample-book-b1',
      userId: 'u2',
      authorName: 'Learner Two',
      rating: 5,
      title: 'Great revision bank',
      comment: 'Helped revise modern history thoroughly before prelims.',
      verifiedPurchase: true,
      createdAtIso: '2026-11-20T10:00:00.000Z',
      updatedAtIso: '2026-11-20T10:00:00.000Z',
    },
  ]);

  assert.equal(populated.reviewCount, 2);
  assert.equal(populated.averageRating, 4.5);
  assert.deepEqual(populated.distribution, { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 });
  // Sorted newest first
  assert.equal(populated.reviews[0].userId, 'u2');
  assert.equal(populated.reviews[1].userId, 'u1');
});

test('computeReviewAggregateMap and toCatalogCardDTO omit ratings when 0 and attach real aggregates when > 0', () => {
  const cardWithoutReviews = toCatalogCardDTO(TEST_BOOK);
  assert.equal('averageRating' in cardWithoutReviews, false);
  assert.equal('reviewCount' in cardWithoutReviews, false);

  const aggMap = computeReviewAggregateMap([
    { targetKey: 'books_B1', rating: 5 },
    { targetKey: 'books_B1', rating: 4 },
    { targetKey: 'books_B1', rating: 5 },
  ]);
  const badge = aggMap.get('books_B1');
  assert.ok(badge);
  assert.equal(badge.reviewCount, 3);
  assert.equal(badge.averageRating, 4.67);

  const cardWithReviews = toCatalogCardDTO(TEST_BOOK, badge);
  assert.equal(cardWithReviews.reviewCount, 3);
  assert.equal(cardWithReviews.averageRating, 4.67);
});
