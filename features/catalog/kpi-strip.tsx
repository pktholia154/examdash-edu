'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/auth-provider';
import { formatPrice } from '../../lib/registry/content-type-registry';
import {
  EXAM_ATTEMPTS_UPDATED_EVENT,
  getCompletedAttemptsSync,
} from '../../lib/exam/storage';

export interface KpiStripProps {
  totalCatalogBooks: number;
  totalCatalogExams: number;
  totalCatalogMocks: number;
  catalogPotentialSavings: number;
  primaryCurrency: string;
}

export function KpiStrip({
  totalCatalogBooks,
  totalCatalogExams,
  totalCatalogMocks,
  catalogPotentialSavings,
  primaryCurrency,
}: KpiStripProps) {
  const { user, purchases, isSigningIn, signInWithGoogle } = useAuth();
  const [completedCount, setCompletedCount] = useState(0);

  useEffect(() => {
    const refresh = () => setCompletedCount(getCompletedAttemptsSync().length);
    refresh();
    window.addEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const metrics = useMemo(() => {
    const ownedBooks = purchases.filter((p) => p.collectionName === 'books').length;
    const ownedExams = purchases.filter(
      (p) => p.collectionName === 'ExamPackDocument'
    ).length;
    const ownedMocks = purchases.reduce(
      (acc, p) => acc + (p.totalMocktest ?? 0),
      0
    );
    const savedAmount = purchases.reduce(
      (acc, p) => acc + Math.max(0, p.listPrice - p.paidPrice),
      0
    );
    const currency = purchases[0]?.currency || primaryCurrency || 'INR';

    return {
      ownedBooks,
      ownedExams,
      ownedMocks,
      savedAmount,
      currency,
    };
  }, [primaryCurrency, purchases]);

  return (
    <section aria-label="Study workspace summary" className="ed-container pt-4 sm:pt-5 max-md:pt-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 max-md:gap-2.5">
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5 max-md:p-3.5">
          <p className="text-xs font-medium text-[var(--text-muted)]">
            Purchased Books
          </p>
          <p className="mt-1.5 text-2xl max-md:text-xl font-extrabold text-[var(--text-main)] tabular-nums">
            {user ? metrics.ownedBooks : 0}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)] tabular-nums">
            {totalCatalogBooks} published in catalog
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5 max-md:p-3.5">
          <p className="text-xs font-medium text-[var(--text-muted)]">
            Purchased Exams
          </p>
          <p className="mt-1.5 text-2xl max-md:text-xl font-extrabold text-[var(--text-main)] tabular-nums">
            {user ? metrics.ownedExams : 0}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)] tabular-nums">
            {totalCatalogExams} exam series live
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5 max-md:p-3.5">
          <p className="text-xs font-medium text-[var(--text-muted)]">
            Mock Tests Available
          </p>
          <p className="mt-1.5 text-2xl max-md:text-xl font-extrabold text-[var(--text-main)] tabular-nums">
            {user && metrics.ownedMocks > 0 ? metrics.ownedMocks : totalCatalogMocks}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)] tabular-nums">
            {user
              ? `${metrics.ownedMocks} unlocked${
                  completedCount > 0 ? ` · ${completedCount} attempted` : ''
                }`
              : `${totalCatalogMocks} sets${
                  completedCount > 0 ? ` · ${completedCount} attempted` : ''
                }`}
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5 max-md:p-3.5">
          <p className="text-xs font-medium text-[var(--text-muted)]">
            Total Savings
          </p>
          <p className="mt-1.5 text-2xl max-md:text-xl font-extrabold text-[var(--status-success)] tabular-nums">
            {formatPrice(
              user ? metrics.savedAmount : catalogPotentialSavings,
              metrics.currency
            )}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {user ? 'Saved across your purchases' : 'Bundle savings across catalog'}
          </p>
        </div>
      </div>

      {!user && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5 text-xs text-[var(--text-muted)] max-md:px-3.5 max-md:py-3 max-md:gap-2.5">
          <span>
            Sign in with Google to sync your purchased books, mock exam entitlements, and shopping cart across devices.
          </span>
          <button
            type="button"
            disabled={isSigningIn}
            onClick={() => void signInWithGoogle()}
            className="min-h-[36px] px-3 rounded-md font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0 max-md:min-h-[44px] max-md:w-full max-md:inline-flex max-md:items-center max-md:justify-center max-md:border max-md:border-[var(--border-subtle)] max-md:bg-[var(--bg-canvas)]"
          >
            {isSigningIn ? 'Connecting...' : 'Sign in with Google →'}
          </button>
        </div>
      )}
    </section>
  );
}
