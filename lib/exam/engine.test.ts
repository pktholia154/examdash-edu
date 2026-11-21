import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFullExamAnalytics,
  computeRemainingMs,
  derivePaletteStatus,
  evaluateFullExam,
  evaluateQuestion,
  formatCountdownClock,
  isQuestionAttempted,
  isQuestionLockedBySectionCap,
} from './grading';
import { validateExamPack } from './validator';
import { BENCHMARK_SET_1, buildFallbackExamSetsForPack } from './benchmark-packs';
import type { ExamSection, ExamSet } from './types';

test('NAT, MCQ, and JEE Advanced MSQ grading with negative & partial marks', () => {
  const natQ = BENCHMARK_SET_1.sections[0].questions[0];
  assert.deepEqual(evaluateQuestion(natQ, '129.9'), {
    status: 'CORRECT',
    marksAwarded: 3,
  });
  assert.deepEqual(evaluateQuestion(natQ, '129.9000001'), {
    status: 'CORRECT',
    marksAwarded: 3,
  });
  assert.deepEqual(evaluateQuestion(natQ, '-'), {
    status: 'UNATTEMPTED',
    marksAwarded: 0,
  });
  assert.deepEqual(evaluateQuestion(natQ, '120'), {
    status: 'WRONG',
    marksAwarded: 0,
  });

  const gateMcq = BENCHMARK_SET_1.sections[0].questions[2];
  assert.deepEqual(evaluateQuestion(gateMcq, 'A'), {
    status: 'CORRECT',
    marksAwarded: 2,
  });
  const wrongGate = evaluateQuestion(gateMcq, 'B');
  assert.equal(wrongGate.status, 'WRONG');
  assert.ok(Math.abs(wrongGate.marksAwarded - -0.666667) < 1e-5);

  const jeeMsq = BENCHMARK_SET_1.sections[0].questions[3];
  // Exact match ['A', 'C'] => +4
  assert.deepEqual(evaluateQuestion(jeeMsq, ['A', 'C']), {
    status: 'CORRECT',
    marksAwarded: 4,
  });
  // Subset ['A'] with no wrong option => PARTIAL +1
  assert.deepEqual(evaluateQuestion(jeeMsq, ['A']), {
    status: 'PARTIAL',
    marksAwarded: 1,
  });
  // Any wrong option ['A', 'B'] => WRONG -2
  assert.deepEqual(evaluateQuestion(jeeMsq, ['A', 'B']), {
    status: 'WRONG',
    marksAwarded: -2,
  });
});

test('Indian CBT 5-state question palette derivation matches TCS iON rules', () => {
  const mcq = { type: 'MCQ' };
  assert.equal(
    derivePaletteStatus({
      question: mcq,
      rawAnswer: null,
      isVisited: false,
      isMarkedForReview: false,
    }),
    'NOT_VISITED'
  );
  assert.equal(
    derivePaletteStatus({
      question: mcq,
      rawAnswer: null,
      isVisited: true,
      isMarkedForReview: false,
    }),
    'NOT_ANSWERED'
  );
  assert.equal(
    derivePaletteStatus({
      question: mcq,
      rawAnswer: 'C',
      isVisited: true,
      isMarkedForReview: false,
    }),
    'ANSWERED'
  );
  assert.equal(
    derivePaletteStatus({
      question: mcq,
      rawAnswer: null,
      isVisited: true,
      isMarkedForReview: true,
    }),
    'MARKED_FOR_REVIEW'
  );
  assert.equal(
    derivePaletteStatus({
      question: mcq,
      rawAnswer: 'C',
      isVisited: true,
      isMarkedForReview: true,
    }),
    'ANSWERED_AND_MARKED'
  );
});

