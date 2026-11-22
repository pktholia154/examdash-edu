import type {
  AttemptPerformanceInsights,
  CbtPaletteStatus,
  ExamEvaluationResult,
  ExamQuestion,
  ExamSection,
  ExamSet,
  FullExamAnalytics,
  HistoricalExamAttemptRecord,
  PersistedExamSession,
  QuestionAnalyticsItem,
  QuestionAttemptSnapshotItem,
  QuestionEvaluation,
  QuestionTelemetry,
  SectionAnalyticsItem,
} from './types';

// ============================================================================
// 1. DETERMINISTIC ATTEMPT & CAP CHECKS
// ============================================================================

export function isQuestionAttempted(
  question: { type: string },
  rawAnswer: unknown
): boolean {
  if (rawAnswer === null || rawAnswer === undefined) return false;
  if (question.type === 'MSQ') {
    return (
      Array.isArray(rawAnswer) &&
      rawAnswer.some((v) => String(v).trim() !== '')
    );
  }
  const str = String(rawAnswer).trim();
  if (
    str === '' ||
    (question.type === 'NAT' && (str === '-' || str === '.' || str === '-.'))
  ) {
    return false;
  }
  return question.type === 'NAT' ? Number.isFinite(Number(str)) : true;
}

export function hasActiveSlot(
  question: { type: string },
  rawAnswer: unknown
): boolean {
  if (isQuestionAttempted(question, rawAnswer)) return true;
  if (
    question.type === 'NAT' &&
    rawAnswer !== null &&
    rawAnswer !== undefined
  ) {
    return String(rawAnswer).trim() !== '';
  }
  return false;
}

export function isQuestionLockedBySectionCap(
  section: Pick<ExamSection, 'maxAttempts' | 'questions'>,
  questionId: string,
  sectionResponses: Record<string, unknown>
): boolean {
  const cap = section.maxAttempts ? Number(section.maxAttempts) : null;
  if (!cap) return false;
  let activeCount = 0;
  let currentHasSlot = false;
  for (const q of section.questions || []) {
    const active = hasActiveSlot(q, sectionResponses[q.id]);
    if (active) activeCount++;
    if (q.id === questionId && active) currentHasSlot = true;
  }
  return activeCount >= cap && !currentHasSlot;
}

// ============================================================================
// 2. INDIAN CBT 5-STATE QUESTION PALETTE DERIVATION (TCS iON STANDARD)
// ============================================================================

export function derivePaletteStatus(params: {
  question: { type: string };
  rawAnswer: unknown;
  isVisited: boolean;
  isMarkedForReview: boolean;
}): CbtPaletteStatus {
  const attempted = isQuestionAttempted(params.question, params.rawAnswer);
  if (attempted && params.isMarkedForReview) {
    return 'ANSWERED_AND_MARKED';
  }
  if (attempted) {
    return 'ANSWERED';
  }
  if (params.isMarkedForReview) {
    return 'MARKED_FOR_REVIEW';
  }
  if (params.isVisited) {
    return 'NOT_ANSWERED';
  }
  return 'NOT_VISITED';
}

export function countSectionPaletteStates(
  section: ExamSection,
  responses: Record<string, unknown>,
  visitedQuestions: Record<string, boolean>,
  markedForReview: Record<string, boolean>
): Record<CbtPaletteStatus, number> {
  const counts: Record<CbtPaletteStatus, number> = {
    NOT_VISITED: 0,
    NOT_ANSWERED: 0,
    ANSWERED: 0,
    MARKED_FOR_REVIEW: 0,
    ANSWERED_AND_MARKED: 0,
  };

  for (const q of section.questions || []) {
    const st = derivePaletteStatus({
      question: q,
      rawAnswer: responses[q.id],
      isVisited: Boolean(visitedQuestions[q.id]),
      isMarkedForReview: Boolean(markedForReview[q.id]),
    });
    counts[st]++;
  }
  return counts;
}

// ============================================================================
// 3. EXACT GRADING ENGINE (MCQ, NAT Tolerance, JEE Advanced MSQ Partial + Cap)
// ============================================================================

