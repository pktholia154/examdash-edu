'use client';

import React, { useMemo, useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import type { MocktestTitleItem } from '../../lib/types/catalog';

type SortField = 'title' | 'duration' | 'totalQuestions' | 'totalMarks';

export function SyllabusTable({
  items,
  totalMocktest,
  hasSample = true,
}: {
  items: MocktestTitleItem[];
  totalMocktest: number;
  hasSample?: boolean;
}) {
  const [sortField, setSortField] = useState<SortField | 'order'>('order');
  const [ascending, setAscending] = useState(true);

  const firstSampleId = items[0]?.id || '';

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
      <section aria-labelledby="syllabus-heading" className="mt-10 max-md:mt-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4 max-md:mb-3">
        <h2
          id="syllabus-heading"
          className="text-lg max-md:text-base font-bold text-[var(--text-main)]"
        >
          Mock Test Syllabus &amp; Paper Structure
        </h2>
        <span className="text-xs font-medium text-[var(--text-muted)] tabular-nums">
          {totalMocktest} Total Mock {totalMocktest === 1 ? 'Test' : 'Tests'}
          {hasSample ? ' · 1st Test Available as Sample' : ''}
        </span>
      </div>

      {sortedItems.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-transparent p-6 max-md:p-4 text-sm text-[var(--text-muted)]">
          Syllabus paper breakdown will appear here as mock sets are scheduled.
        </div>
      ) : (
        <div className="overflow-x-auto max-w-full rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-transparent">
          <table className="w-full text-start border-collapse text-sm max-md:text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 text-xs max-md:text-[11px] font-semibold text-[var(--text-muted)]">
                <th scope="col" className="py-3 px-4 max-md:py-2 max-md:px-2 text-start">
                  #
                </th>
                <th
                  scope="col"
                  aria-sort={ariaSortFor('title')}
                  className="py-3 px-4 max-md:py-1 max-md:px-2 text-start"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('title')}
                    className="inline-flex items-center gap-1 max-md:min-h-[44px] hover:text-[var(--text-main)] transition-colors whitespace-nowrap"
                  >
                    <span>Mock Test Title</span>
                    <ArrowUpDown className="w-3.5 h-3.5 max-md:w-3 max-md:h-3 shrink-0" aria-hidden="true" />
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={ariaSortFor('duration')}
                  className="py-3 px-4 max-md:py-1 max-md:px-2 text-end"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('duration')}
                    className="inline-flex items-center justify-end gap-1 max-md:min-h-[44px] hover:text-[var(--text-main)] transition-colors whitespace-nowrap ms-auto"
                  >
                    <span>Duration</span>
                    <ArrowUpDown className="w-3.5 h-3.5 max-md:w-3 max-md:h-3 shrink-0" aria-hidden="true" />
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={ariaSortFor('totalQuestions')}
                  className="py-3 px-4 max-md:py-1 max-md:px-2 text-end"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('totalQuestions')}
                    className="inline-flex items-center justify-end gap-1 max-md:min-h-[44px] hover:text-[var(--text-main)] transition-colors whitespace-nowrap ms-auto"
                  >
                    <span className="max-md:hidden">Questions</span>
                    <span className="md:hidden">Qs</span>
                    <ArrowUpDown className="w-3.5 h-3.5 max-md:w-3 max-md:h-3 shrink-0" aria-hidden="true" />
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={ariaSortFor('totalMarks')}
                  className="py-3 px-4 max-md:py-1 max-md:px-2 text-end"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('totalMarks')}
                    className="inline-flex items-center justify-end gap-1 max-md:min-h-[44px] hover:text-[var(--text-main)] transition-colors whitespace-nowrap ms-auto"
                  >
                    <span className="max-md:hidden">Total Marks</span>
                    <span className="md:hidden">Marks</span>
                    <ArrowUpDown className="w-3.5 h-3.5 max-md:w-3 max-md:h-3 shrink-0" aria-hidden="true" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
              {sortedItems.map((mock, idx) => {
                const isFirstSample = mock.id === firstSampleId && hasSample;

                return (
                  <tr
                    key={mock.id}
                    className="hover:bg-[var(--bg-elevated)]/50 transition-colors"
                  >
                    <td className="py-3.5 px-4 max-md:py-2.5 max-md:px-2 font-mono text-xs max-md:text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                      {String(idx + 1).padStart(2, '0')}
                    </td>
                    <td className="py-3.5 px-4 max-md:py-2.5 max-md:px-2 min-w-0">
                      <div className="font-semibold text-[var(--text-main)] leading-snug break-words">
                        {mock.title}
                      </div>
                      {isFirstSample && (
                        <div className="mt-0.5 text-xs max-md:text-[11px] font-medium text-[var(--status-success)]">
                          Sample Preview Set
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 max-md:py-2.5 max-md:px-2 text-end text-[var(--text-muted)] whitespace-nowrap">
                      {mock.duration}<span className="max-md:hidden"> min</span><span className="md:hidden">m</span>
                    </td>
                    <td className="py-3.5 px-4 max-md:py-2.5 max-md:px-2 text-end text-[var(--text-muted)] whitespace-nowrap">
                      {mock.totalQuestions}
                    </td>
                    <td className="py-3.5 px-4 max-md:py-2.5 max-md:px-2 text-end font-medium text-[var(--text-main)] whitespace-nowrap">
                      {mock.totalMarks}
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
