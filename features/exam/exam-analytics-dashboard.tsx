'use client';

import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  RotateCcw,
  Target,
  Trophy,
  XCircle,
} from 'lucide-react';
import type {
  ExamQuestion,
  ExamSection,
  ExamSet,
  PersistedExamSession,
} from '../../lib/exam/types';
import {
  computeFullExamAnalytics,
  formatDurationCompact,
} from '../../lib/exam/grading';
import { ExamQuestionWorkspace } from './exam-engine';
import { cn } from '../../lib/utils';

type AnalyticsTab = 'overview' | 'solutions';
type ReviewFilter =
  | 'ALL'
  | 'CORRECT'
  | 'PARTIAL'
  | 'WRONG'
  | 'UNATTEMPTED'
  | 'MARKED';

export function ExamAnalyticsDashboard({
  examTitle,
  examSlug,
  examSet,
  session,
  isOwned,
  onReattempt,
  backHref,
}: {
  examTitle: string;
  examSlug: string;
  examSet: ExamSet;
  session: PersistedExamSession;
  isOwned: boolean;
  onReattempt: () => void;
  backHref: string;
}) {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('ALL');
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>(
    examSet.sections[0]?.questions[0]?.id || ''
  );

  const analytics = useMemo(
    () =>
      computeFullExamAnalytics({
        exam: examSet,
        responses: session.responses,
        telemetry: session.telemetry,
        markedForReview: session.markedForReview,
        fallbackTotalTimeMs: session.totalTimeSpentMs,
      }),
    [examSet, session]
  );

  const flatQuestions = useMemo(() => {
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
      analytics.questionBreakdown.map((item) => [item.questionId, item])
    );
  }, [analytics.questionBreakdown]);

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
      analytics.questionBreakdown.filter((item) => item.markedForReview).length,
    [analytics.questionBreakdown]
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

  return (
    <div className="ed-container py-6 sm:py-8 space-y-6">
      {/* Top Result Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[var(--border-subtle)]">
        <div className="flex items-start sm:items-center gap-3.5 min-w-0">
          <a
            href={backHref}
            aria-label="Back to exam pack"
            className="inline-flex items-center justify-center min-h-12 min-w-12 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </a>
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--text-muted)]">
              {examTitle} ·{' '}
              {session.mode === 'trial'
                ? 'Free Sample Result'
                : 'Official Mock Result'}
            </p>
            <h1 className="mt-0.5 text-xl sm:text-2xl font-extrabold tracking-tight text-[var(--text-main)] truncate">
              {examSet.title}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onReattempt}
            className="inline-flex items-center justify-center gap-2 min-h-12 px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-xs sm:text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            <span>Reattempt Set</span>
          </button>

          {!isOwned ? (
            <a
              href={`/exams/${examSlug}`}
              className="inline-flex items-center justify-center gap-2 min-h-12 px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs sm:text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <span>Unlock Full Exam Pack</span>
            </a>
          ) : (
            <a
              href="/purchased"
              className="inline-flex items-center justify-center gap-2 min-h-12 px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs sm:text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <span>All Unlocked Sets</span>
            </a>
          )}
        </div>
      </div>

      {/* Primary KPI Strip */}
      <section
        aria-label="Exam score summary"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 tabular-nums"
      >
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-muted)]">
            <span>Net Score</span>
            <Trophy className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl sm:text-3xl font-extrabold text-[var(--text-main)]">
            {analytics.evaluation.totalScore}
            <span className="text-base font-semibold text-[var(--text-muted)]">
              {' '}
              / {analytics.evaluation.maxScore}
            </span>
          </p>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            <span className="text-[var(--status-success)] font-semibold">
              +{analytics.positiveMarksEarned}
            </span>{' '}
            earned ·{' '}
            <span className="text-[var(--status-danger)] font-semibold">
              −{analytics.negativeMarksLost}
            </span>{' '}
            negative
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-muted)]">
            <span>Accuracy</span>
            <Target className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl sm:text-3xl font-extrabold text-[var(--text-main)]">
            {analytics.accuracyPct}%
          </p>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            {analytics.totalCorrect} Correct · {analytics.totalPartial} Partial ·{' '}
            {analytics.totalWrong} Wrong
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-muted)]">
            <span>Attempted</span>
            <BarChart3 className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl sm:text-3xl font-extrabold text-[var(--text-main)]">
            {analytics.totalAttempted}
            <span className="text-base font-semibold text-[var(--text-muted)]">
              {' '}
              / {analytics.totalQuestions}
            </span>
          </p>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            {analytics.attemptPct}% attempted · {analytics.totalUnattempted}{' '}
            unattempted
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-muted)]">
            <span>Time Spent</span>
            <Clock className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl sm:text-3xl font-extrabold text-[var(--text-main)]">
            {formatDurationCompact(analytics.totalTimeSpentMs)}
          </p>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            Avg {formatDurationCompact(analytics.avgTimePerAttemptedMs)} /
            attempted Q
          </p>
        </div>
      </section>

      {/* View Switcher Tabs */}
      <div
        role="tablist"
        aria-label="Analytics views"
        className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 tabular-nums"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'overview'}
          onClick={() => setActiveTab('overview')}
          className={cn(
            'min-h-[42px] px-4 rounded-md text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap',
            activeTab === 'overview'
              ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
          )}
        >
          Section & Time Telemetry
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'solutions'}
          onClick={() => setActiveTab('solutions')}
          className={cn(
            'min-h-[42px] px-4 rounded-md text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap',
            activeTab === 'solutions'
              ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
              : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
          )}
        >
          Solution Review ({analytics.totalQuestions})
        </button>
      </div>

      {activeTab === 'overview' ? (
        <div className="space-y-8">
          {/* Section-Wise Breakdown Table */}
          <section aria-labelledby="section-breakdown-heading" className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2
                id="section-breakdown-heading"
                className="text-base sm:text-lg font-bold text-[var(--text-main)]"
              >
                Section-Wise Performance Breakdown
              </h2>
              <span className="text-xs text-[var(--text-muted)] tabular-nums">
                {examSet.sections.length}{' '}
                {examSet.sections.length === 1 ? 'Section' : 'Sections'}
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
                      Accuracy
                    </th>
                    <th scope="col" className="py-3 px-4 text-end">
                      Time Spent
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {analytics.sectionBreakdown.map((sec) => (
                    <tr
                      key={sec.sectionId}
                      className="hover:bg-[var(--bg-elevated)]/40 transition-colors"
                    >
                      <td className="py-3 px-4 font-semibold text-[var(--text-main)]">
                        <div>{sec.sectionTitle}</div>
                        {sec.maxAttempts ? (
                          <div className="text-xs font-normal text-[var(--text-muted)]">
                            Attempt cap: {sec.maxAttempts} of {sec.totalQuestions}
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
                      <td className="py-3 px-4 text-end text-[var(--text-main)] whitespace-nowrap">
                        {sec.accuracyPct}%
                      </td>
                      <td className="py-3 px-4 text-end text-[var(--text-muted)] whitespace-nowrap">
                        {formatDurationCompact(sec.timeSpentMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Per-Question Dwell Time & Revisit Telemetry */}
          <section aria-labelledby="question-telemetry-heading" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2
                id="question-telemetry-heading"
                className="text-base sm:text-lg font-bold text-[var(--text-main)]"
              >
                Question-Wise Time & Revisit Log
              </h2>
              <span className="text-xs text-[var(--text-muted)]">
                Select any row to inspect full step-by-step explanation
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
                      Section & Type
                    </th>
                    <th scope="col" className="py-3 px-4 text-start">
                      Outcome
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
                  {analytics.questionBreakdown.map((q) => (
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
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
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
                            <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Incorrect</span>
                          </span>
                        )}
                        {q.status === 'UNATTEMPTED' && (
                          <span className="text-xs font-medium text-[var(--text-muted)]">
                            {q.ignoredByCap ? 'Ignored (Cap)' : 'Unattempted'}
                          </span>
                        )}
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
                        {q.marksAwarded > 0 ? `+${q.marksAwarded}` : q.marksAwarded}
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
                          className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-md text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
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
      ) : (
        /* Interactive Question-by-Question Solution Review */
        <section aria-label="Question by question solution review" className="space-y-4">
          {/* Filter Controls */}
          <div className="flex flex-wrap items-center gap-2 tabular-nums">
            {(
              [
                { id: 'ALL', label: `All (${analytics.totalQuestions})` },
                { id: 'CORRECT', label: `Correct (${analytics.totalCorrect})` },
                ...(analytics.totalPartial > 0
                  ? [
                      {
                        id: 'PARTIAL' as const,
                        label: `Partial (${analytics.totalPartial})`,
                      },
                    ]
                  : []),
                { id: 'WRONG', label: `Wrong (${analytics.totalWrong})` },
                {
                  id: 'UNATTEMPTED',
                  label: `Unattempted (${analytics.totalUnattempted})`,
                },
                ...(markedCount > 0
                  ? [{ id: 'MARKED' as const, label: `Marked (${markedCount})` }]
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
                    'min-h-[40px] px-3.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap',
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
                    statusCls = 'border-emerald-600 bg-emerald-600 text-white';
                  } else if (meta?.status === 'PARTIAL') {
                    statusCls = 'border-amber-600 bg-amber-600 text-white';
                  } else if (meta?.status === 'WRONG') {
                    statusCls = 'border-rose-600 bg-rose-600 text-white';
                  }

                  return (
                    <button
                      key={question.id}
                      type="button"
                      aria-label={`Review Question ${globalNumber}`}
                      aria-current={isCurrent ? 'step' : undefined}
                      onClick={() => setSelectedQuestionId(question.id)}
                      className={cn(
                        'min-h-[42px] min-w-[42px] px-2.5 rounded-lg border text-xs font-bold transition-transform active:scale-95',
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
                    Time Spent:{' '}
                    <strong className="font-semibold text-[var(--text-main)]">
                      {formatDurationCompact(activeQuestionMeta?.timeSpentMs ?? 0)}
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
                    className="inline-flex items-center gap-1 min-h-[40px] px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] font-semibold text-[var(--text-main)] disabled:opacity-40"
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
                    className="inline-flex items-center gap-1 min-h-[40px] px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] font-semibold text-[var(--text-main)] disabled:opacity-40"
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
                sectionResponses={session.responses}
                onChange={() => {}}
                mode="review"
                showVirtualKeypad={false}
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}
