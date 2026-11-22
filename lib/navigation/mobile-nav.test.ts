import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMobileTabState,
  shouldShowMobileBottomNav,
} from './mobile-nav';

test('shouldShowMobileBottomNav enables bottom bar on all major pages and product details', () => {
  assert.equal(shouldShowMobileBottomNav('/'), true);
  assert.equal(shouldShowMobileBottomNav('/books'), true);
  assert.equal(shouldShowMobileBottomNav('/books/indian-geography-mcqs'), true);
  assert.equal(shouldShowMobileBottomNav('/exams'), true);
  assert.equal(shouldShowMobileBottomNav('/exams/ibps-clerk-prelims'), true);
  assert.equal(shouldShowMobileBottomNav('/purchased'), true);
  assert.equal(shouldShowMobileBottomNav('/profile'), true);
  assert.equal(shouldShowMobileBottomNav('/search'), true);
  assert.equal(shouldShowMobileBottomNav('/contact-us'), true);
  assert.equal(shouldShowMobileBottomNav('/privacy-policy'), true);
});

test('shouldShowMobileBottomNav suppresses bottom bar only on immersive reader and CBT attempt routes', () => {
  assert.equal(shouldShowMobileBottomNav('/read/indian-geography-mcqs'), false);
  assert.equal(shouldShowMobileBottomNav('/attempt/ibps-clerk-prelims'), false);
  assert.equal(
    shouldShowMobileBottomNav('/attempt/ibps-clerk-prelims/set_1'),
    false
  );
});

test('resolveMobileTabState highlights parent catalog tab on product detail routes', () => {
  const booksOnBookDetail = resolveMobileTabState(
    '/books/indian-history-mcqs',
    '/books'
  );
  assert.equal(booksOnBookDetail.isExactPage, false);
  assert.equal(booksOnBookDetail.isActiveSection, true);

  const examsOnExamDetail = resolveMobileTabState(
    '/exams/ssc-cgl-tier-1',
    '/exams'
  );
  assert.equal(examsOnExamDetail.isExactPage, false);
  assert.equal(examsOnExamDetail.isActiveSection, true);

  const homeOnDetail = resolveMobileTabState(
    '/books/indian-history-mcqs',
    '/'
  );
  assert.equal(homeOnDetail.isExactPage, false);
  assert.equal(homeOnDetail.isActiveSection, false);

  const homeOnRoot = resolveMobileTabState('/', '/');
  assert.equal(homeOnRoot.isExactPage, true);
  assert.equal(homeOnRoot.isActiveSection, true);
});
