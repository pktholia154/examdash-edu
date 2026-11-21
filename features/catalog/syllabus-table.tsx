'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Lock, Play } from 'lucide-react';
import type { MocktestTitleItem } from '../../lib/types/catalog';
import type { CompletedAttemptSummary } from '../../lib/exam/types';
import {
  EXAM_ATTEMPTS_UPDATED_EVENT,
  getCompletedAttemptsSync,
  loadExamSessionSync,
} from '../../lib/exam/storage';
import { makeCompositeKey } from '../../lib/registry/content-type-registry';
import { useAuth } from '../auth/auth-provider';

type SortField = 'title' | 'duration' | 'totalQuestions' | 'totalMarks';

export function SyllabusTable({
  items,
  totalMocktest,
  examSlug,
  examId = '',
  buyPrice = 0,
  hasSample = true,
}: {
  items: MocktestTitleItem[];
  totalMocktest: number;
  examSlug: string;
  examId?: string;
  buyPrice?: number;
  hasSample?: boolean;
}) {
  const { ownedCompositeKeys } = useAuth();
  const [sortField, setSortField] = useState<SortField | 'order'>('order');
  const [ascending, setAscending] = useState(true);
  const [attemptMap, setAttemptMap] = useState<
    Record<string, CompletedAttemptSummary>
  >({});
  const [inProgressIds, setInProgressIds] = useState<Record<string, boolean>>(
    {}
  );

  const isOwned =
    buyPrice === 0 ||
    (Boolean(examId) &&
      ownedCompositeKeys.has(makeCompositeKey('ExamPackDocument', examId)));

  const firstSampleId = items[0]?.id || '';

  useEffect(() => {
    const syncLocalStatus = () => {
      const all = getCompletedAttemptsSync().filter(
        (a) => a.examSlug === examSlug
      );
      const nextMap: Record<string, CompletedAttemptSummary> = {};
      for (const item of all) {
        if (!nextMap[item.setId]) {
          nextMap[item.setId] = item;
        }
      }
      const prog: Record<string, boolean> = {};
      for (const m of items) {
        const fullSess = loadExamSessionSync(examSlug, m.id, 'full');
        const trialSess = loadExamSessionSync(examSlug, m.id, 'trial');
        if (
          fullSess?.status === 'in_progress' ||
          trialSess?.status === 'in_progress'
        ) {
          prog[m.id] = true;
        }
      }
      setAttemptMap(nextMap);
      setInProgressIds(prog);
    };

    syncLocalStatus();
    window.addEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, syncLocalStatus);
    window.addEventListener('storage', syncLocalStatus);
    return () => {
      window.removeEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, syncLocalStatus);
      window.removeEventListener('storage', syncLocalStatus);
    };
  }, [examSlug, items]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setAscending((prev) => !prev);
    } else {
      setSortField(field);
      setAscending(true);
    }
  };

  const sortedItems = useMemo(() => {
    const indexed = items.map((item, idx) => ({ item, idx }));
    if (sortField === 'order') {
      return indexed.map((entry) => entry.item);
    }
    indexed.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'title') {
        cmp = a.item.title.localeCompare(b.item.title);
      } else {
        cmp = a.item[sortField] - b.item[sortField];
      }
      return ascending ? cmp : -cmp;
    });
    return indexed.map((entry) => entry.item);
  }, [ascending, items, sortField]);

  const ariaSortFor = (
    field: SortField
  ): 'ascending' | 'descending' | 'none' => {
    if (sortField !== field) return 'none';
    return ascending ? 'ascending' : 'descending';
  };

  return (
    <section aria-labelledby="syllabus-heading" className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h2
          id="syllabus-heading"
          className="text-lg font-bold text-[var(--text-main)]"
        >
          Mock Test Syllabus &amp; Paper Structure
        </h2>
        <span className="text-xs font-medium text-[var(--text-muted)] tabular-nums">
          {totalMocktest} Total Mock {totalMocktest === 1 ? 'Test' : 'Tests'} ·{' '}
          {isOwned
            ? 'All Sets Unlocked'
            : hasSample
            ? '1st Test Free Sample'
            : `${items.length} Listed Sets`}
        </span>
      </div>

      {sortedItems.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-transparent p-6 text-sm text-[var(--text-muted)]">
          Syllabus paper breakdown will appear here as mock sets are scheduled.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-transparent">
          <table className="w-full text-start border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 text-xs font-semibold text-[var(--text-muted)]">
                <th scope="col" className="py-3 px-4 text-start">
                  ID
                </th>
                <th
                  scope="col"
                  aria-sort={ariaSortFor('title')}
                  className="py-3 px-4 text-start"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('title')}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-main)] transition-colors whitespace-nowrap"
                  >
                    <span>Mock Test Title</span>
                    <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={ariaSortFor('duration')}
                  className="py-3 px-4 text-end"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('duration')}
                    className="inline-flex items-center justify-end gap-1 hover:text-[var(--text-main)] transition-colors whitespace-nowrap ms-auto"
                  >
                    <span>Duration</span>
                    <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={ariaSortFor('totalQuestions')}
                  className="py-3 px-4 text-end"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('totalQuestions')}
                    className="inline-flex items-center justify-end gap-1 hover:text-[var(--text-main)] transition-colors whitespace-nowrap ms-auto"
                  >
                    <span>Questions</span>
                    <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={ariaSortFor('totalMarks')}
                  className="py-3 px-4 text-end"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('totalMarks')}
                    className="inline-flex items-center justify-end gap-1 hover:text-[var(--text-main)] transition-colors whitespace-nowrap ms-auto"
                  >
                    <span>Total Marks</span>
                    <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </th>
                <th scope="col" className="py-3 px-4 text-end">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
              {sortedItems.map((mock) => {
                const isFirstSample = mock.id === firstSampleId && hasSample;
                const canAttempt = isOwned || isFirstSample;
                const lastAttempt = attemptMap[mock.id];
                const isResumable = Boolean(inProgressIds[mock.id]);
                const targetHref = isOwned
                  ? `/attempt/${examSlug}/${encodeURIComponent(mock.id)}`
                  : `/attempt/${examSlug}/${encodeURIComponent(mock.id)}?mode=trial`;

                return (
                  <tr
                    key={mock.id}
                    className="hover:bg-[var(--bg-elevated)]/50 transition-colors"
                  >
                    <td className="py-3.5 px-4 font-mono text-xs text-[var(--text-muted)] whitespace-nowrap">
                      {mock.id}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-[var(--text-main)]">
                        {mock.title}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {isFirstSample && !isOwned ? (
                          <span className="font-semibold text-[var(--status-success)]">
                            Free Sample Test
                          </span>
                        ) : isOwned ? (
                          <span className="text-[var(--status-success)] font-medium">
                            Unlocked in Pack
                          </span>
                        ) : (
                          <span>Included in Full Pack</span>
                        )}
                        {lastAttempt && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="font-medium text-[var(--text-main)]">
                              Last Score: {lastAttempt.totalScore}/
                              {lastAttempt.maxScore} ({lastAttempt.accuracyPct}%)
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-end text-[var(--text-muted)] whitespace-nowrap">
                      {mock.duration} min
                    </td>
                    <td className="py-3.5 px-4 text-end text-[var(--text-muted)] whitespace-nowrap">
                      {mock.totalQuestions}
                    </td>
                    <td className="py-3.5 px-4 text-end font-medium text-[var(--text-main)] whitespace-nowrap">
                      {mock.totalMarks}
                    </td>
                    <td className="py-3.5 px-4 text-end whitespace-nowrap">
                      {canAttempt ? (
                        <a
                          href={targetHref}
                          className="inline-flex items-center justify-end gap-1.5 min-h-[38px] px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>
                            {isResumable
                              ? 'Resume →'
                              : isOwned
                              ? lastAttempt
                                ? 'Review / Retry →'
                                : 'Attempt Set →'
                              : 'Attempt Sample →'}
                          </span>
                        </a>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                          <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Locked · Pack Only</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
