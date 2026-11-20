import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCartSummary,
  computeDiscountPercent,
  deriveMonogram,
  formatPrice,
  makeCompositeKey,
  makeFirestoreSafeCartKey,
  reconcileCartAgainstOwned,
  resolveContentTypeVisual,
} from './content-type-registry';
import type { CartItem } from '../types/catalog';

test('deriveMonogram extracts uppercase initials from first two words or 2-char fallback', () => {
  assert.equal(deriveMonogram('Indian History MCQs Free Sample Book'), 'IH');
  assert.equal(deriveMonogram('Online Exam IBPS E1'), 'OE');
  assert.equal(deriveMonogram('Macroeconomics'), 'MA');
  assert.equal(deriveMonogram('  quantitative - aptitude  '), 'QA');
  assert.equal(deriveMonogram('A'), 'AX');
  assert.equal(deriveMonogram(''), 'ED');
});

test('resolveContentTypeVisual performs case-insensitive match + collection fallback', () => {
  assert.equal(resolveContentTypeVisual('Ebook', 'books').bgHex, '#81D44C');
  assert.equal(resolveContentTypeVisual('EXAM', 'books').bgHex, '#4CC2D4');
  assert.equal(resolveContentTypeVisual('Quizbook', 'books').bgHex, '#924CD4');
  assert.equal(resolveContentTypeVisual('Question Bank', 'books').bgHex, '#924CD4');
  assert.equal(resolveContentTypeVisual('TEST_SERIES', 'ExamPackDocument').bgHex, '#4CC2D4');
  // Unknown custom type falls back to collection
  assert.equal(resolveContentTypeVisual('Reference Manual', 'books').bgHex, '#81D44C');
  assert.equal(resolveContentTypeVisual('Assessment Pack', 'ExamPackDocument').bgHex, '#4CC2D4');
});

test('computeDiscountPercent and formatPrice handle pricing edge cases accurately', () => {
  assert.equal(computeDiscountPercent(300, 200), 33);
  assert.equal(computeDiscountPercent(120, 100), 17);
  assert.equal(computeDiscountPercent(100, 100), 0);
  assert.equal(computeDiscountPercent(100, 150), 0);
  assert.equal(computeDiscountPercent(200, 0), 100);
  assert.match(formatPrice(200, 'INR'), /200/);
});

test('calculateCartSummary computes savings and detects currency conflicts, reconcile strips owned', () => {
  const b1: CartItem = {
    compositeKey: makeCompositeKey('books', 'B1'),
    firestoreKey: makeFirestoreSafeCartKey('books', 'B1'),
    id: 'B1',
    collectionName: 'books',
    urlSlug: 'indian-history-mcqs-free-sample-book-b1',
    title: 'Indian History MCQs',
    authorName: 'ExamDash Editorial',
    language: 'English',
    type: 'Question Bank',
    currency: 'INR',
    listPrice: 120,
    buyPrice: 100,
  };
  const e1: CartItem = {
    compositeKey: makeCompositeKey('ExamPackDocument', 'E1'),
    firestoreKey: makeFirestoreSafeCartKey('ExamPackDocument', 'E1'),
    id: 'E1',
    collectionName: 'ExamPackDocument',
    urlSlug: 'online-exam-ibps-e1',
    title: 'Online Exam IBPS',
    authorName: 'ExamDash Faculty',
    language: 'English',
    type: 'TEST_SERIES',
    currency: 'INR',
    listPrice: 300,
    buyPrice: 200,
  };

  const summary = calculateCartSummary([b1, e1]);
  assert.equal(summary.itemCount, 2);
  assert.equal(summary.currency, 'INR');
  assert.equal(summary.listTotal, 420);
  assert.equal(summary.buyTotal, 300);
  assert.equal(summary.totalSavings, 120);
  assert.equal(summary.hasCurrencyConflict, false);

  const owned = new Set<string>(['books:B1']);
  const reconciled = reconcileCartAgainstOwned([b1, e1], owned);
  assert.equal(reconciled.removedCount, 1);
  assert.equal(reconciled.remaining.length, 1);
  assert.equal(reconciled.remaining[0].id, 'E1');
});
