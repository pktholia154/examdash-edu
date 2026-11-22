import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarkdownChapters } from './markdown-chapters';

test('splits multi-H1 books into discrete chapters with nested H2 subheadings', () => {
  const md = [
    '# Chapter 1: Number Systems',
    '',
    'Natural numbers and integers form the foundation of arithmetic.',
    '',
    '## Divisibility Rules',
    '',
    'Every even integer is divisible by 2.',
    '',
    '## Prime Factorization',
    '',
    'Every integer greater than 1 has a unique prime factorization.',
    '',
    '# Chapter 2: Linear Equations',
    '',
    'Systems of linear equations can be solved by elimination or matrices.',
    '',
    '## Gaussian Elimination',
    '',
    'Row operations preserve the solution set.',
    '',
    '# Chapter 3: Probability Theory',
    '',
    'Conditional probability measures the likelihood of an event given prior knowledge.',
  ].join('\n');

  const parsed = buildMarkdownChapters({
    rawMarkdown: md,
    bookTitle: 'Quantitative Aptitude Handbook',
  });

  assert.equal(parsed.chapters.length, 3);
  assert.equal(parsed.toc.length, 3);

  assert.equal(parsed.chapters[0].title, 'Chapter 1: Number Systems');
  assert.equal(parsed.chapters[0].subheadings.length, 2);
  assert.equal(parsed.chapters[0].subheadings[0].text, 'Divisibility Rules');
  assert.equal(parsed.chapters[0].subheadings[1].text, 'Prime Factorization');

  // Verify Chapter 1 HTML contains ONLY Chapter 1 prose and not Chapter 2/3 prose
  assert.ok(parsed.chapters[0].rawHtml.includes('Chapter 1: Number Systems'));
  assert.ok(!parsed.chapters[0].rawHtml.includes('Chapter 2: Linear Equations'));

  assert.equal(parsed.chapters[1].title, 'Chapter 2: Linear Equations');
  assert.equal(parsed.chapters[1].subheadings.length, 1);
  assert.equal(parsed.chapters[1].subheadings[0].text, 'Gaussian Elimination');
  assert.ok(parsed.chapters[1].rawHtml.includes('Gaussian Elimination'));
  assert.ok(!parsed.chapters[1].rawHtml.includes('Probability Theory'));

  assert.equal(parsed.chapters[2].title, 'Chapter 3: Probability Theory');

  // Monotonic non-overlapping block number ranges for resume-reading accuracy
  assert.ok(parsed.chapters[0].startBlockNum >= 1);
  assert.ok(parsed.chapters[1].startBlockNum > parsed.chapters[0].endBlockNum);
  assert.ok(parsed.chapters[2].startBlockNum > parsed.chapters[1].endBlockNum);
});

test('splits single-H1 book title + multi-H2 chapters cleanly without empty title stub', () => {
  const md = [
    '# Modern Indian History Masterguide',
    '',
    '## Advent of Europeans',
    '',
    'Portuguese navigators arrived at Calicut in 1498.',
    '',
    '### Trade Monopolies',
    '',
    'Maritime cartaz permits regulated Indian Ocean trade.',
    '',
    '## Eighteenth Century Polities',
    '',
    'Regional successor states emerged across Awadh, Bengal, and Hyderabad.',
  ].join('\n');

  const parsed = buildMarkdownChapters({
    rawMarkdown: md,
    bookTitle: 'Modern Indian History Masterguide',
  });

  assert.equal(parsed.chapters.length, 2);
  assert.equal(parsed.chapters[0].title, 'Advent of Europeans');
  assert.equal(parsed.chapters[0].subheadings.length, 1);
  assert.equal(parsed.chapters[0].subheadings[0].text, 'Trade Monopolies');
  assert.equal(parsed.chapters[1].title, 'Eighteenth Century Polities');
});

test('preserves single-H1 preface chapter when substantive intro paragraphs precede H2 chapters', () => {
  const md = [
    '# Organic Chemistry Companion',
    '',
    'This preface outlines how reaction mechanisms and stereochemistry are organized across this book.',
    '',
    '## Chapter 1: Structure and Bonding',
    '',
    'Hybridization explains tetrahedral, trigonal planar, and linear molecular geometries.',
    '',
    '## Chapter 2: Nucleophilic Substitution',
    '',
    'SN1 and SN2 pathways differ in carbocation intermediate formation and stereochemical inversion.',
  ].join('\n');

  const parsed = buildMarkdownChapters({
    rawMarkdown: md,
    bookTitle: 'Organic Chemistry Companion',
  });

  assert.equal(parsed.chapters.length, 3);
  assert.equal(parsed.chapters[0].title, 'Organic Chemistry Companion');
  assert.ok(parsed.chapters[0].rawHtml.includes('This preface outlines'));
  assert.equal(parsed.chapters[1].title, 'Chapter 1: Structure and Bonding');
  assert.equal(parsed.chapters[2].title, 'Chapter 2: Nucleophilic Substitution');
});

test('preserves KaTeX placeholders, GFM callouts, tables, and cross-chapter anchorIds', () => {
  const md = [
    '# Chapter 1: Electrostatics',
    '',
    'Inline Coulomb law $F = k \\frac{q_1 q_2}{r^2}$ and display Gauss law:',
    '',
    '$$\\oint \\vec{E} \\cdot d\\vec{A} = \\frac{Q_{\\text{enc}}}{\\varepsilon_0}$$',
    '',
    '> [!TIP] Dimensional Check',
    '> Always verify SI units before substituting numerical constants.',
    '',
    '# Chapter 2: Capacitance',
    '',
    '| Geometry | Formula |',
    '| --- | --- |',
    '| Parallel Plate | $C = \\varepsilon_0 A / d$ |',
    '',
    '### Dielectric Slab Insertion',
    '',
    'Capacitance increases by factor $\\kappa$.',
  ].join('\n');

  const parsed = buildMarkdownChapters({
    rawMarkdown: md,
    katexRender: (tex, displayMode) =>
      displayMode ? `<span class="katex-display">${tex}</span>` : `<span class="katex">${tex}</span>`,
  });

  assert.equal(parsed.hasMath, true);
  assert.equal(parsed.chapters.length, 2);
  assert.ok(Object.keys(parsed.mathMap).length >= 3);

  assert.ok(parsed.chapters[0].rawHtml.includes('data-katex-id="math_'));
  assert.ok(parsed.chapters[0].rawHtml.includes('ed-md-callout-tip'));
  assert.ok(parsed.chapters[0].rawHtml.includes('Dimensional Check'));

  assert.ok(parsed.chapters[1].rawHtml.includes('class="md-scroll-x"'));
  assert.ok(parsed.chapters[1].anchorIds.includes('dielectric-slab-insertion'));
});
