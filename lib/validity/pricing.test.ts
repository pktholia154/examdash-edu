import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addCalendarMonthsUtc,
  computePurchaseExpiryIso,
  filterActivePurchases,
  getDefaultCatalogPricing,
  getValidityOptions,
  isValidValidityMonthsForCollection,
  resolvePurchaseExpiryMeta,
  resolveValiditySelection,
} from './pricing';

test('Exam validity pricing: 1 month 50% off, 6 months full Firebase buyPrice', () => {
  const [shortOpt, longOpt] = getValidityOptions('ExamPackDocument', 400);
  assert.equal(shortOpt.validityMonths, 1);
  assert.equal(shortOpt.label, '1 Month');
  assert.equal(shortOpt.discountPct, 50);
  assert.equal(shortOpt.payablePrice, 200);
  assert.equal(shortOpt.fullPrice, 400);
  assert.equal(shortOpt.savingsAmount, 200);

  assert.equal(longOpt.validityMonths, 6);
  assert.equal(longOpt.label, '6 Months');
  assert.equal(longOpt.discountPct, 0);
  assert.equal(longOpt.payablePrice, 400);
  assert.equal(longOpt.fullPrice, 400);
  assert.equal(longOpt.savingsAmount, 0);
});

test('Book validity pricing: 3 months 40% off, 2 years full Firebase buyPrice', () => {
  const [shortOpt, longOpt] = getValidityOptions('books', 500);
  assert.equal(shortOpt.validityMonths, 3);
  assert.equal(shortOpt.label, '3 Months');
  assert.equal(shortOpt.discountPct, 40);
  assert.equal(shortOpt.payablePrice, 300);
  assert.equal(shortOpt.fullPrice, 500);
  assert.equal(shortOpt.savingsAmount, 200);

  assert.equal(longOpt.validityMonths, 24);
  assert.equal(longOpt.label, '2 Years');
  assert.equal(longOpt.discountPct, 0);
  assert.equal(longOpt.payablePrice, 500);
  assert.equal(longOpt.fullPrice, 500);
  assert.equal(longOpt.savingsAmount, 0);
});

test('Default catalog pricing uses shorter discounted tier for paid items and long tier for free items', () => {
  const paidExam = getDefaultCatalogPricing('ExamPackDocument', 249);
  assert.equal(paidExam.discountedPrice, 125);
  assert.equal(paidExam.fullPrice, 249);
  assert.equal(paidExam.discountPct, 50);
  assert.equal(paidExam.isFree, false);

  const paidBook = getDefaultCatalogPricing('books', 199);
  assert.equal(paidBook.discountedPrice, 119);
  assert.equal(paidBook.fullPrice, 199);
  assert.equal(paidBook.discountPct, 40);
  assert.equal(paidBook.isFree, false);

  const freeBook = getDefaultCatalogPricing('books', 0);
  assert.equal(freeBook.discountedPrice, 0);
  assert.equal(freeBook.discountPct, 0);
  assert.equal(freeBook.isFree, true);
  assert.equal(freeBook.defaultValidityMonths, 24);
});

test('resolveValiditySelection falls back safely on invalid or omitted months', () => {
  const examShort = resolveValiditySelection('ExamPackDocument', 300, undefined);
  assert.equal(examShort.validityMonths, 1);
  assert.equal(examShort.payablePrice, 150);

  const examLong = resolveValiditySelection('ExamPackDocument', 300, 6);
  assert.equal(examLong.validityMonths, 6);
  assert.equal(examLong.payablePrice, 300);

  const invalidForExam = resolveValiditySelection('ExamPackDocument', 300, 24);
  assert.equal(invalidForExam.validityMonths, 1);

  assert.equal(isValidValidityMonthsForCollection('ExamPackDocument', 1), true);
  assert.equal(isValidValidityMonthsForCollection('ExamPackDocument', 6), true);
  assert.equal(isValidValidityMonthsForCollection('ExamPackDocument', 3), false);
  assert.equal(isValidValidityMonthsForCollection('books', 3), true);
  assert.equal(isValidValidityMonthsForCollection('books', 24), true);
  assert.equal(isValidValidityMonthsForCollection('books', 6), false);
});

test('addCalendarMonthsUtc clamps month-end dates safely across leap and non-leap years', () => {
  const jan31NonLeap = Date.UTC(2025, 0, 31, 10, 0, 0);
  const plus1 = new Date(addCalendarMonthsUtc(jan31NonLeap, 1));
  assert.equal(plus1.toISOString(), '2025-02-28T10:00:00.000Z');

  const jan31Leap = Date.UTC(2024, 0, 31, 10, 0, 0);
  const plus1Leap = new Date(addCalendarMonthsUtc(jan31Leap, 1));
  assert.equal(plus1Leap.toISOString(), '2024-02-29T10:00:00.000Z');

  const plus24 = computePurchaseExpiryIso('2026-03-15T08:00:00.000Z', 24);
  assert.equal(plus24, '2028-03-15T08:00:00.000Z');
});

test('resolvePurchaseExpiryMeta & filterActivePurchases enforce strict expiry including legacy fallback', () => {
  const nowMs = Date.parse('2026-06-15T12:00:00.000Z');

  const activeExam = {
    collectionName: 'ExamPackDocument' as const,
    createdAtIso: '2026-06-01T12:00:00.000Z',
    validityMonths: 1,
    validityLabel: '1 Month',
    expiresAtIso: '2026-07-01T12:00:00.000Z',
  };
  const expiredExam = {
    collectionName: 'ExamPackDocument' as const,
    createdAtIso: '2026-05-01T12:00:00.000Z',
    validityMonths: 1,
    validityLabel: '1 Month',
    expiresAtIso: '2026-06-01T12:00:00.000Z',
  };
  const legacyExpiredBook = {
    collectionName: 'books' as const,
    createdAtIso: '2024-01-01T00:00:00.000Z',
  };
  const legacyActiveBook = {
    collectionName: 'books' as const,
    createdAtIso: '2025-12-01T00:00:00.000Z',
  };

  const activeMeta = resolvePurchaseExpiryMeta(activeExam, nowMs);
  assert.equal(activeMeta.isExpired, false);
  assert.equal(activeMeta.remainingDays, 16);
  assert.equal(activeMeta.isExpiringSoon, false);
  assert.match(activeMeta.chipLabel, /1 Month · 16d left · Exp 1 Jul 2026/);

  const { active, expired } = filterActivePurchases(
    [activeExam, expiredExam, legacyExpiredBook, legacyActiveBook],
    nowMs,
  );
  assert.equal(active.length, 2);
  assert.equal(expired.length, 2);
});
