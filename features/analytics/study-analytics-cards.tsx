'use client';

import React from 'react';
import {
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  Target,
} from 'lucide-react';
import type { StudyAnalyticsSummary } from '../../lib/analytics/study-analytics';
import { cn } from '../../lib/utils';

export interface StudyAnalyticsCardsProps {
  analytics: StudyAnalyticsSummary;
  iconClassName?: string;
  cardPaddingClassName?: string;
  className?: string;
}

export function StudyAnalyticsCards({
  analytics,
  iconClassName = 'w-4 h-4 shrink-0',
  cardPaddingClassName = 'p-4 max-md:p-3.5',
  className,
}: StudyAnalyticsCardsProps) {
  const cardClass = cn(
    'rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]',
    cardPaddingClassName
  );

  return (
    <div
      className={cn(
        'grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 max-md:gap-2.5 tabular-nums',
        className
      )}
    >
      <div className={cardClass}>
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--text-muted)]">
          <span>Books Read</span>
          <BookOpen className={iconClassName} aria-hidden="true" />
        </div>
        <p className="mt-2.5 max-md:mt-2 text-2xl sm:text-3xl max-md:text-xl font-extrabold tracking-tight text-[var(--text-main)]">
          {analytics.booksReadCount}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {analytics.unlockedBooksCount} unlocked in library
        </p>
      </div>

      <div className={cardClass}>
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--text-muted)]">
          <span>Exams Attempted</span>
          <ClipboardCheck className={iconClassName} aria-hidden="true" />
        </div>
        <p className="mt-2.5 max-md:mt-2 text-2xl sm:text-3xl max-md:text-xl font-extrabold tracking-tight text-[var(--text-main)]">
          {analytics.totalExamsAttempted}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {analytics.uniqueSetsAttempted}{' '}
          {analytics.uniqueSetsAttempted === 1 ? 'set' : 'sets'} ·{' '}
          {analytics.unlockedExamsCount} packs owned
        </p>
      </div>

      <div className={cardClass}>
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--text-muted)]">
          <span>Overall Accuracy</span>
          <Target className={iconClassName} aria-hidden="true" />
        </div>
        <p className="mt-2.5 max-md:mt-2 text-2xl sm:text-3xl max-md:text-xl font-extrabold tracking-tight text-[var(--text-main)]">
          {analytics.weightedAccuracyPct !== null
            ? `${analytics.weightedAccuracyPct.toFixed(1)}%`
            : '—'}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {analytics.totalExamsAttempted > 0
            ? `Best score ${analytics.bestScorePct.toFixed(1)}%`
            : 'Complete a mock to measure'}
        </p>
      </div>

      <div className={cardClass}>
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--text-muted)]">
          <span>Last Active &amp; Gap</span>
          <CalendarClock className={iconClassName} aria-hidden="true" />
        </div>
        <p className="mt-2.5 max-md:mt-2 text-lg sm:text-xl max-md:text-base font-extrabold tracking-tight text-[var(--text-main)] leading-snug">
          {analytics.lastActive.headline}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {analytics.lastActive.gapDetail}
        </p>
      </div>
    </div>
  );
}
