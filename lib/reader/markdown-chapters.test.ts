import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarkdownChapters } from './markdown-chapters';

test('splits multi-H1 books into discrete chapters and includes ONLY H1 headings in TOC (ignores H2-H6)', () => {
  const md = [
    '# Chapter 1: Number Systems',
    '',
    'Natural numbers and integers form the foundation of arithmetic.',
    '',
    '## Divisibility Rules',
    '',
    'Every even integer is divisible by 2.',
    '',
    '### Small Primes',
    '',
    '2, 3, 5, 7 are the first four primes.',
    '',
    '#### Proof Sketch',
    '',
    'By contradiction using fundamental theorem of arithmetic.',
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
  assert.deepEqual(
    parsed.toc.map((t) => ({ text: t.text, level: t.level, subCount: t.subheadings.length })),
    [
      { text: 'Chapter 1: Number Systems', level: 1, subCount: 0 },
      { text: 'Chapter 2: Linear Equations', level: 1, subCount: 0 },
      { text: 'Chapter 3: Probability Theory', level: 1, subCount: 0 },
    ]
  );

  // Lower headings are still rendered inside chapter HTML and anchored, but never added to TOC/subheadings
  assert.equal(parsed.chapters[0].subheadings.length, 0);
  assert.ok(parsed.chapters[0].rawHtml.includes('Divisibility Rules'));
  assert.ok(parsed.chapters[0].rawHtml.includes('Small Primes'));
  assert.ok(!parsed.chapters[0].rawHtml.includes('Chapter 2: Linear Equations'));
  assert.ok(parsed.chapters[0].anchorIds.includes('divisibility-rules'));

  assert.equal(parsed.chapters[1].title, 'Chapter 2: Linear Equations');
  assert.equal(parsed.chapters[1].subheadings.length, 0);
  assert.ok(parsed.chapters[1].rawHtml.includes('Gaussian Elimination'));
  assert.ok(!parsed.chapters[1].rawHtml.includes('Probability Theory'));

  assert.equal(parsed.chapters[2].title, 'Chapter 3: Probability Theory');

  // Monotonic non-overlapping block number ranges for resume-reading accuracy
  assert.ok(parsed.chapters[0].startBlockNum >= 1);
  assert.ok(parsed.chapters[1].startBlockNum > parsed.chapters[0].endBlockNum);
  assert.ok(parsed.chapters[2].startBlockNum > parsed.chapters[1].endBlockNum);
});

test('single-H1 sample with multiple H2/H3 headings fetches ONLY the H1 heading in TOC', () => {
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

  assert.equal(parsed.chapters.length, 1);
  assert.equal(parsed.toc.length, 1);
  assert.equal(parsed.toc[0].text, 'Modern Indian History Masterguide');
  assert.equal(parsed.toc[0].level, 1);
  assert.equal(parsed.toc[0].subheadings.length, 0);
  assert.ok(parsed.chapters[0].rawHtml.includes('Advent of Europeans'));
  assert.ok(parsed.chapters[0].rawHtml.includes('Eighteenth Century Polities'));
});

test('documents with only lower headings (H2/H3/H4) render prose cleanly with an empty TOC', () => {
  const md = [
    '## Section One: Kinematics',
    '',
    'Motion in one dimension is governed by constant acceleration equations.',
    '',
    '### Instantaneous Velocity',
    '',
    'Velocity is the time derivative of displacement.',
    '',
    '## Section Two: Dynamics',
    '',
    'Force equals mass times acceleration.',
  ].join('\n');

  const parsed = buildMarkdownChapters({
    rawMarkdown: md,
    bookTitle: 'Physics Notes',
  });

  assert.equal(parsed.chapters.length, 1);
  assert.equal(parsed.chapters[0].hasH1Heading, false);
  assert.equal(parsed.toc.length, 0);
  assert.ok(parsed.chapters[0].rawHtml.includes('Section One: Kinematics'));
  assert.ok(parsed.chapters[0].rawHtml.includes('Section Two: Dynamics'));
});

test('keeps preamble text with Chapter 1 and ignores H1 syntax inside code fences or blockquotes', () => {
  const md = [
    'Preface note before the first chapter.',
    '',
    '# **Chapter 1**: Foundations',
    '',
    '> # Quoted heading is not a top-level H1',
    '',
    '```bash',
    '# Shell comment is not a heading',
    'echo "hello"',
    '```',
    '',
    '## Lower Heading Ignored',
    '',
    '# Chapter 2: Practice',
    '',
    'Second chapter prose.',
  ].join('\n');

  const parsed = buildMarkdownChapters({
    rawMarkdown: md,
    bookTitle: 'Study Guide',
  });

  assert.equal(parsed.chapters.length, 2);
  assert.equal(parsed.toc.length, 2);
  assert.deepEqual(
    parsed.toc.map((t) => t.text),
    ['Chapter 1: Foundations', 'Chapter 2: Practice']
  );
  assert.ok(parsed.chapters[0].rawHtml.includes('Preface note before the first chapter.'));
  assert.ok(parsed.chapters[1].rawHtml.includes('Second chapter prose.'));
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
  assert.equal(parsed.toc.length, 2);
  assert.ok(Object.keys(parsed.mathMap).length >= 3);

  assert.ok(parsed.chapters[0].rawHtml.includes('data-katex-id="math_'));
  assert.ok(parsed.chapters[0].rawHtml.includes('ed-md-callout-tip'));
  assert.ok(parsed.chapters[0].rawHtml.includes('Dimensional Check'));

  assert.ok(parsed.chapters[1].rawHtml.includes('class="md-scroll-x"'));
  assert.ok(parsed.chapters[1].anchorIds.includes('dielectric-slab-insertion'));
  assert.equal(parsed.toc[1].subheadings.length, 0);
});