export function evaluateQuestion(
  question: Pick<ExamQuestion, 'type' | 'marks' | 'answer'>,
  userAnswer: unknown
): QuestionEvaluation {
  const { type, marks, answer } = question;
  const correctMarks = Number(marks?.correct ?? 1);
  const wrongPenalty = -Math.abs(Number(marks?.wrong ?? 0));

  if (!isQuestionAttempted(question, userAnswer)) {
    return { status: 'UNATTEMPTED', marksAwarded: 0 };
  }

  if (type === 'MCQ') {
    const isCorrect = String(userAnswer).trim() === String(answer).trim();
    return {
      status: isCorrect ? 'CORRECT' : 'WRONG',
      marksAwarded: Number((isCorrect ? correctMarks : wrongPenalty).toFixed(6)),
    };
  }

  if (type === 'NAT') {
    const num = Number(String(userAnswer).trim());
    const bounds = Array.isArray(answer)
      ? [Number(answer[0]), Number(answer[1] ?? answer[0])]
      : [Number(answer), Number(answer)];
    if (
      !Number.isFinite(num) ||
      !Number.isFinite(bounds[0]) ||
      !Number.isFinite(bounds[1])
    ) {
      return {
        status: 'WRONG',
        marksAwarded: Number(wrongPenalty.toFixed(6)),
      };
    }
    const min = Math.min(bounds[0], bounds[1]);
    const max = Math.max(bounds[0], bounds[1]);
    const isCorrect = num >= min - 1e-6 && num <= max + 1e-6;
    return {
      status: isCorrect ? 'CORRECT' : 'WRONG',
      marksAwarded: Number((isCorrect ? correctMarks : wrongPenalty).toFixed(6)),
    };
  }

  if (type === 'MSQ') {
    const correctSet = new Set(
      (Array.isArray(answer) ? answer : [])
        .map((v) => String(v).trim())
        .filter(Boolean)
    );
    const userSet = new Set(
      (Array.isArray(userAnswer) ? userAnswer : [])
        .map((v) => String(v).trim())
        .filter(Boolean)
    );

    if (correctSet.size === 0 || userSet.size === 0) {
      return { status: 'UNATTEMPTED', marksAwarded: 0 };
    }
    for (const opt of userSet) {
      if (!correctSet.has(opt)) {
        return {
          status: 'WRONG',
          marksAwarded: Number(wrongPenalty.toFixed(6)),
        };
      }
    }
    if (userSet.size === correctSet.size) {
      return {
        status: 'CORRECT',
        marksAwarded: Number(correctMarks.toFixed(6)),
      };
    }
    const partialRate = Number(marks?.partial ?? 0);
    if (partialRate > 0) {
      const awarded = Math.min(
        userSet.size * partialRate,
        (userSet.size / correctSet.size) * correctMarks
      );
      return {
        status: 'PARTIAL',
        marksAwarded: Number(awarded.toFixed(6)),
      };
    }
    return {
      status: 'WRONG',
      marksAwarded: Number(wrongPenalty.toFixed(6)),
    };
  }

  return { status: 'UNATTEMPTED', marksAwarded: 0 };
}

export function evaluateFullExam(
  exam: ExamSet,
  userResponses: Record<string, unknown>
): ExamEvaluationResult {
  let totalScore = 0;
  let computedMaxScore = 0;
  const sectionResults: ExamEvaluationResult['sectionResults'] = {};
  const questionResults: Record<string, QuestionEvaluation> = {};

  for (const section of exam.sections || []) {
    let sectionScore = 0;
    let attempted = 0;
    let correct = 0;
    let partial = 0;
    let wrong = 0;
    let unattempted = 0;
    const cap = section.maxAttempts ? Number(section.maxAttempts) : null;

    const sortedMarks = (section.questions || [])
      .map((q) => Number(q.marks?.correct ?? 0))
      .sort((a, b) => b - a);
    computedMaxScore += (
      cap ? sortedMarks.slice(0, cap) : sortedMarks
    ).reduce((acc, v) => acc + v, 0);

    for (const q of section.questions || []) {
      const raw = userResponses[q.id];
      const isAttempt = isQuestionAttempted(q, raw);

      if (isAttempt && cap !== null && attempted >= cap) {
        questionResults[q.id] = {
          status: 'UNATTEMPTED',
          marksAwarded: 0,
          ignoredByCap: true,
        };
        unattempted++;
        continue;
      }

      const res = evaluateQuestion(q, raw);
      questionResults[q.id] = res;
      sectionScore += res.marksAwarded;

      if (res.status === 'UNATTEMPTED') {
        unattempted++;
      } else {
        attempted++;
        if (res.status === 'CORRECT') correct++;
        else if (res.status === 'PARTIAL') partial++;
        else wrong++;
      }
    }

    sectionResults[section.id] = {
      score: Number(sectionScore.toFixed(2)),
      attempted,
      correct,
      partial,
      wrong,
      unattempted,
    };
    totalScore += sectionScore;
  }

  return {
    totalScore: Number(totalScore.toFixed(2)),
    maxScore: Number((exam.totalMarks || computedMaxScore).toFixed(2)),
    sectionResults,
    questionResults,
  };
}

