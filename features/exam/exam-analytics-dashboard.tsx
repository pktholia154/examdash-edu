'use client';

import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  History,
  Loader2,
  MessageSquareText,
  RotateCcw,
  Star,
  Target,
  TrendingUp,
  Trophy,
  XCircle,
} from 'lucide-react';
import type {
  AttemptFeedbackPatch,
  AttemptPerformanceInsights,
  ExamQuestion,
  ExamSection,
  ExamSet,
  HistoricalExamAttemptRecord,
  PacingFeedback,
  PerceivedDifficulty,
  PersistedExamSession,
  QuestionAttemptSnapshotItem,
  SectionAnalyticsItem,
} from '../../lib/exam/types';
import {
  computeAttemptPerformanceInsights,
  computeFullExamAnalytics,
  formatCorrectAnswerSummary,
  formatDurationCompact,
  formatUserAnswerSummary,
} from '../../lib/exam/grading';
import { ExamQuestionWorkspace } from './exam-engine';
import { cn } from '../../lib/utils';

type AnalyticsTab = 'overview' | 'solutions' | 'analysis';
type ReviewFilter =
  | 'ALL'
  | 'CORRECT'
  | 'PARTIAL'
  | 'WRONG'
  | 'UNATTEMPTED'
  | 'MARKED';

const DIFFICULTY_OPTIONS: Array<{
  value: PerceivedDifficulty;
  label: string;
}> = [
  { value: 'easy', label: 'Easy' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'challenging', label: 'Challenging' },
  { value: 'tough', label: 'Tough' },
];

const PACING_OPTIONS: Array<{
  value: PacingFeedback;
  label: string;
}> = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'rushed', label: 'Felt Rushed' },
  { value: 'time_shortage', label: 'Time Shortage' },
];

function formatAttemptTimestamp(iso: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return '';
  }
}