test('Section maxAttempts cap locks extra questions and ignores excess in evaluateFullExam', () => {
  const cappedSection: ExamSection = {
    id: 'sec_cap',
    title: 'Part B (Attempt any 2)',
    duration: 15,
    totalQuestions: 3,
    maxAttempts: 2,
    contexts: [],
    questions: [
      {
        id: 'q1',
        contextIds: [],
        type: 'MCQ',
        marks: { correct: 4, wrong: -1, partial: 0 },
        prompt: 'Q1',
        visuals: [],
        options: [{ id: 'A', text: 'A', visuals: [] }],
        answer: 'A',
        explanation: '',
        explanationVisuals: [],
      },
      {
        id: 'q2',
        contextIds: [],
        type: 'MCQ',
        marks: { correct: 4, wrong: -1, partial: 0 },
        prompt: 'Q2',
        visuals: [],
        options: [{ id: 'A', text: 'A', visuals: [] }],
        answer: 'A',
        explanation: '',
        explanationVisuals: [],
      },
      {
        id: 'q3',
        contextIds: [],
        type: 'MCQ',
        marks: { correct: 4, wrong: -1, partial: 0 },
        prompt: 'Q3',
        visuals: [],
        options: [{ id: 'A', text: 'A', visuals: [] }],
        answer: 'A',
        explanation: '',
        explanationVisuals: [],
      },
    ],
  };

  const responses = { q1: 'A', q2: 'A' };
  assert.equal(
    isQuestionLockedBySectionCap(cappedSection, 'q3', responses),
    true
  );
  assert.equal(
    isQuestionLockedBySectionCap(cappedSection, 'q1', responses),
    false
  );

  const exam: ExamSet = {
    id: 'cap_exam',
    title: 'Cap Test',
    duration: 15,
    totalQuestions: 3,
    totalMarks: 8,
    sectionalTiming: false,
    calculator: 'none',
    sections: [cappedSection],
  };

  const evalRes = evaluateFullExam(exam, { q1: 'A', q2: 'A', q3: 'A' });
  assert.equal(evalRes.totalScore, 8);
  assert.equal(evalRes.maxScore, 8);
  assert.equal(evalRes.questionResults.q3.ignoredByCap, true);
  assert.equal(isQuestionAttempted({ type: 'NAT' }, '-.'), false);
});

test('Post-exam analytics computes accuracy, negative marks lost, and dwell time', () => {
  const analytics = computeFullExamAnalytics({
    exam: BENCHMARK_SET_1,
    responses: {
      sec_1_q_1: '129.9', // +3
      sec_1_q_2: 'A', // -0.5 wrong
      sec_1_q_4: ['A'], // +1 partial
    },
    telemetry: {
      sec_1_q_1: { timeSpentMs: 45_000, visits: 2 },
      sec_1_q_2: { timeSpentMs: 30_000, visits: 1 },
      sec_1_q_4: { timeSpentMs: 15_000, visits: 1 },
    },
    markedForReview: { sec_1_q_2: true },
  });

  assert.equal(analytics.evaluation.totalScore, 3.5);
  assert.equal(analytics.positiveMarksEarned, 4);
  assert.equal(analytics.negativeMarksLost, 0.5);
  assert.equal(analytics.totalAttempted, 3);
  assert.equal(analytics.totalCorrect, 1);
  assert.equal(analytics.totalPartial, 1);
  assert.equal(analytics.totalWrong, 1);
  assert.equal(analytics.totalTimeSpentMs, 90_000);
  assert.equal(analytics.avgTimePerAttemptedMs, 30_000);
  assert.equal(formatCountdownClock(computeRemainingMs(125_000, 5_000)), '02:00');
});

test('validateExamPack enforces Pillar 1 <-> Pillar 2 Zero-Drift invariants', () => {
  const validRes = validateExamPack([BENCHMARK_SET_1]);
  assert.equal(validRes.valid, true, validRes.errors.join('; '));
  assert.equal(validRes.derivedMetadata.totalMocktest, 1);
  assert.equal(validRes.derivedMetadata.MocktestTitles[0].totalMarks, 13);

  const generatedSets = buildFallbackExamSetsForPack(
    [
      {
        id: 'exam_set_1',
        title: 'Set 1',
        duration: 60,
        totalQuestions: 6,
        totalMarks: 13,
      },
      {
        id: 'exam_set_2',
        title: 'Set 2',
        duration: 60,
        totalQuestions: 6,
        totalMarks: 13,
      },
    ],
    'full'
  );
  const fullValidation = validateExamPack(generatedSets);
  assert.equal(fullValidation.valid, true, fullValidation.errors.join('; '));
  assert.equal(fullValidation.derivedMetadata.totalMocktest, 2);

  // Detect invalid visual placeholder & totalMarks mismatch
  const broken: ExamSet = {
    ...BENCHMARK_SET_1,
    totalMarks: 999,
    sections: [
      {
        ...BENCHMARK_SET_1.sections[0],
        questions: [
          {
            ...BENCHMARK_SET_1.sections[0].questions[0],
            prompt: 'Broken ref {{missing_visual}}',
          },
          ...BENCHMARK_SET_1.sections[0].questions.slice(1),
        ],
      },
      BENCHMARK_SET_1.sections[1],
    ],
  };
  const brokenRes = validateExamPack([broken]);
  assert.equal(brokenRes.valid, false);
  assert.ok(brokenRes.errors.some((e) => e.includes('missing_visual')));
  assert.ok(brokenRes.errors.some((e) => e.includes('exam.totalMarks')));
});
