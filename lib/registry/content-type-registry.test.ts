import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCartSummary,
  computeDiscountPercent,
  formatPrice,
  makeCompositeKey,
  makeFirestoreSafeCartKey,
  reconcileCartAgainstOwned,
} from './content-type-registry';
import type { CartItem } from '../types/catalog';

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