function AttemptFeedbackPanel({
  attempt,
  isSignedIn,
  onSaveFeedback,
}: {
  attempt: HistoricalExamAttemptRecord | null;
  isSignedIn: boolean;
  onSaveFeedback?: (
    attemptId: string,
    patch: AttemptFeedbackPatch
  ) => Promise<void>;
}) {
  const [difficulty, setDifficulty] = useState<PerceivedDifficulty | null>(
    attempt?.perceivedDifficulty ?? null
  );
  const [pacing, setPacing] = useState<PacingFeedback | null>(
    attempt?.pacingFeedback ?? null
  );
  const [reflectionNote, setReflectionNote] = useState<string>(
    attempt?.reflectionNote ?? ''
  );
  const [saving, setSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>(
    'idle'
  );
  const [errorMessage, setErrorMessage] = useState<string>('');

  const isDirty = useMemo(() => {
    const origDiff = attempt?.perceivedDifficulty ?? null;
    const origPace = attempt?.pacingFeedback ?? null;
    const origNote = (attempt?.reflectionNote ?? '').trim();
    return (
      difficulty !== origDiff ||
      pacing !== origPace ||
      reflectionNote.trim() !== origNote
    );
  }, [attempt, difficulty, pacing, reflectionNote]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attempt || !onSaveFeedback) return;
    setSaving(true);
    setSaveStatus('idle');
    setErrorMessage('');
    try {
      await onSaveFeedback(attempt.attemptId, {
        perceivedDifficulty: difficulty,
        pacingFeedback: pacing,
        reflectionNote: reflectionNote.trim(),
      });
      setSaveStatus('saved');
    } catch (err) {
      setSaveStatus('error');
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to save post-exam reflection right now.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (!attempt) {
    return null;
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6 space-y-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-[var(--text-main)]">
            Post-Exam Self-Evaluation &amp; Mistake Log
          </h3>
          <p className="mt-0.5 text-xs sm:text-sm text-[var(--text-muted)]">
            {isSignedIn
              ? 'Saved with this historical attempt in your Firebase study record.'
              : 'Sign in with Google to sync your post-exam reflection notes across devices.'}
          </p>
        </div>
        {attempt.updatedAtIso &&
          (attempt.perceivedDifficulty ||
            attempt.pacingFeedback ||
            attempt.reflectionNote) && (
            <span className="text-xs text-[var(--text-muted)] tabular-nums">
              Updated {formatAttemptTimestamp(attempt.updatedAtIso)}
            </span>
          )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Perceived Difficulty */}
        <div className="space-y-2">
          <span className="block text-xs font-semibold text-[var(--text-main)]">
            Perceived Paper Difficulty
          </span>
          <div
            role="group"
            aria-label="Perceived paper difficulty"
            className="flex flex-wrap items-center gap-2"
          >
            {DIFFICULTY_OPTIONS.map((opt) => {
              const selected = difficulty === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setDifficulty(selected ? null : opt.value);
                    setSaveStatus('idle');
                  }}
                  className={cn(
                    'min-h-[44px] px-3.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0',
                    selected
                      ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)]'
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Pacing Self-Check */}
        <div className="space-y-2">
          <span className="block text-xs font-semibold text-[var(--text-main)]">
            Time &amp; Pacing Experience
          </span>
          <div
            role="group"
            aria-label="Time and pacing experience"
            className="flex flex-wrap items-center gap-2"
          >
            {PACING_OPTIONS.map((opt) => {
              const selected = pacing === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setPacing(selected ? null : opt.value);
                    setSaveStatus('idle');
                  }}
                  className={cn(
                    'min-h-[44px] px-3.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0',
                    selected
                      ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)]'
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Personal Reflection & Mistake Notes */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <label
            htmlFor={`attempt-reflection-${attempt.attemptId}`}
            className="text-xs font-semibold text-[var(--text-main)]"
          >
            Mistake Log, Silly Errors &amp; Revision Action Plan
          </label>
          <span className="text-xs text-[var(--text-muted)] tabular-nums">
            {reflectionNote.length} / 2000
          </span>
        </div>
        <textarea
          id={`attempt-reflection-${attempt.attemptId}`}
          rows={4}
          maxLength={2000}
          value={reflectionNote}
          onChange={(e) => {
            setReflectionNote(e.target.value);
            setSaveStatus('idle');
          }}
          placeholder="Record key takeaways from this attempt — e.g., conceptual gaps to revisit, calculation traps, or section order adjustments for your next mock..."
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5 text-base sm:text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand-primary)] leading-relaxed"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="text-xs">
          {saveStatus === 'saved' && !isDirty && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--status-success)]">
              <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {isSignedIn
                  ? 'Feedback saved to Firebase.'
                  : 'Feedback saved locally on this device.'}
              </span>
            </span>
          )}
          {saveStatus === 'error' && errorMessage && (
            <span className="font-semibold text-[var(--status-danger)]">
              {errorMessage}
            </span>
          )}
        </div>

        <button
          type="submit"
          disabled={saving || (!isDirty && saveStatus === 'saved')}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs sm:text-sm font-semibold hover:opacity-90 disabled:opacity-45 transition-opacity whitespace-nowrap shrink-0 ms-auto"
        >
          {saving ? (
            <>
              <Loader2
                className="w-4 h-4 animate-spin shrink-0"
                aria-hidden="true"
              />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <MessageSquareText
                className="w-4 h-4 shrink-0"
                aria-hidden="true"
              />
              <span>Save Feedback</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}

export function ExamAnalyticsDashboard({
  examTitle,
  examSlug,
  examSet,
  loadingExamSet = false,
  session,
  attemptsHistory = [],
  selectedAttemptId,
  onSelectAttempt,
  onSaveFeedback,
  isSignedIn = false,
  isOwned,
  onReattempt,
  backHref,
}: {
  examTitle: string;
  examSlug: string;
  examSet: ExamSet | null;
  loadingExamSet?: boolean;
  session?: PersistedExamSession | null;
  attemptsHistory?: HistoricalExamAttemptRecord[];
  selectedAttemptId?: string | null;
  onSelectAttempt?: (attemptId: string) => void;
  onSaveFeedback?: (
    attemptId: string,
    patch: AttemptFeedbackPatch
  ) => Promise<void>;
  isSignedIn?: boolean;
  isOwned: boolean;
  onReattempt: () => void;
  backHref: string;
}) {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('ALL');
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>(
    examSet?.sections[0]?.questions[0]?.id || ''
  );

  // Resolve currently viewed historical attempt (newest-first in attemptsHistory)
  const selectedAttempt = useMemo<HistoricalExamAttemptRecord | null>(() => {
    if (attemptsHistory.length === 0) return null;
    if (selectedAttemptId) {
      const exact = attemptsHistory.find(
        (a) => a.attemptId === selectedAttemptId
      );
      if (exact) return exact;
    }
    return attemptsHistory[0] || null;
  }, [attemptsHistory, selectedAttemptId]);

  const selectedAttemptIndex = useMemo(() => {
    if (!selectedAttempt) return -1;
    return attemptsHistory.findIndex(
      (a) => a.attemptId === selectedAttempt.attemptId
    );
  }, [attemptsHistory, selectedAttempt]);

  // Previous chronological attempt for score/accuracy progression delta
  const previousChronologicalAttempt = useMemo(() => {
    if (
      selectedAttemptIndex >= 0 &&
      selectedAttemptIndex + 1 < attemptsHistory.length
    ) {
      return attemptsHistory[selectedAttemptIndex + 1] || null;
    }
    return null;
  }, [attemptsHistory, selectedAttemptIndex]);

  // Effective responses/telemetry/markedForReview for the selected historical attempt (or fallback session)
  const effectiveResponses = useMemo<Record<string, unknown>>(
    () => selectedAttempt?.responses ?? session?.responses ?? {},
    [selectedAttempt, session]
  );

  const effectiveTelemetry = useMemo(
    () => selectedAttempt?.telemetry ?? session?.telemetry ?? {},
    [selectedAttempt, session]
  );

  const effectiveMarkedForReview = useMemo(
    () => selectedAttempt?.markedForReview ?? session?.markedForReview ?? {},
    [selectedAttempt, session]
  );

  // Recompute live from ExamSet when needed or enrich saved Firebase snapshot
  const liveComputed = useMemo(() => {
    if (!examSet) return null;
    const full = computeFullExamAnalytics({
      exam: examSet,
      responses: effectiveResponses,
      telemetry: effectiveTelemetry,
      markedForReview: effectiveMarkedForReview,
      fallbackTotalTimeMs:
        selectedAttempt?.totalTimeSpentMs ?? session?.totalTimeSpentMs,
    });
    const qMap = new Map<string, ExamQuestion>();
    for (const sec of examSet.sections || []) {
      for (const q of sec.questions || []) {
        qMap.set(q.id, q);
      }
    }
    const enrichedQuestions: QuestionAttemptSnapshotItem[] =
      full.questionBreakdown.map((item) => {
        const qDef = qMap.get(item.questionId);
        return {
          ...item,
          userAnswerSummary: qDef
            ? formatUserAnswerSummary(qDef, effectiveResponses[item.questionId])
            : '—',
          correctAnswerSummary: qDef ? formatCorrectAnswerSummary(qDef) : '—',
        };
      });
    const insights = computeAttemptPerformanceInsights({
      exam: examSet,
      analytics: full,
    });
    return { full, enrichedQuestions, insights };
  }, [
    effectiveMarkedForReview,
    effectiveResponses,
    effectiveTelemetry,
    examSet,
    selectedAttempt?.totalTimeSpentMs,
    session?.totalTimeSpentMs,
  ]);

  // Unified resolved view model (works both with ExamSet loaded AND directly from Firebase attempt doc)
  const resolvedData = useMemo(() => {
    if (
      selectedAttempt &&
      selectedAttempt.sectionBreakdown.length > 0 &&
      selectedAttempt.questionBreakdown.length > 0
    ) {
      // If examSet is loaded and stored summaries were placeholder '—', enrich summaries deterministically
      const liveQById = new Map(
        (liveComputed?.enrichedQuestions || []).map((q) => [q.questionId, q])
      );
      const mergedQuestions: QuestionAttemptSnapshotItem[] =
        selectedAttempt.questionBreakdown.map((q) => {
          const liveQ = liveQById.get(q.questionId);
          if (!liveQ) return q;
          return {
            ...q,
            userAnswerSummary:
              q.userAnswerSummary && q.userAnswerSummary !== '—'
                ? q.userAnswerSummary
                : liveQ.userAnswerSummary,
            correctAnswerSummary:
              q.correctAnswerSummary && q.correctAnswerSummary !== '—'
                ? q.correctAnswerSummary
                : liveQ.correctAnswerSummary,
          };
        });

      return {
        setTitle: examSet?.title || selectedAttempt.setTitle,
        mode: selectedAttempt.mode,
        totalScore: selectedAttempt.totalScore,
        maxScore: selectedAttempt.maxScore,
        scorePct: selectedAttempt.scorePct,
        accuracyPct: selectedAttempt.accuracyPct,
        attemptPct: selectedAttempt.attemptPct,
        totalQuestions: selectedAttempt.totalQuestions,
        totalAttempted: selectedAttempt.totalAttempted,
        totalCorrect: selectedAttempt.totalCorrect,
        totalPartial: selectedAttempt.totalPartial,
        totalWrong: selectedAttempt.totalWrong,
        totalUnattempted: selectedAttempt.totalUnattempted,
        positiveMarksEarned: selectedAttempt.positiveMarksEarned,
        negativeMarksLost: selectedAttempt.negativeMarksLost,
        totalTimeSpentMs: selectedAttempt.totalTimeSpentMs,
        avgTimePerAttemptedMs: selectedAttempt.avgTimePerAttemptedMs,
        sectionBreakdown: selectedAttempt.sectionBreakdown,
        questionBreakdown: mergedQuestions,
        performanceInsights: selectedAttempt.performanceInsights,
      };
    }

    if (liveComputed && examSet) {
      const { full, enrichedQuestions, insights } = liveComputed;
      return {
        setTitle: examSet.title,
        mode: selectedAttempt?.mode ?? session?.mode ?? 'full',
        totalScore: full.evaluation.totalScore,
        maxScore: full.evaluation.maxScore,
        scorePct: full.scorePct,
        accuracyPct: full.accuracyPct,
        attemptPct: full.attemptPct,
        totalQuestions: full.totalQuestions,
        totalAttempted: full.totalAttempted,
        totalCorrect: full.totalCorrect,
        totalPartial: full.totalPartial,
        totalWrong: full.totalWrong,
        totalUnattempted: full.totalUnattempted,
        positiveMarksEarned: full.positiveMarksEarned,
        negativeMarksLost: full.negativeMarksLost,
        totalTimeSpentMs: full.totalTimeSpentMs,
        avgTimePerAttemptedMs: full.avgTimePerAttemptedMs,
        sectionBreakdown: full.sectionBreakdown as SectionAnalyticsItem[],
        questionBreakdown: enrichedQuestions,
        performanceInsights: insights as AttemptPerformanceInsights,
      };
    }

    // Minimal fallback when legacy summary is loaded before ExamSet arrives
    return {
      setTitle: selectedAttempt?.setTitle || 'Mock Exam Result',
      mode: selectedAttempt?.mode ?? session?.mode ?? 'full',
      totalScore: selectedAttempt?.totalScore ?? 0,
      maxScore: selectedAttempt?.maxScore ?? 0,
      scorePct: selectedAttempt?.scorePct ?? 0,
      accuracyPct: selectedAttempt?.accuracyPct ?? 0,
      attemptPct: selectedAttempt?.attemptPct ?? 0,
      totalQuestions: selectedAttempt?.totalQuestions ?? 0,
      totalAttempted: selectedAttempt?.totalAttempted ?? 0,
      totalCorrect: selectedAttempt?.totalCorrect ?? 0,
      totalPartial: selectedAttempt?.totalPartial ?? 0,
      totalWrong: selectedAttempt?.totalWrong ?? 0,
      totalUnattempted: selectedAttempt?.totalUnattempted ?? 0,
      positiveMarksEarned: selectedAttempt?.positiveMarksEarned ?? 0,
      negativeMarksLost: selectedAttempt?.negativeMarksLost ?? 0,
      totalTimeSpentMs: selectedAttempt?.totalTimeSpentMs ?? 0,
      avgTimePerAttemptedMs: selectedAttempt?.avgTimePerAttemptedMs ?? 0,
      sectionBreakdown: selectedAttempt?.sectionBreakdown ?? [],
      questionBreakdown: selectedAttempt?.questionBreakdown ?? [],
      performanceInsights: selectedAttempt?.performanceInsights ?? {
        pacingVerdict: 'Recorded Attempt',
        negativeMarkingImpactPct: 0,
        slowQuestionsCount: 0,
        markedUnattemptedCount: 0,
        diagnosticSummary: '',
        actionableTakeaways: [],
      },
    };
  }, [examSet, liveComputed, selectedAttempt, session?.mode]);

  const flatQuestions = useMemo(() => {
    if (!examSet) return [];
    const list: Array<{
      question: ExamQuestion;
      section: ExamSection;
      globalNumber: number;
    }> = [];
    let num = 0;
    for (const sec of examSet.sections || []) {
      for (const q of sec.questions || []) {
        num++;
        list.push({ question: q, section: sec, globalNumber: num });
      }
    }
    return list;
  }, [examSet]);

  const breakdownById = useMemo(() => {
    return new Map(
      resolvedData.questionBreakdown.map((item) => [item.questionId, item])
    );
  }, [resolvedData.questionBreakdown]);

  const filteredQuestions = useMemo(() => {
    return flatQuestions.filter(({ question }) => {
      const meta = breakdownById.get(question.id);
      if (!meta) return false;
      if (reviewFilter === 'ALL') return true;
      if (reviewFilter === 'MARKED') return meta.markedForReview;
      return meta.status === reviewFilter;
    });
  }, [breakdownById, flatQuestions, reviewFilter]);

  const activeReviewEntry = useMemo(() => {
    const inFiltered = filteredQuestions.find(
      (f) => f.question.id === selectedQuestionId
    );
    if (inFiltered) return inFiltered;
    return filteredQuestions[0] || flatQuestions[0] || null;
  }, [filteredQuestions, flatQuestions, selectedQuestionId]);

  const activeQuestionMeta = activeReviewEntry
    ? breakdownById.get(activeReviewEntry.question.id)
    : null;

  const markedCount = useMemo(
    () =>
      resolvedData.questionBreakdown.filter((item) => item.markedForReview)
        .length,
    [resolvedData.questionBreakdown]
  );

  const jumpToSolution = (questionId: string) => {
    setReviewFilter('ALL');
    setSelectedQuestionId(questionId);
    setActiveTab('solutions');
  };

  const activeFilteredIdx = activeReviewEntry
    ? filteredQuestions.findIndex(
        (f) => f.question.id === activeReviewEntry.question.id
      )
    : -1;

  const attemptChronologicalNumber =
    selectedAttemptIndex >= 0
      ? attemptsHistory.length - selectedAttemptIndex
      : 1;

  const scoreDelta = previousChronologicalAttempt
    ? Number(
        (
          resolvedData.totalScore - previousChronologicalAttempt.totalScore
        ).toFixed(2)
      )
    : null;
  const accuracyDelta = previousChronologicalAttempt
    ? Number(
        (
          resolvedData.accuracyPct - previousChronologicalAttempt.accuracyPct
        ).toFixed(1)
      )
    : null;

  return (
    <div className="ed-container py-6 sm:py-8 space-y-6">
      {/* Top Result Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[var(--border-subtle)]">
        <div className="flex items-start sm:items-center gap-3.5 min-w-0">
          <a
            href={backHref}
            aria-label="Back to library or exam pack"
            className="inline-flex items-center justify-center min-h-12 min-w-12 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </a>
          <div className="min-w-0">
            {/* Clean Unboxed Metadata (Zero-Pill) */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-medium text-[var(--text-muted)] tabular-nums">
              <span>{examTitle}</span>
              <span aria-hidden="true">·</span>
              <span>
                {resolvedData.mode === 'trial'
                  ? 'Free Sample Result'
                  : 'Official Mock Result'}
              </span>
              {selectedAttempt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    Attempt #{attemptChronologicalNumber} of{' '}
                    {attemptsHistory.length}
                  </span>
                </>
              )}
              {selectedAttempt?.completedAtIso && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {formatAttemptTimestamp(selectedAttempt.completedAtIso)}
                  </span>
                </>
              )}
              {isSignedIn && selectedAttempt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    className={cn(
                      'font-semibold',
                      selectedAttempt.synced
                        ? 'text-[var(--status-success)]'
                        : 'text-[var(--text-muted)]'
                    )}
                  >
                    {selectedAttempt.synced
                      ? 'Saved in Firebase'
                      : 'Syncing to Firebase...'}
                  </span>
                </>
              )}
            </div>
            <h1 className="mt-0.5 text-xl sm:text-2xl font-extrabold tracking-tight text-[var(--text-main)] truncate">
              {resolvedData.setTitle}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onReattempt}
            className="inline-flex items-center justify-center gap-2 min-h-12 px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-xs sm:text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Reattempt Set</span>
          </button>

          {!isOwned ? (
            <a
              href={`/exams/${examSlug}`}
              className="inline-flex items-center justify-center gap-2 min-h-12 px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs sm:text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
            >
              <span>Unlock Full Exam Pack</span>
            </a>
          ) : (
            <a
              href="/purchased"
              className="inline-flex items-center justify-center gap-2 min-h-12 px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs sm:text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
            >
              <span>All Unlocked Sets</span>
            </a>
          )}
        </div>
      </div>

      {/* Historical Attempt Switcher & Progression Bar */}
      {attemptsHistory.length > 1 && (
        <section
          aria-label="Historical attempts for this exam set"
          className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 sm:p-4 space-y-2.5 tabular-nums"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--text-main)]">
              <History
                className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0"
                aria-hidden="true"
              />
              <span>
                Attempt History ({attemptsHistory.length} Recorded Attempts)
              </span>
            </div>

            {previousChronologicalAttempt && scoreDelta !== null && (
              <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                <TrendingUp
                  className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0"
                  aria-hidden="true"
                />
                <span>
                  vs Attempt #{attemptChronologicalNumber - 1}:{' '}
                  <strong
                    className={cn(
                      'font-semibold',
                      scoreDelta > 0
                        ? 'text-[var(--status-success)]'
                        : scoreDelta < 0
                        ? 'text-[var(--status-danger)]'
                        : 'text-[var(--text-main)]'
                    )}
                  >
                    {scoreDelta > 0 ? `+${scoreDelta}` : scoreDelta} marks
                  </strong>
                  {accuracyDelta !== null && (
                    <>
                      {' · '}
                      <strong
                        className={cn(
                          'font-semibold',
                          accuracyDelta > 0
                            ? 'text-[var(--status-success)]'
                            : accuracyDelta < 0
                            ? 'text-[var(--status-danger)]'
                            : 'text-[var(--text-main)]'
                        )}
                      >
                        {accuracyDelta > 0
                          ? `+${accuracyDelta}%`
                          : `${accuracyDelta}%`}{' '}
                        accuracy
                      </strong>
                    </>
                  )}
                </span>
              </div>
            )}
          </div>

          <div
            role="group"
            aria-label="Select historical attempt"
            className="flex items-center gap-2 overflow-x-auto pb-0.5"
          >
            {attemptsHistory.map((att, idx) => {
              const chronNum = attemptsHistory.length - idx;
              const isSelected = selectedAttempt?.attemptId === att.attemptId;
              const shortDate = formatAttemptTimestamp(att.completedAtIso);
              return (
                <button
                  key={att.attemptId}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelectAttempt?.(att.attemptId)}
                  className={cn(
                    'min-h-[44px] px-3.5 py-2 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0',
                    isSelected
                      ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)]'
                  )}
                >
                  <span>
                    Attempt #{chronNum}
                    {idx === 0 ? ' (Latest)' : ''} · {att.totalScore}/
                    {att.maxScore}
                  </span>
                  {shortDate && (
                    <span
                      className={cn(
                        'ms-1.5 font-normal',
                        isSelected ? 'opacity-85' : 'text-[var(--text-muted)]'
                      )}
                    >
                      · {shortDate}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Primary KPI Strip */}
      <section
        aria-label="Exam score summary"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 tabular-nums"
      >
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-muted)]">
            <span>Net Score</span>
            <Trophy
              className="w-4 h-4 text-[var(--text-muted)]"
              aria-hidden="true"
            />
          </div>
          <p className="mt-2 text-2xl sm:text-3xl font-extrabold text-[var(--text-main)]">
            {resolvedData.totalScore}
            <span className="text-base font-semibold text-[var(--text-muted)]">
              {' '}
              / {resolvedData.maxScore}
            </span>
          </p>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            <span className="text-[var(--status-success)] font-semibold">
              +{resolvedData.positiveMarksEarned}
            </span>{' '}
            earned ·{' '}
            <span className="text-[var(--status-danger)] font-semibold">
              −{resolvedData.negativeMarksLost}
            </span>{' '}
            negative
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-muted)]">
            <span>Accuracy</span>
            <Target
              className="w-4 h-4 text-[var(--text-muted)]"
              aria-hidden="true"
            />
          </div>
          <p className="mt-2 text-2xl sm:text-3xl font-extrabold text-[var(--text-main)]">
            {resolvedData.accuracyPct}%
          </p>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            {resolvedData.totalCorrect} Correct · {resolvedData.totalPartial}{' '}
            Partial · {resolvedData.totalWrong} Wrong
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-muted)]">
            <span>Attempted</span>
            <BarChart3
              className="w-4 h-4 text-[var(--text-muted)]"
              aria-hidden="true"
            />
          </div>
          <p className="mt-2 text-2xl sm:text-3xl font-extrabold text-[var(--text-main)]">
            {resolvedData.totalAttempted}
            <span className="text-base font-semibold text-[var(--text-muted)]">
              {' '}
              / {resolvedData.totalQuestions}
            </span>
          </p>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            {resolvedData.attemptPct}% attempted ·{' '}
            {resolvedData.totalUnattempted} unattempted
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-muted)]">
            <span>Time Spent</span>
            <Clock
              className="w-4 h-4 text-[var(--text-muted)]"
              aria-hidden="true"
            />
          </div>
          <p className="mt-2 text-2xl sm:text-3xl font-extrabold text-[var(--text-main)]">
            {formatDurationCompact(resolvedData.totalTimeSpentMs)}
          </p>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            Avg {formatDurationCompact(resolvedData.avgTimePerAttemptedMs)} /
            attempted Q
          </p>
        </div>
      </section>

      {/* View Switcher Tabs */}
      <div
        role="tablist"
        aria-label="Analytics views"
        className="flex items-center gap-1 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 tabular-nums w-fit max-w-full"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'overview'}
          onClick={() => setActiveTab('overview')}
          className={cn(
            'min-h-[44px] px-4 rounded-md text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0',
            activeTab === 'overview'
              ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
          )}
        >
          Section &amp; Time Telemetry
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'solutions'}
          onClick={() => setActiveTab('solutions')}
          className={cn(
            'min-h-[44px] px-4 rounded-md text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0',
            activeTab === 'solutions'
              ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
          )}
        >
          Solution Review ({resolvedData.totalQuestions})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'analysis'}
          onClick={() => setActiveTab('analysis')}
          className={cn(
            'min-h-[44px] px-4 rounded-md text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0',
            activeTab === 'analysis'
              ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
          )}
        >
          Analysis &amp; Feedback
        </button>
      </div>

      {/* TAB 1: SECTION & TIME TELEMETRY */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          {/* Section-Wise Breakdown Table */}
          <section
            aria-labelledby="section-breakdown-heading"
            className="space-y-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2
                id="section-breakdown-heading"
                className="text-base sm:text-lg font-bold text-[var(--text-main)]"
              >
                Section-Wise Performance &amp; Time Telemetry
              </h2>
              <span className="text-xs text-[var(--text-muted)] tabular-nums">
                {resolvedData.sectionBreakdown.length}{' '}
                {resolvedData.sectionBreakdown.length === 1
                  ? 'Section'
                  : 'Sections'}
              </span>
            </div>

            <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
              <table className="w-full text-start border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 text-xs font-semibold text-[var(--text-muted)]">
                    <th scope="col" className="py-3 px-4 text-start">
                      Section
                    </th>
                    <th scope="col" className="py-3 px-4 text-end">
                      Score
                    </th>
                    <th scope="col" className="py-3 px-4 text-end">
                      Attempted
                    </th>
                    <th scope="col" className="py-3 px-4 text-end">
                      Correct
                    </th>
                    <th scope="col" className="py-3 px-4 text-end">
                      Partial
                    </th>
                    <th scope="col" className="py-3 px-4 text-end">
                      Wrong
                    </th>
                    <th scope="col" className="py-3 px-4 text-end">
                      Neg. Lost
                    </th>
                    <th scope="col" className="py-3 px-4 text-end">
                      Accuracy
                    </th>
                    <th scope="col" className="py-3 px-4 text-end">
                      Time Spent
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {resolvedData.sectionBreakdown.map((sec) => {
                    const sharePct =
                      resolvedData.totalTimeSpentMs > 0
                        ? Math.round(
                            (sec.timeSpentMs / resolvedData.totalTimeSpentMs) *
                              100
                          )
                        : 0;
                    return (
                      <tr
                        key={sec.sectionId}
                        className="hover:bg-[var(--bg-elevated)]/40 transition-colors"
                      >
                        <td className="py-3 px-4 font-semibold text-[var(--text-main)]">
                          <div>{sec.sectionTitle}</div>
                          {sec.maxAttempts ? (
                            <div className="text-xs font-normal text-[var(--text-muted)]">
                              Attempt cap: {sec.maxAttempts} of{' '}
                              {sec.totalQuestions}
                            </div>
                          ) : null}
                        </td>
                        <td className="py-3 px-4 text-end font-bold text-[var(--text-main)] whitespace-nowrap">
                          {sec.score} / {sec.maxMarks}
                        </td>
                        <td className="py-3 px-4 text-end text-[var(--text-muted)] whitespace-nowrap">
                          {sec.attempted} / {sec.totalQuestions}
                        </td>
                        <td className="py-3 px-4 text-end font-semibold text-[var(--status-success)]">
                          {sec.correct}
                        </td>
                        <td className="py-3 px-4 text-end font-semibold text-[var(--status-warning)]">
                          {sec.partial}
                        </td>
                        <td className="py-3 px-4 text-end font-semibold text-[var(--status-danger)]">
                          {sec.wrong}
                        </td>
                        <td className="py-3 px-4 text-end text-[var(--text-muted)] whitespace-nowrap">
                          {sec.negativeMarksLost > 0
                            ? `−${sec.negativeMarksLost}`
                            : '0'}
                        </td>
                        <td className="py-3 px-4 text-end text-[var(--text-main)] whitespace-nowrap">
                          {sec.accuracyPct}%
                        </td>
                        <td className="py-3 px-4 text-end text-[var(--text-muted)] whitespace-nowrap">
                          <span className="text-[var(--text-main)] font-medium">
                            {formatDurationCompact(sec.timeSpentMs)}
                          </span>
                          {resolvedData.sectionBreakdown.length > 1 && (
                            <span className="text-xs text-[var(--text-muted)]">
                              {' '}
                              ({sharePct}%)
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Per-Question Dwell Time, Response, Key & Revisit Telemetry */}
          <section
            aria-labelledby="question-telemetry-heading"
            className="space-y-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2
                id="question-telemetry-heading"
                className="text-base sm:text-lg font-bold text-[var(--text-main)]"
              >
                Question-Wise Time, Response &amp; Revisit Log
              </h2>
              <span className="text-xs text-[var(--text-muted)]">
                Select Review on any question to open its full step-by-step
                explanation
              </span>
            </div>

            <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
              <table className="w-full text-start border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 text-xs font-semibold text-[var(--text-muted)]">
                    <th scope="col" className="py-3 px-4 text-start">
                      Q #
                    </th>
                    <th scope="col" className="py-3 px-4 text-start">
                      Section &amp; Type
                    </th>
                    <th scope="col" className="py-3 px-4 text-start">
                      Outcome
                    </th>
                    <th scope="col" className="py-3 px-4 text-start">
                      Your Answer
                    </th>
                    <th scope="col" className="py-3 px-4 text-start">
                      Official Key
                    </th>
                    <th scope="col" className="py-3 px-4 text-end">
                      Marks
                    </th>
                    <th scope="col" className="py-3 px-4 text-end">
                      Dwell Time
                    </th>
                    <th scope="col" className="py-3 px-4 text-end">
                      Visits
                    </th>
                    <th scope="col" className="py-3 px-4 text-end">
                      Solution
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {resolvedData.questionBreakdown.map((q) => (
                    <tr
                      key={q.questionId}
                      className="hover:bg-[var(--bg-elevated)]/40 transition-colors"
                    >
                      <td className="py-3 px-4 font-bold text-[var(--text-main)] whitespace-nowrap">
                        Q{q.questionNumber}
                      </td>
                      <td className="py-3 px-4 text-[var(--text-muted)]">
                        <span className="text-[var(--text-main)] font-medium">
                          {q.sectionTitle}
                        </span>{' '}
                        · {q.type}
                        {q.markedForReview ? ' · Marked' : ''}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {q.status === 'CORRECT' && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--status-success)]">
                            <CheckCircle2
                              className="w-3.5 h-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            <span>Correct</span>
                          </span>
                        )}
                        {q.status === 'PARTIAL' && (
                          <span className="text-xs font-semibold text-[var(--status-warning)]">
                            Partial Credit
                          </span>
                        )}
                        {q.status === 'WRONG' && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--status-danger)]">
                            <XCircle
                              className="w-3.5 h-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            <span>Incorrect</span>
                          </span>
                        )}
                        {q.status === 'UNATTEMPTED' && (
                          <span className="text-xs font-medium text-[var(--text-muted)]">
                            {q.ignoredByCap ? 'Ignored (Cap)' : 'Unattempted'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium text-[var(--text-main)] whitespace-nowrap">
                        {q.userAnswerSummary || '—'}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium text-[var(--text-muted)] whitespace-nowrap">
                        {q.correctAnswerSummary || '—'}
                      </td>
                      <td
                        className={cn(
                          'py-3 px-4 text-end font-bold whitespace-nowrap',
                          q.marksAwarded > 0
                            ? 'text-[var(--status-success)]'
                            : q.marksAwarded < 0
                            ? 'text-[var(--status-danger)]'
                            : 'text-[var(--text-muted)]'
                        )}
                      >
                        {q.marksAwarded > 0
                          ? `+${q.marksAwarded}`
                          : q.marksAwarded}
                      </td>
                      <td className="py-3 px-4 text-end text-[var(--text-main)] whitespace-nowrap">
                        {formatDurationCompact(q.timeSpentMs)}
                      </td>
                      <td className="py-3 px-4 text-end text-[var(--text-muted)] whitespace-nowrap">
                        {q.visits}
                      </td>
                      <td className="py-3 px-4 text-end whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => jumpToSolution(q.questionId)}
                          className="inline-flex items-center gap-1 min-h-[40px] px-3 rounded-md text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Review →</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: INTERACTIVE QUESTION-BY-QUESTION SOLUTION REVIEW */}
      {activeTab === 'solutions' && (
        <section
          aria-label="Question by question solution review"
          className="space-y-4"
        >
          {loadingExamSet && !examSet ? (
            <div className="space-y-3">
              <div className="h-12 w-full rounded-xl ed-skeleton" />
              <div className="h-72 w-full rounded-[var(--radius-card)] ed-skeleton" />
            </div>
          ) : !examSet ? (
            <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 sm:p-8 text-center space-y-2">
              <p className="text-base font-bold text-[var(--text-main)]">
                Question paper prose requires online connection or offline vault
                copy
              </p>
              <p className="text-xs sm:text-sm text-[var(--text-muted)] max-w-lg mx-auto">
                Your complete historical score, section telemetry, question
                dwell times, recorded answers, official keys, and reflections
                are available in the Section &amp; Time Telemetry and Analysis
                &amp; Feedback tabs. Reconnect or save this exam pack offline in
                Purchased Library to render full question diagrams and
                step-by-step explanations.
              </p>
            </div>
          ) : (
            <>
              {/* Filter Controls */}
              <div className="flex flex-wrap items-center gap-2 tabular-nums">
                {(
                  [
                    {
                      id: 'ALL',
                      label: `All (${resolvedData.totalQuestions})`,
                    },
                    {
                      id: 'CORRECT',
                      label: `Correct (${resolvedData.totalCorrect})`,
                    },
                    ...(resolvedData.totalPartial > 0
                      ? [
                          {
                            id: 'PARTIAL' as const,
                            label: `Partial (${resolvedData.totalPartial})`,
                          },
                        ]
                      : []),
                    {
                      id: 'WRONG',
                      label: `Wrong (${resolvedData.totalWrong})`,
                    },
                    {
                      id: 'UNATTEMPTED',
                      label: `Unattempted (${resolvedData.totalUnattempted})`,
                    },
                    ...(markedCount > 0
                      ? [
                          {
                            id: 'MARKED' as const,
                            label: `Marked (${markedCount})`,
                          },
                        ]
                      : []),
                  ] as Array<{ id: ReviewFilter; label: string }>
                ).map((f) => {
                  const active = reviewFilter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setReviewFilter(f.id);
                        const nextMatch = flatQuestions.find(({ question }) => {
                          const m = breakdownById.get(question.id);
                          if (!m) return false;
                          if (f.id === 'ALL') return true;
                          if (f.id === 'MARKED') return m.markedForReview;
                          return m.status === f.id;
                        });
                        if (nextMatch) {
                          setSelectedQuestionId(nextMatch.question.id);
                        }
                      }}
                      className={cn(
                        'min-h-[44px] px-3.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0',
                        active
                          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--border-strong)]'
                      )}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>

              {filteredQuestions.length === 0 || !activeReviewEntry ? (
                <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center text-sm text-[var(--text-muted)]">
                  No questions match the selected filter.
                </div>
              ) : (
                <>
                  {/* Question Number Jump Strip */}
                  <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 tabular-nums">
                    {filteredQuestions.map(({ question, globalNumber }) => {
                      const meta = breakdownById.get(question.id);
                      const isCurrent =
                        question.id === activeReviewEntry.question.id;
                      let statusCls =
                        'border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--text-main)]';
                      if (meta?.status === 'CORRECT') {
                        statusCls =
                          'border-emerald-600 bg-emerald-600 text-white';
                      } else if (meta?.status === 'PARTIAL') {
                        statusCls = 'border-amber-600 bg-amber-600 text-white';
                      } else if (meta?.status === 'WRONG') {
                        statusCls = 'border-rose-600 bg-rose-600 text-white';
                      }

                      return (
                        <button
                          key={question.id}
                          type="button"
                          aria-label={`Review Question ${globalNumber} (${
                            meta?.status || 'UNATTEMPTED'
                          })`}
                          aria-current={isCurrent ? 'step' : undefined}
                          onClick={() => setSelectedQuestionId(question.id)}
                          className={cn(
                            'min-h-[44px] min-w-[44px] px-2.5 rounded-lg border text-xs font-bold transition-transform active:scale-95',
                            statusCls,
                            isCurrent &&
                              'ring-2 ring-offset-2 ring-[var(--brand-primary)] ring-offset-[var(--bg-surface)]'
                          )}
                        >
                          {globalNumber}
                        </button>
                      );
                    })}
                  </div>

                  {/* Active Question Telemetry Strip + Prev/Next */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-4 py-2.5 text-xs tabular-nums">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[var(--text-muted)]">
                      <span className="font-semibold text-[var(--text-main)]">
                        {activeReviewEntry.section.title}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Your Answer:{' '}
                        <strong className="font-semibold text-[var(--text-main)]">
                          {activeQuestionMeta?.userAnswerSummary || '—'}
                        </strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Dwell Time:{' '}
                        <strong className="font-semibold text-[var(--text-main)]">
                          {formatDurationCompact(
                            activeQuestionMeta?.timeSpentMs ?? 0
                          )}
                        </strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Visits:{' '}
                        <strong className="font-semibold text-[var(--text-main)]">
                          {activeQuestionMeta?.visits ?? 0}
                        </strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={activeFilteredIdx <= 0}
                        onClick={() => {
                          const prev = filteredQuestions[activeFilteredIdx - 1];
                          if (prev) setSelectedQuestionId(prev.question.id);
                        }}
                        className="inline-flex items-center gap-1 min-h-[44px] px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] font-semibold text-[var(--text-main)] disabled:opacity-40 whitespace-nowrap"
                      >
                        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                        <span>Prev</span>
                      </button>
                      <button
                        type="button"
                        disabled={
                          activeFilteredIdx < 0 ||
                          activeFilteredIdx >= filteredQuestions.length - 1
                        }
                        onClick={() => {
                          const next = filteredQuestions[activeFilteredIdx + 1];
                          if (next) setSelectedQuestionId(next.question.id);
                        }}
                        className="inline-flex items-center gap-1 min-h-[44px] px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] font-semibold text-[var(--text-main)] disabled:opacity-40 whitespace-nowrap"
                      >
                        <span>Next</span>
                        <ChevronRight className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {/* Solution Workspace (`mode="review"`) */}
                  <ExamQuestionWorkspace
                    section={activeReviewEntry.section}
                    question={activeReviewEntry.question}
                    questionNumber={activeReviewEntry.globalNumber}
                    sectionResponses={effectiveResponses}
                    onChange={() => {}}
                    mode="review"
                    showVirtualKeypad={false}
                  />
                </>
              )}
            </>
          )}
        </section>
      )}

      {/* TAB 3: POST-EXAM DIAGNOSTIC ANALYSIS & LEARNER FEEDBACK */}
      {activeTab === 'analysis' && (
        <div className="space-y-6 tabular-nums">
          <section
            aria-labelledby="diagnostic-insights-heading"
            className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6 space-y-5"
          >
            <div>
              <h2
                id="diagnostic-insights-heading"
                className="text-base sm:text-lg font-bold text-[var(--text-main)]"
              >
                Post-Exam Diagnostic Analysis
              </h2>
              {resolvedData.performanceInsights.diagnosticSummary && (
                <p className="mt-1.5 text-sm text-[var(--text-muted)] leading-relaxed">
                  {resolvedData.performanceInsights.diagnosticSummary}
                </p>
              )}
            </div>

            {/* Diagnostic Metric Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
                <span className="text-xs font-semibold text-[var(--text-muted)]">
                  Pacing Verdict
                </span>
                <p className="mt-1.5 text-sm sm:text-base font-bold text-[var(--text-main)]">
                  {resolvedData.performanceInsights.pacingVerdict}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {resolvedData.performanceInsights.slowQuestionsCount} slow{' '}
                  {resolvedData.performanceInsights.slowQuestionsCount === 1
                    ? 'question'
                    : 'questions'}{' '}
                  · {resolvedData.performanceInsights.markedUnattemptedCount}{' '}
                  marked unattempted
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
                <span className="text-xs font-semibold text-[var(--text-muted)]">
                  Strongest Section
                </span>
                <p className="mt-1.5 text-sm sm:text-base font-bold text-[var(--text-main)] truncate">
                  {resolvedData.performanceInsights.strongestSectionTitle ||
                    resolvedData.setTitle}
                </p>
                <p className="mt-1 text-xs text-[var(--status-success)] font-semibold">
                  {resolvedData.performanceInsights
                    .strongestSectionAccuracyPct ?? resolvedData.accuracyPct}
                  % accuracy
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
                <span className="text-xs font-semibold text-[var(--text-muted)]">
                  Priority Focus Area
                </span>
                <p className="mt-1.5 text-sm sm:text-base font-bold text-[var(--text-main)] truncate">
                  {resolvedData.performanceInsights.focusSectionTitle ||
                    (resolvedData.totalWrong > 0
                      ? 'Eliminate Negative Guesses'
                      : 'Expand Attempt Coverage')}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {resolvedData.performanceInsights.focusSectionTitle
                    ? `${
                        resolvedData.performanceInsights
                          .focusSectionAccuracyPct ?? 0
                      }% section accuracy`
                    : `${resolvedData.totalUnattempted} unattempted questions`}
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
                <span className="text-xs font-semibold text-[var(--text-muted)]">
                  Negative Marking Impact
                </span>
                <p className="mt-1.5 text-sm sm:text-base font-bold text-[var(--text-main)]">
                  {resolvedData.performanceInsights.negativeMarkingImpactPct}%
                  of gross marks
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  −{resolvedData.negativeMarksLost} lost across{' '}
                  {resolvedData.totalWrong} wrong{' '}
                  {resolvedData.totalWrong === 1 ? 'answer' : 'answers'}
                </p>
              </div>
            </div>

            {/* Actionable Takeaways List */}
            {resolvedData.performanceInsights.actionableTakeaways.length > 0 && (
              <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2.5">
                <h3 className="text-xs font-semibold text-[var(--text-muted)]">
                  Actionable Study Takeaways
                </h3>
                <ol className="space-y-2 text-xs sm:text-sm text-[var(--text-main)] leading-relaxed">
                  {resolvedData.performanceInsights.actionableTakeaways.map(
                    (item, idx) => (
                      <li key={idx} className="flex items-baseline gap-2.5">
                        <span className="font-mono text-xs font-bold text-[var(--text-muted)] shrink-0">
                          {String(idx + 1).padStart(2, '0')}.
                        </span>
                        <span>{item}</span>
                      </li>
                    )
                  )}
                </ol>
              </div>
            )}
          </section>

          {/* Learner Self-Reflection & Feedback Form (Keyed by attemptId for zero-effect reset) */}
          <AttemptFeedbackPanel
            key={selectedAttempt?.attemptId || 'local-session'}
            attempt={selectedAttempt}
            isSignedIn={isSignedIn}
            onSaveFeedback={onSaveFeedback}
          />

          {/* Public Learner Review Invitation */}
          <section
            aria-label="Share a public review"
            className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm sm:text-base font-bold text-[var(--text-main)]">
                Rate &amp; Review {examTitle}
              </h3>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Help fellow candidates by sharing your genuine rating on question difficulty, explanations, and exam relevance.
              </p>
            </div>
            <a
              href={`/exams/${examSlug}#write-review`}
              className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              <Star
                className="w-4 h-4 fill-[var(--status-warning)] text-[var(--status-warning)] shrink-0"
                aria-hidden="true"
              />
              <span>Write a Review</span>
            </a>
          </section>
        </div>
      )}
    </div>
  );
}