// ============================================================================
// 4. POST-EXAM ANALYTICS & MONOTONIC TIMER COMPUTATIONS
// ============================================================================

export function computeRemainingMs(
  targetEndEpochMs: number,
  nowEpochMs: number = Date.now()
): number {
  if (!Number.isFinite(targetEndEpochMs)) return 0;
  return Math.max(0, targetEndEpochMs - nowEpochMs);
}

export function formatCountdownClock(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export function formatDurationCompact(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) {
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

export function computeFullExamAnalytics(params: {
  exam: ExamSet;
  responses: Record<string, unknown>;
  telemetry: Record<string, QuestionTelemetry>;
  markedForReview: Record<string, boolean>;
  fallbackTotalTimeMs?: number;
}): FullExamAnalytics {
  const { exam, responses, telemetry, markedForReview } = params;
  const evaluation = evaluateFullExam(exam, responses);

  let totalQuestions = 0;
  let totalAttempted = 0;
  let totalCorrect = 0;
  let totalPartial = 0;
  let totalWrong = 0;
  let totalUnattempted = 0;
  let positiveMarksEarned = 0;
  let negativeMarksLost = 0;
  let sumQuestionTimeMs = 0;

  const sectionBreakdown: SectionAnalyticsItem[] = [];
  const questionBreakdown: QuestionAnalyticsItem[] = [];

  let globalQNum = 0;

  for (const section of exam.sections || []) {
    const secEval = evaluation.sectionResults[section.id] || {
      score: 0,
      attempted: 0,
      correct: 0,
      partial: 0,
      wrong: 0,
      unattempted: 0,
    };

    const cap = section.maxAttempts ? Number(section.maxAttempts) : null;
    const sortedMarks = (section.questions || [])
      .map((q) => Number(q.marks?.correct ?? 0))
      .sort((a, b) => b - a);
    const secMaxMarks = (
      cap ? sortedMarks.slice(0, cap) : sortedMarks
    ).reduce((acc, v) => acc + v, 0);

    let secTimeMs = 0;
    let secNegLost = 0;

    for (const q of section.questions || []) {
      globalQNum++;
      totalQuestions++;
      const qEval = evaluation.questionResults[q.id] || {
        status: 'UNATTEMPTED' as const,
        marksAwarded: 0,
      };
      const qTel = telemetry[q.id] || { timeSpentMs: 0, visits: 0 };
      const qTime = Math.max(0, qTel.timeSpentMs || 0);
      secTimeMs += qTime;
      sumQuestionTimeMs += qTime;

      if (qEval.marksAwarded > 0) {
        positiveMarksEarned += qEval.marksAwarded;
      } else if (qEval.marksAwarded < 0) {
        const absLoss = Math.abs(qEval.marksAwarded);
        negativeMarksLost += absLoss;
        secNegLost += absLoss;
      }

      questionBreakdown.push({
        questionId: q.id,
        questionNumber: globalQNum,
        sectionId: section.id,
        sectionTitle: section.title,
        type: q.type,
        status: qEval.status,
        marksAwarded: Number(qEval.marksAwarded.toFixed(2)),
        positiveMarksPossible: Number(q.marks?.correct ?? 0),
        negativePenaltyPossible: Math.abs(Number(q.marks?.wrong ?? 0)),
        ignoredByCap: Boolean(qEval.ignoredByCap),
        timeSpentMs: qTime,
        visits: Math.max(0, qTel.visits || 0),
        markedForReview: Boolean(markedForReview[q.id]),
      });
    }

    totalAttempted += secEval.attempted;
    totalCorrect += secEval.correct;
    totalPartial += secEval.partial;
    totalWrong += secEval.wrong;
    totalUnattempted += secEval.unattempted;

    const secQCount = (section.questions || []).length;
    const secAccuracy =
      secEval.attempted > 0
        ? Number(
            (
              ((secEval.correct + secEval.partial * 0.5) / secEval.attempted) *
              100
            ).toFixed(1)
          )
        : 0;
    const secAttemptPct =
      secQCount > 0
        ? Number(((secEval.attempted / secQCount) * 100).toFixed(1))
        : 0;

    sectionBreakdown.push({
      sectionId: section.id,
      sectionTitle: section.title,
      totalQuestions: secQCount,
      maxAttempts: section.maxAttempts,
      maxMarks: Number(secMaxMarks.toFixed(2)),
      score: secEval.score,
      attempted: secEval.attempted,
      correct: secEval.correct,
      partial: secEval.partial,
      wrong: secEval.wrong,
      unattempted: secEval.unattempted,
      accuracyPct: secAccuracy,
      attemptPct: secAttemptPct,
      timeSpentMs: secTimeMs,
      negativeMarksLost: Number(secNegLost.toFixed(2)),
    });
  }

  const totalTimeSpentMs =
    sumQuestionTimeMs > 0
      ? sumQuestionTimeMs
      : Math.max(0, params.fallbackTotalTimeMs || 0);

  const accuracyPct =
    totalAttempted > 0
      ? Number(
          (
            ((totalCorrect + totalPartial * 0.5) / totalAttempted) *
            100
          ).toFixed(1)
        )
      : 0;

  const attemptPct =
    totalQuestions > 0
      ? Number(((totalAttempted / totalQuestions) * 100).toFixed(1))
      : 0;

  const scorePct =
    evaluation.maxScore > 0
      ? Number(
          Math.max(
            0,
            (evaluation.totalScore / evaluation.maxScore) * 100
          ).toFixed(1)
        )
      : 0;

  const avgTimePerAttemptedMs =
    totalAttempted > 0 ? Math.round(totalTimeSpentMs / totalAttempted) : 0;

  return {
    evaluation,
    scorePct,
    accuracyPct,
    attemptPct,
    totalQuestions,
    totalAttempted,
    totalCorrect,
    totalPartial,
    totalWrong,
    totalUnattempted,
    positiveMarksEarned: Number(positiveMarksEarned.toFixed(2)),
    negativeMarksLost: Number(negativeMarksLost.toFixed(2)),
    totalTimeSpentMs,
    avgTimePerAttemptedMs,
    sectionBreakdown,
    questionBreakdown,
  };
}

// ============================================================================
// 5. DETERMINISTIC ANSWER SUMMARIES & POST-EXAM DIAGNOSTIC INSIGHTS (ZERO-AI)
// ============================================================================

export function formatUserAnswerSummary(
  question: Pick<ExamQuestion, 'type' | 'options'>,
  rawAnswer: unknown
): string {
  if (!isQuestionAttempted(question, rawAnswer)) {
    return 'Unattempted';
  }
  if (question.type === 'MCQ') {
    const clean = String(rawAnswer).trim();
    const idx = (question.options || []).findIndex(
      (opt) => String(opt.id).trim() === clean
    );
    if (idx >= 0) {
      return `Option ${String.fromCharCode(65 + idx)}`;
    }
    return clean.slice(0, 80);
  }
  if (question.type === 'MSQ') {
    const selected = (Array.isArray(rawAnswer) ? rawAnswer : [])
      .map((v) => String(v).trim())
      .filter(Boolean);
    if (selected.length === 0) return 'Unattempted';
    const labels = selected.map((sel) => {
      const idx = (question.options || []).findIndex(
        (opt) => String(opt.id).trim() === sel
      );
      return idx >= 0 ? String.fromCharCode(65 + idx) : sel;
    });
    return `Option ${labels.join(', ')}`.slice(0, 120);
  }
  return String(rawAnswer).trim().slice(0, 80);
}

export function formatCorrectAnswerSummary(
  question: Pick<ExamQuestion, 'type' | 'options' | 'answer'>
): string {
  const { type, options, answer } = question;
  if (type === 'MCQ') {
    const clean = String(answer ?? '').trim();
    const idx = (options || []).findIndex(
      (opt) => String(opt.id).trim() === clean
    );
    return idx >= 0 ? `Option ${String.fromCharCode(65 + idx)}` : clean.slice(0, 80);
  }
  if (type === 'MSQ') {
    const arr = (Array.isArray(answer) ? answer : [])
      .map((v) => String(v).trim())
      .filter(Boolean);
    const labels = arr.map((sel) => {
      const idx = (options || []).findIndex(
        (opt) => String(opt.id).trim() === sel
      );
      return idx >= 0 ? String.fromCharCode(65 + idx) : sel;
    });
    return labels.length > 0 ? `Option ${labels.join(', ')}`.slice(0, 120) : '—';
  }
  if (Array.isArray(answer)) {
    const min = Number(answer[0]);
    const max = Number(answer[1] ?? answer[0]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return Math.abs(min - max) < 1e-6 ? `${min}` : `${min} to ${max}`;
    }
  }
  return String(answer ?? '—').trim().slice(0, 80);
}

export function computeAttemptPerformanceInsights(params: {
  exam: ExamSet;
  analytics: FullExamAnalytics;
}): AttemptPerformanceInsights {
  const { exam, analytics } = params;
  const allocatedExamMs = Math.max(
    60_000,
    Number(exam.duration || 60) * 60_000
  );
  const idealPerQuestionMs =
    analytics.totalQuestions > 0
      ? allocatedExamMs / analytics.totalQuestions
      : 60_000;
  const slowThresholdMs = Math.max(90_000, Math.round(idealPerQuestionMs * 1.6));

  const slowQuestionsCount = analytics.questionBreakdown.filter(
    (q) => q.timeSpentMs > slowThresholdMs
  ).length;

  const markedUnattemptedCount = analytics.questionBreakdown.filter(
    (q) => q.markedForReview && q.status === 'UNATTEMPTED'
  ).length;

  const wrongSlowCount = analytics.questionBreakdown.filter(
    (q) => q.status === 'WRONG' && q.timeSpentMs > slowThresholdMs
  ).length;

  const multiVisitCount = analytics.questionBreakdown.filter(
    (q) => q.visits >= 3
  ).length;

  const negativeMarkingImpactPct =
    analytics.positiveMarksEarned > 0
      ? Math.min(
          1000,
          Number(
            (
              (analytics.negativeMarksLost / analytics.positiveMarksEarned) *
              100
            ).toFixed(1)
          )
        )
      : analytics.negativeMarksLost > 0
      ? 100
      : 0;

  const sectionsByStrength = [...analytics.sectionBreakdown].sort((a, b) => {
    if (b.accuracyPct !== a.accuracyPct) return b.accuracyPct - a.accuracyPct;
    const ratioA = a.maxMarks > 0 ? a.score / a.maxMarks : 0;
    const ratioB = b.maxMarks > 0 ? b.score / b.maxMarks : 0;
    return ratioB - ratioA;
  });

  const strongestSec = sectionsByStrength[0];
  const weakestSec =
    sectionsByStrength.length >= 2
      ? sectionsByStrength[sectionsByStrength.length - 1]
      : undefined;

  const clockUtilization = analytics.totalTimeSpentMs / allocatedExamMs;
  let pacingVerdict = 'Balanced Exam Pacing';
  if (analytics.totalAttempted === 0) {
    pacingVerdict = 'Unattempted Run';
  } else if (clockUtilization > 0.92 && analytics.attemptPct < 65) {
    pacingVerdict = 'Time-Pressured — High Dwell Per Question';
  } else if (clockUtilization < 0.45 && analytics.accuracyPct < 65) {
    pacingVerdict = 'Fast Completion — Underutilized Exam Clock';
  } else if (
    slowQuestionsCount >= Math.max(3, Math.ceil(analytics.totalQuestions * 0.2))
  ) {
    pacingVerdict = 'Uneven Pacing — Time Sinks Detected';
  } else if (analytics.accuracyPct >= 80 && analytics.attemptPct >= 70) {
    pacingVerdict = 'Disciplined High-Accuracy Pacing';
  }

  const diagnosticSummary =
    analytics.totalAttempted === 0
      ? `No questions were attempted in this ${exam.duration}-minute session (${formatDurationCompact(
          analytics.totalTimeSpentMs
        )} elapsed). Use Solution Review to study the official step-by-step explanations before retaking this set.`
      : `Scored ${analytics.evaluation.totalScore} / ${
          analytics.evaluation.maxScore
        } (${analytics.scorePct}%) across ${analytics.totalAttempted} of ${
          analytics.totalQuestions
        } questions with ${analytics.accuracyPct}% accuracy in ${formatDurationCompact(
          analytics.totalTimeSpentMs
        )} (avg ${formatDurationCompact(
          analytics.avgTimePerAttemptedMs
        )} per attempted question).`;

  const takeaways: string[] = [];

  if (analytics.negativeMarksLost > 0) {
    takeaways.push(
      `Negative marking cost −${analytics.negativeMarksLost} marks across ${analytics.totalWrong} incorrect ${
        analytics.totalWrong === 1 ? 'response' : 'responses'
      } (${negativeMarkingImpactPct}% of your +${analytics.positiveMarksEarned} gross positive marks).Eliminating low-certainty guesses would raise your net score immediately.`
        .replace(').Eliminating', '). Eliminating')
        .slice(0, 380)
    );
  } else if (analytics.totalAttempted > 0) {
    takeaways.push(
      `Zero negative marks lost across ${analytics.totalAttempted} attempted questions — strong option-elimination discipline.`
    );
  }

  if (slowQuestionsCount > 0) {
    takeaways.push(
      `${slowQuestionsCount} ${
        slowQuestionsCount === 1 ? 'question' : 'questions'
      } exceeded ${formatDurationCompact(slowThresholdMs)} dwell time${
        wrongSlowCount > 0
          ? ` (${wrongSlowCount} still ended incorrect)`
          : ''
      }. Cap initial pass time at ${formatDurationCompact(
        Math.round(idealPerQuestionMs)
      )} and mark tough items for a second pass.`
    );
  }

  if (markedUnattemptedCount > 0) {
    takeaways.push(
      `${markedUnattemptedCount} ${
        markedUnattemptedCount === 1 ? 'question was' : 'questions were'
      } marked for review without a saved response. Reserve the final 5 minutes to convert marked items.`
    );
  }

  if (weakestSec && strongestSec && weakestSec.sectionId !== strongestSec.sectionId) {
    takeaways.push(
      `Prioritize "${weakestSec.sectionTitle}" (${weakestSec.score}/${weakestSec.maxMarks} marks, ${weakestSec.accuracyPct}% accuracy) to match your lead in "${strongestSec.sectionTitle}" (${strongestSec.accuracyPct}% accuracy).`
    );
  } else if (multiVisitCount > 0) {
    takeaways.push(
      `You revisited ${multiVisitCount} ${
        multiVisitCount === 1 ? 'question' : 'questions'
      } 3 or more times. Commit decisive first-pass skips to reduce navigation overhead.`
    );
  }

  if (takeaways.length === 0) {
    takeaways.push(
      `Review all ${analytics.totalUnattempted} unattempted questions in Solution Review to expand coverage on your next attempt.`
    );
  }

  return {
    ...(strongestSec
      ? {
          strongestSectionTitle: strongestSec.sectionTitle.slice(0, 200),
          strongestSectionAccuracyPct: strongestSec.accuracyPct,
        }
      : {}),
    ...(weakestSec
      ? {
          focusSectionTitle: weakestSec.sectionTitle.slice(0, 200),
          focusSectionAccuracyPct: weakestSec.accuracyPct,
        }
      : {}),
    pacingVerdict: pacingVerdict.slice(0, 80),
    negativeMarkingImpactPct,
    slowQuestionsCount,
    markedUnattemptedCount,
    diagnosticSummary: diagnosticSummary.slice(0, 1500),
    actionableTakeaways: takeaways.slice(0, 6).map((t) => t.slice(0, 400)),
  };
}

export function buildHistoricalExamAttemptRecord(params: {
  attemptId: string;
  userId?: string;
  packId: string;
  examSlug: string;
  examTitle: string;
  examSet: ExamSet;
  session: PersistedExamSession;
  completedAtEpochMs?: number;
}): HistoricalExamAttemptRecord {
  const {
    attemptId,
    userId,
    packId,
    examSlug,
    examTitle,
    examSet,
    session,
    completedAtEpochMs = session.submittedAtEpochMs || Date.now(),
  } = params;

  const analytics = computeFullExamAnalytics({
    exam: examSet,
    responses: session.responses,
    telemetry: session.telemetry,
    markedForReview: session.markedForReview,
    fallbackTotalTimeMs: session.totalTimeSpentMs,
  });

  const questionsById = new Map<string, ExamQuestion>();
  for (const sec of examSet.sections || []) {
    for (const q of sec.questions || []) {
      questionsById.set(q.id, q);
    }
  }

  const questionBreakdown: QuestionAttemptSnapshotItem[] =
    analytics.questionBreakdown.slice(0, 500).map((item) => {
      const qDef = questionsById.get(item.questionId);
      return {
        ...item,
        userAnswerSummary: qDef
          ? formatUserAnswerSummary(qDef, session.responses[item.questionId])
          : '—',
        correctAnswerSummary: qDef ? formatCorrectAnswerSummary(qDef) : '—',
      };
    });

  const performanceInsights = computeAttemptPerformanceInsights({
    exam: examSet,
    analytics,
  });

  const startedIso = new Date(
    session.startedAtEpochMs || completedAtEpochMs
  ).toISOString();
  const completedIso = new Date(completedAtEpochMs).toISOString();

  const sanitizedResponses: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(session.responses || {}).slice(0, 500)) {
    if (v !== undefined) {
      sanitizedResponses[k] = v;
    }
  }

  const sanitizedTelemetry: Record<string, QuestionTelemetry> = {};
  for (const [k, v] of Object.entries(session.telemetry || {}).slice(0, 500)) {
    if (v && typeof v === 'object') {
      sanitizedTelemetry[k] = {
        timeSpentMs: Math.max(0, Math.round(Number(v.timeSpentMs) || 0)),
        visits: Math.max(0, Math.round(Number(v.visits) || 0)),
      };
    }
  }

  const sanitizedMarked: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(session.markedForReview || {}).slice(
    0,
    500
  )) {
    if (v) {
      sanitizedMarked[k] = true;
    }
  }

  return {
    attemptId,
    idempotencyKey: attemptId,
    ...(userId ? { userId } : {}),
    packId,
    examSlug,
    examTitle,
    setId: examSet.id,
    setTitle: examSet.title,
    mode: session.mode,
    totalScore: analytics.evaluation.totalScore,
    maxScore: analytics.evaluation.maxScore,
    scorePct: analytics.scorePct,
    accuracyPct: analytics.accuracyPct,
    attemptPct: analytics.attemptPct,
    totalQuestions: analytics.totalQuestions,
    totalAttempted: analytics.totalAttempted,
    totalCorrect: analytics.totalCorrect,
    totalPartial: analytics.totalPartial,
    totalWrong: analytics.totalWrong,
    totalUnattempted: analytics.totalUnattempted,
    positiveMarksEarned: analytics.positiveMarksEarned,
    negativeMarksLost: analytics.negativeMarksLost,
    totalTimeSpentMs: Math.round(analytics.totalTimeSpentMs),
    avgTimePerAttemptedMs: Math.round(analytics.avgTimePerAttemptedMs),
    responses: sanitizedResponses,
    telemetry: sanitizedTelemetry,
    markedForReview: sanitizedMarked,
    sectionBreakdown: analytics.sectionBreakdown.slice(0, 30),
    questionBreakdown,
    performanceInsights,
    startedAtIso: startedIso,
    completedAtIso: completedIso,
    updatedAtIso: completedIso,
    synced: false,
  };
}
