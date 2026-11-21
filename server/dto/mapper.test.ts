import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDocumentLive,
  mapBookToPublicDTO,
  mapExamToPublicDTO,
} from './mapper';

test('mapBookToPublicDTO strips fullPdfStoragePath and fullMarkdownStoragePath and falls back to createdAt', () => {
  const rawBook = {
    id: 'B1',
    isPublished: true,
    isDeleted: false,
    createdAt: { seconds: 1700000000, nanoseconds: 0 },
    title: 'Indian History MCQs',
    urlSlug: 'indian-history-mcqs-b1',
    seoDescription: 'SEO summary',
    fullDescription: 'Detailed syllabus notes',
    type: 'Question Bank',
    language: 'English',
    publisher: 'ExamDash Press',
    authorName: 'Dr. R. Sharma',
    tags: ['History', 'UPSC'],
    currency: 'inr',
    listPrice: 120,
    buyPrice: 100,
    samplePdfUrl: 'https://example.com/sample.pdf',
    sampleMarkdownUrl: 'https://example.com/sample.md',
    fullPdfStoragePath: 'private/books/B1_full.pdf',
    fullMarkdownStoragePath: 'private/books/B1_full.md',
  };

  const dto = mapBookToPublicDTO('B1', rawBook);
  const serialized = JSON.stringify(dto);

  assert.equal(dto.currency, 'INR');
  assert.equal(dto.hasFullPdf, true);
  assert.equal(dto.hasFullMarkdown, true);
  assert.equal(dto.publishAtIso, dto.createdAtIso);
  assert.equal(serialized.includes('fullPdfStoragePath'), false);
  assert.equal(serialized.includes('private/books/B1_full.pdf'), false);
  assert.equal(serialized.includes('fullMarkdownStoragePath'), false);
});

test('mapExamToPublicDTO strips fullJsonStoragePath and normalizes MocktestTitles', () => {
  const rawExam = {
    id: 'E1',
    isPublished: true,
    isDeleted: false,
    publishAt: { toMillis: () => 1700000000000 },
    title: 'Online Exam IBPS',
    urlSlug: 'online-exam-ibps-e1',
    type: 'TEST_SERIES',
    language: 'English',
    currency: 'INR',
    listPrice: 300,
    buyPrice: 200,
    totalMocktest: 2,
    MocktestTitles: [
      { id: 'set_1', title: 'Mock Set 01', duration: 60, totalQuestions: 12, totalMarks: 12 },
    ],
    sampleJsonStoragePath: 'public/exam_samples/E1_sample.json',
    fullJsonStoragePath: 'private/exams/E1_full.json',
  };

  const dto = mapExamToPublicDTO('E1', rawExam);
  const serialized = JSON.stringify(dto);

  assert.equal(dto.hasFullJson, true);
  assert.equal(dto.totalMocktest, 2);
  assert.equal(dto.MocktestTitles.length, 1);
  assert.equal(serialized.includes('fullJsonStoragePath'), false);
  assert.equal(serialized.includes('private/exams/E1_full.json'), false);
});

test('isDocumentLive enforces isPublished, !isDeleted, and publishAt <= now', () => {
  const now = 1800000000000;
  assert.equal(
    isDocumentLive({ isPublished: true, isDeleted: false, publishAt: { toMillis: () => now - 1000 } }, now),
    true
  );
  assert.equal(
    isDocumentLive({ isPublished: false, isDeleted: false, publishAt: { toMillis: () => now - 1000 } }, now),
    false
  );
  assert.equal(
    isDocumentLive({ isPublished: true, isDeleted: true, publishAt: { toMillis: () => now - 1000 } }, now),
    false
  );
  assert.equal(
    isDocumentLive({ isPublished: true, isDeleted: false, publishAt: { toMillis: () => now + 60000 } }, now),
    false
  );
});

test('mapBookToPublicDTO strips misleading Free from title/tags and normalizes description when buyPrice > 0', () => {
  const paidBookWithFreeClaim = mapBookToPublicDTO('B2', {
    id: 'B2',
    isPublished: true,
    isDeleted: false,
    title: 'IBPS PO Prelims Guide (Free) - Free Edition',
    urlSlug: 'ibps-po-prelims-b2',
    seoDescription: 'Download for free PDF question bank.',
    tags: ['IBPS', 'Free', 'Free PDF', 'Error-Free', 'Banking'],
    buyPrice: 149,
    listPrice: 249,
    samplePdfUrl: 'https://example.com/sample.pdf',
  });

  assert.equal(/\bfree\b/i.test(paidBookWithFreeClaim.title), false);
  assert.deepEqual(paidBookWithFreeClaim.tags, ['IBPS', 'Error-Free', 'Banking']);
  assert.match(paidBookWithFreeClaim.seoDescription, /Includes Free Sample/i);

  const paidWithParenthetical = mapBookToPublicDTO('B1', {
    id: 'B1',
    isPublished: true,
    isDeleted: false,
    title: 'Indian History MCQs (Free Sample Book)',
    urlSlug: 'indian-history-mcqs-b1',
    fullDescription: '# Indian History MCQs (Free Sample Book): Question Bank\n\nBody text.',
    buyPrice: 100,
    listPrice: 120,
    samplePdfUrl: 'https://example.com/sample.pdf',
  });
  assert.equal(paidWithParenthetical.title, 'Indian History MCQs');
  assert.equal(paidWithParenthetical.fullDescription.includes('(Free Sample Book)'), false);

  const genuinelyFreeBook = mapBookToPublicDTO('B3', {
    id: 'B3',
    isPublished: true,
    isDeleted: false,
    title: 'Free NCERT Polity Digest',
    urlSlug: 'free-ncert-polity-b3',
    seoDescription: '100% Free digital study digest.',
    tags: ['Free', 'NCERT'],
    buyPrice: 0,
    listPrice: 0,
  });

  assert.equal(genuinelyFreeBook.title, 'Free NCERT Polity Digest');
  assert.deepEqual(genuinelyFreeBook.tags, ['Free', 'NCERT']);
});

