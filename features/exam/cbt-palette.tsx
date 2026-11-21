'use client';

import React from 'react';
import { Check, Lock } from 'lucide-react';
import type { CbtPaletteStatus, ExamSection } from '../../lib/exam/types';
import {
  countSectionPaletteStates,
  derivePaletteStatus,
  isQuestionLockedBySectionCap,
} from '../../lib/exam/grading';
import { cn } from '../../lib/utils';

export function getPaletteBadgeStyle(status: CbtPaletteStatus): string {
  switch (status) {
    case 'ANSWERED':
      return 'rounded-t-xl rounded-b-md border-emerald-600 bg-emerald-600 text-white';
    case 'NOT_ANSWERED':
      return 'rounded-b-xl rounded-t-md border-rose-600 bg-rose-600 text-white';
    case 'MARKED_FOR_REVIEW':
      return 'rounded-full border-violet-600 bg-violet-600 text-white';
    case 'ANSWERED_AND_MARKED':
      return 'rounded-full border-violet-600 bg-violet-600 text-white';
    case 'NOT_VISITED':
    default:
      return 'rounded-md border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--text-main)]';
  }
}

export function CbtQuestionPalette({
  section,
  globalOffset,
  activeQuestionId,
  responses,
  visitedQuestions,
  markedForReview,
  onSelectQuestion,
  onOpenSubmitModal,
}: {
  section: ExamSection;
  globalOffset: number;
  activeQuestionId: string;
  responses: Record<string, unknown>;
  visitedQuestions: Record<string, boolean>;
  markedForReview: Record<string, boolean>;
  onSelectQuestion: (questionId: string) => void;
  onOpenSubmitModal: () => void;
}) {
  const counts = countSectionPaletteStates(
    section,
    responses,
    visitedQuestions,
    markedForReview
  );

  return (
    <div className="flex flex-col h-full bg-[var(--bg-surface)] text-[var(--text-main)]">
      {/* TCS iON 5-State Legend with Shape + Color + Label */}
      <div className="p-3.5 border-b border-[var(--border-subtle)] space-y-2 text-xs tabular-nums">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 min-w-6 px-1 items-center justify-center text-[11px] font-bold rounded-t-lg rounded-b-sm bg-emerald-600 text-white">
              {counts.ANSWERED}
            </span>
            <span className="text-[var(--text-muted)]">Answered</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 min-w-6 px-1 items-center justify-center text-[11px] font-bold rounded-b-lg rounded-t-sm bg-rose-600 text-white">
              {counts.NOT_ANSWERED}
            </span>
            <span className="text-[var(--text-muted)]">Not Answered</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 min-w-6 px-1 items-center justify-center text-[11px] font-bold rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--text-main)]">
              {counts.NOT_VISITED}
            </span>
            <span className="text-[var(--text-muted)]">Not Visited</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 min-w-6 px-1 items-center justify-center text-[11px] font-bold rounded-full bg-violet-600 text-white">
              {counts.MARKED_FOR_REVIEW}
            </span>
            <span className="text-[var(--text-muted)]">Marked</span>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-0.5">
          <span className="relative inline-flex h-6 min-w-6 px-1 items-center justify-center text-[11px] font-bold rounded-full bg-violet-600 text-white">
            {counts.ANSWERED_AND_MARKED}
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 text-white">
              <Check className="h-2 w-2 stroke-[3]" aria-hidden="true" />
            </span>
          </span>
          <span className="text-[var(--text-muted)] leading-tight">
            Answered & Marked (Evaluated)
          </span>
        </div>
      </div>

      {/* Section Header */}
      <div className="px-3.5 py-2.5 bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-[var(--text-main)] truncate">
          {section.title}
        </p>
        {section.maxAttempts ? (
          <span className="text-[11px] font-semibold text-[var(--status-warning)] whitespace-nowrap tabular-nums">
            Max {section.maxAttempts}
          </span>
        ) : null}
      </div>

      {/* Question Number Grid (>= 48x48px coarse touch targets) */}
      <div className="flex-1 overflow-y-auto p-3.5">
        <div
          role="navigation"
          aria-label="Question palette"
          className="grid grid-cols-5 gap-2 tabular-nums"
        >
          {(section.questions || []).map((q, idx) => {
            const qNum = globalOffset + idx + 1;
            const status = derivePaletteStatus({
              question: q,
              rawAnswer: responses[q.id],
              isVisited: Boolean(visitedQuestions[q.id]),
              isMarkedForReview: Boolean(markedForReview[q.id]),
            });
            const isActive = q.id === activeQuestionId;
            const capLocked = isQuestionLockedBySectionCap(
              section,
              q.id,
              responses
            );

            return (
              <button
                key={q.id}
                type="button"
                aria-label={`Question ${qNum}, ${status
                  .toLowerCase()
                  .replaceAll('_', ' ')}${capLocked ? ', attempt limit reached' : ''}`}
                aria-current={isActive ? 'step' : undefined}
                onClick={() => onSelectQuestion(q.id)}
                className={cn(
                  'relative inline-flex min-h-12 min-w-12 items-center justify-center border text-xs font-bold transition-transform active:scale-95',
                  getPaletteBadgeStyle(status),
                  isActive &&
                    'ring-2 ring-offset-2 ring-[var(--brand-primary)] ring-offset-[var(--bg-surface)]',
                  capLocked && 'opacity-65'
                )}
              >
                <span>{qNum}</span>
                {status === 'ANSWERED_AND_MARKED' && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white border border-white">
                    <Check className="h-2.5 w-2.5 stroke-[3]" aria-hidden="true" />
                  </span>
                )}
                {capLocked && status === 'NOT_VISITED' && (
                  <Lock
                    className="absolute top-0.5 right-0.5 w-2.5 h-2.5 text-[var(--text-muted)]"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Submit Exam Action */}
      <div className="p-3.5 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <button
          type="button"
          onClick={onOpenSubmitModal}
          className="w-full min-h-12 px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-bold hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          Submit Exam
        </button>
      </div>
    </div>
  );
}
