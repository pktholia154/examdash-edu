import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTimestampMs,
  isDocumentLive,
  mapBookToPublicDTO,
  mapCategoryToChipDTO,
  mapCategoryToPublicDTO,
  mapExamToPublicDTO,
  normalizeBookChapters,
  normalizeImageUrl,
  parseImageMeta,
  safeTimestampToIso,
} from './mapper';
import {
  normalizeSafeCatalogSlug,
  validateCmsBookIngestion,
  validateCmsExamPackIngestion,
} from '../../lib/validation/cms-ingestion';

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

test('mapBookToPublicDTO parses imageUrl/bookCover, imageMeta key:value arrays, and bookChapters', () => {
  const coverUrl =
    'https://firebasestorage.googleapis.com/v0/b/examdash-ed.firebasestorage.app/o/public%2Fcovers%2FB3_cover.png?alt=media&token=abc';

  const dto = mapBookToPublicDTO('B3', {
    id: 'B3',
    isPublished: true,
    isDeleted: false,
    title: 'Indian Geography Book Question Bank',
    urlSlug: 'indian-geography-book-question-bank-b3',
    bookCover: coverUrl,
    imageMeta: [
      'alt: Indian Geography Book Question Bank Cover',
      'slug: indian-geography-book-cover',
      'title: Indian Geography Book Question Bank | Mocktime',
      'caption: Book cover of Indian Geography Book Question Bank.',
      'description: Get indian geography book, download pdf',
      'filename: indian-geography-book-cover.png',
      'keywords: Indian Geography, Question Bank, book cover',
    ],
    bookChapters: [
      'Chapter 1: Prehistoric India and the Stone Age',
      '  Chapter 2: Indus Valley Civilization  ',
      '',
    ],
    buyPrice: 99,
    listPrice: 199,
  });

  assert.equal(dto.imageUrl, coverUrl);
  assert.deepEqual(dto.imageMeta, {
    alt: 'Indian Geography Book Question Bank Cover',
    slug: 'indian-geography-book-cover',
    title: 'Indian Geography Book Question Bank | Mocktime',
    caption: 'Book cover of Indian Geography Book Question Bank.',
    description: 'Get indian geography book, download pdf',
    filename: 'indian-geography-book-cover.png',
    keywords: 'Indian Geography, Question Bank, book cover',
  });
  assert.deepEqual(dto.bookChapters, [
    'Chapter 1: Prehistoric India and the Stone Age',
    'Chapter 2: Indus Valley Civilization',
  ]);

  // imageUrl takes precedence over bookCover
  assert.equal(
    normalizeImageUrl('https://example.com/primary.png', coverUrl),
    'https://example.com/primary.png'
  );
  // Plain object map imageMeta is also supported
  assert.deepEqual(
    parseImageMeta({
      alt: 'Cover Alt',
      keywords: ['Geography', 'MCQs'],
    }),
    { alt: 'Cover Alt', keywords: 'Geography, MCQs' }
  );
  // Rejects unsafe URL schemes
  assert.equal(normalizeImageUrl('javascript:alert(1)'), '');
  assert.deepEqual(normalizeBookChapters(null), []);
});

test('mapBookToPublicDTO maps optional positive soldCount and isBestseller without fabricating defaults', () => {
  const plainBook = mapBookToPublicDTO('B10', {
    id: 'B10',
    isPublished: true,
    title: 'Plain Book',
    urlSlug: 'plain-book-b10',
    buyPrice: 99,
    listPrice: 199,
  });
  assert.equal(plainBook.soldCount, undefined);
  assert.equal(plainBook.isBestseller, undefined);

  const bestsellerBook = mapBookToPublicDTO('B11', {
    id: 'B11',
    isPublished: true,
    title: 'Top Book',
    urlSlug: 'top-book-b11',
    buyPrice: 89,
    listPrice: 200,
    soldCount: 42,
    isBestseller: true,
  });
  assert.equal(bestsellerBook.soldCount, 42);
  assert.equal(bestsellerBook.isBestseller, true);
});

test('crash-proof mapper handles out-of-range microsecond/nanosecond timestamps, epoch seconds, and malformed fields without throwing', () => {
  // 10-digit Unix seconds auto-normalized to milliseconds
  assert.equal(extractTimestampMs(1704067200), 1704067200000);
  // Nanosecond timestamp (1.7e18) safely scaled down instead of throwing RangeError
  const nanoMs = extractTimestampMs('1704067200000000000');
  assert.equal(nanoMs, 1704067200000);
  // Extreme out-of-bounds value never throws RangeError in safeTimestampToIso
  assert.doesNotThrow(() => safeTimestampToIso(9e25));

  const malformedBook = mapBookToPublicDTO(
    'B_CORRUPT',
    {
      createdAt: { seconds: 9e20 },
      updatedAt: 'not-a-valid-date',
      currency: 'INVALID_CURRENCY',
      buyPrice: 'NaN',
      listPrice: -50,
    } as Record<string, unknown>
  );
  assert.equal(malformedBook.currency, 'INR');
  assert.equal(malformedBook.buyPrice, 0);
  assert.equal(malformedBook.listPrice, 0);
  assert.ok(malformedBook.publishAtIso.endsWith('Z'));
});

