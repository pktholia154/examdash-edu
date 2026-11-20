'use client';

import React, { useMemo, useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import type { MocktestTitleItem } from '../../lib/types/catalog';

type SortField = 'title' | 'duration' | 'totalQuestions' | 'totalMarks';

export function SyllabusTable({
  items,
  totalMocktest,
  examSlug,
}: {
  items: MocktestTitleItem[];
  totalMocktest: number;
  examSlug: string;
}) {
  const [sortField, setSortField] = useState<SortField>('title');
  const [ascending, setAscending] = useState(true);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setAscending((prev) => !prev);
    } else {
      setSortField(field);
      setAscending(true);
    }
  };

  const sortedItems = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'title') {
        cmp = a.title.localeCompare(b.title);
      } else {
        cmp = a[sortField] - b[sortField];
      }
      return ascending ? cmp : -cmp;
    });
    return copy;
  }, [ascending, items, sortField]);

  const ariaSortFor = (field: SortField): 'ascending' | 'descending' | 'none' => {
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
          Mock Test Syllabus & Paper Structure
        </h2>
        <span className="text-xs font-medium text-[var(--text-muted)] tabular-nums">
          {totalMocktest} Total Mock {totalMocktest === 1 ? 'Test' : 'Tests'} ·{' '}
          {items.length} Listed {items.length === 1 ? 'Set' : 'Sets'}
        </span>
      </div>

      {sortedItems.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-transparent p-6 text-sm text-[var(--text-muted)]">
          Syllabus paper breakdown will appear here as mock sets are scheduled.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-transparent">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 text-xs font-semibold text-[var(--text-muted)]">
                <th scope="col" className="py-3 px-4">
                  ID
                </th>
                <th
                  scope="col"
                  aria-sort={ariaSortFor('title')}
                  className="py-3 px-4"
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
                  className="py-3 px-4 text-right"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('duration')}
                    className="inline-flex items-center justify-end gap-1 hover:text-[var(--text-main)] transition-colors whitespace-nowrap ml-auto"
                  >
                    <span>Duration</span>
                    <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={ariaSortFor('totalQuestions')}
                  className="py-3 px-4 text-right"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('totalQuestions')}
                    className="inline-flex items-center justify-end gap-1 hover:text-[var(--text-main)] transition-colors whitespace-nowrap ml-auto"
                  >
                    <span>Questions</span>
                    <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={ariaSortFor('totalMarks')}
                  className="py-3 px-4 text-right"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('totalMarks')}
                    className="inline-flex items-center justify-end gap-1 hover:text-[var(--text-main)] transition-colors whitespace-nowrap ml-auto"
                  >
                    <span>Total Marks</span>
                    <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </th>
                <th scope="col" className="py-3 px-4 text-right">
                  Slot
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
              {sortedItems.map((mock) => (
                <tr
                  key={mock.id}
                  className="hover:bg-[var(--bg-elevated)]/50 transition-colors"
                >
                  <td className="py-3 px-4 font-mono text-xs text-[var(--text-muted)] whitespace-nowrap">
                    {mock.id}
                  </td>
                  <td className="py-3 px-4 font-semibold text-[var(--text-main)]">
                    {mock.title}
                  </td>
                  <td className="py-3 px-4 text-right text-[var(--text-muted)] whitespace-nowrap">
                    {mock.duration} min
                  </td>
                  <td className="py-3 px-4 text-right text-[var(--text-muted)] whitespace-nowrap">
                    {mock.totalQuestions}
                  </td>
                  <td className="py-3 px-4 text-right font-medium text-[var(--text-main)] whitespace-nowrap">
                    {mock.totalMarks}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <a
                      href={`/attempt/${examSlug}?set=${encodeURIComponent(mock.id)}`}
                      className="text-xs font-semibold text-[var(--text-main)] hover:underline underline-offset-4"
                    >
                      Launch →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