test('Zod CMS ingestion validators enforce canonical slugs, non-negative prices, safe URLs, and GSC paid-title hygiene', () => {
  assert.equal(normalizeSafeCatalogSlug('UPSC History & Polity!! ', 'B1'), 'upsc-history-polity');

  const validBook = validateCmsBookIngestion({
    id: 'B500',
    title: 'UPSC Polity Masterclass (Free Sample Book)',
    urlSlug: 'upsc-polity-masterclass-500',
    seoDescription: '100% free download UPSC Polity notes.',
    buyPrice: '199',
    listPrice: 99,
    currency: 'inr',
    tags: ['UPSC', 'Free PDF', 'Polity'],
    samplePdfUrl: 'https://exam-dash.com/samples/polity.pdf',
    bookChapters: [{ title: 'Chapter 1: Constitutional Framework' }],
  });
  assert.equal(validBook.ok, true);
  if (validBook.ok) {
    assert.equal(validBook.data.title, 'UPSC Polity Masterclass');
    assert.equal(validBook.data.listPrice, 199);
    assert.equal(validBook.data.currency, 'INR');
    assert.deepEqual(validBook.data.tags, ['UPSC', 'Polity']);
    assert.match(validBook.data.seoDescription, /Includes Free Sample/i);
    assert.deepEqual(validBook.data.bookChapters, [
      'Chapter 1: Constitutional Framework',
    ]);
  }

  const invalidSlugBook = validateCmsBookIngestion({
    id: 'B501',
    title: 'Bad Slug Book',
    urlSlug: 'Bad Uppercase Slug!',
    buyPrice: 99,
    samplePdfUrl: 'javascript:alert(1)',
  });
  assert.equal(invalidSlugBook.ok, false);

  const validExam = validateCmsExamPackIngestion({
    id: 'E500',
    title: 'GATE CS Full Mock Series',
    urlSlug: 'gate-cs-full-mock-500',
    buyPrice: 299,
    MocktestTitles: [
      { id: 'm1', title: 'Mock 1', duration: '180', totalQuestions: 65, totalMarks: 100 },
    ],
  });
  assert.equal(validExam.ok, true);
  if (validExam.ok) {
    assert.equal(validExam.data.totalMocktest, 1);
    assert.equal(validExam.data.MocktestTitles[0].duration, 180);
  }
});

test('mapCategoryToChipDTO omits fullDescription while mapCategoryToPublicDTO and mapBookToPublicDTO normalize category slugs', () => {
  const rawCategory = {
    id: 'CUET PG',
    slug: 'cuet-pg',
    title: 'CUET PG',
    isDeleted: false,
    metaDescription: 'CUET PG exam books and practice tests.',
    fullDescription: '# CUET PG Preparation Guide\n\nDetailed syllabus and strategy.',
    createdAt: { seconds: 1732000000, nanoseconds: 0 },
    updatedAt: { seconds: 1732500000, nanoseconds: 0 },
  };

  const chip = mapCategoryToChipDTO('CUET PG', rawCategory, 2);
  assert.equal(chip.id, 'CUET PG');
  assert.equal(chip.slug, 'cuet-pg');
  assert.equal(chip.title, 'CUET PG');
  assert.equal(chip.liveBookCount, 2);
  assert.equal('fullDescription' in chip, false);

  const fullCat = mapCategoryToPublicDTO('CUET PG', rawCategory, 2);
  assert.equal(
    fullCat.fullDescription,
    '# CUET PG Preparation Guide\n\nDetailed syllabus and strategy.'
  );

  const categorizedBook = mapBookToPublicDTO('B_CUET_1', {
    id: 'B_CUET_1',
    isPublished: true,
    isDeleted: false,
    title: 'CUET PG Sanskrit Practice Book',
    urlSlug: 'cuet-pg-sanskrit-practice-book',
    category: 'CUET PG',
    buyPrice: 200,
    listPrice: 240,
  });
  assert.equal(categorizedBook.category, 'CUET PG');
  assert.equal(categorizedBook.categorySlug, 'cuet-pg');

  const lawBook = mapBookToPublicDTO('B_LAW_1', {
    id: 'B_LAW_1',
    isPublished: true,
    isDeleted: false,
    title: 'CLAT & Judicial Services Digest',
    urlSlug: 'clat-judicial-services-digest',
    category: 'Law & Judiciary',
    buyPrice: 150,
    listPrice: 200,
  });
  assert.equal(lawBook.categorySlug, 'law-and-judiciary');

  const tetBook = mapBookToPublicDTO('B_TET_1', {
    id: 'B_TET_1',
    isPublished: true,
    isDeleted: false,
    title: 'CTET Paper 1 Solved Papers',
    urlSlug: 'ctet-paper-1-solved-papers',
    category: 'TET & CTET',
    buyPrice: 120,
    listPrice: 160,
  });
  assert.equal(tetBook.categorySlug, 'tet-and-ctet');
});




