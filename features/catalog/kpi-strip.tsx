'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeStudyAnalytics,
  scanLocalBookReadingProgress,
  type LocalBookReadRecord,
} from '../../lib/analytics/study-analytics';
import type { HistoricalExamAttemptRecord } from '../../lib/exam/types';
import { StudyAnalyticsCards } from '../analytics/study-analytics-cards';
import { useAuth } from '../auth/auth-provider';

const ATTEMPT_HISTORY_KEY_PREFIX = 'ed_cbt_attempt_history_';

function hasStoredAttemptHistory(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(ATTEMPT_HISTORY_KEY_PREFIX)) {
        return true;
      }
    }
  } catch {
    // Ignore storage access errors
  }
  return false;
}

export function KpiStrip() {
  const { user, purchases, isSigningIn, signInWithGoogle, getIdToken } =
    useAuth();
  const activeUid = user?.uid ?? null;
  const getIdTokenRef = useRef(getIdToken);
  useEffect(() => {
    getIdTokenRef.current = getIdToken;
  }, [getIdToken]);

  const [bookReads, setBookReads] = useState<LocalBookReadRecord[]>([]);
  const [attemptState, setAttemptState] = useState<{
    uid: string | null;
    attempts: HistoricalExamAttemptRecord[];
  }>({ uid: null, attempts: [] });

  useEffect(() => {
    const syncBookReads = () => {
      setBookReads(scanLocalBookReadingProgress());
    };
    syncBookReads();
    window.addEventListener('storage', syncBookReads);

    if (!activeUid && !hasStoredAttemptHistory()) {
      return () => {
        window.removeEventListener('storage', syncBookReads);
      };
    }

    let disposed = false;
    let cleanupAttempts: (() => void) | null = null;

    void import('../../lib/exam/storage').then(
      ({
        EXAM_ATTEMPTS_UPDATED_EVENT,
        fetchAndMergeCloudExamAttempts,
        getHistoricalAttemptsSync,
      }) => {
        if (disposed) return;
        const refresh = () => {
          setBookReads(scanLocalBookReadingProgress());
          setAttemptState({
            uid: activeUid,
            attempts: activeUid ? getHistoricalAttemptsSync(activeUid) : [],
          });
        };
        refresh();
        window.addEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, refresh);
        window.addEventListener('storage', refresh);
        cleanupAttempts = () => {
          window.removeEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, refresh);
          window.removeEventListener('storage', refresh);
        };

        if (
          activeUid &&
          (typeof navigator === 'undefined' || navigator.onLine !== false)
        ) {
          void (async () => {
            try {
              const token = await getIdTokenRef.current();
              if (!token || disposed) return;
              const merged = await fetchAndMergeCloudExamAttempts({
                bearerToken: token,
                uid: activeUid,
              });
              if (!disposed) {
                setAttemptState({
                  uid: activeUid,
                  attempts: merged,
                });
              }
            } catch {
              // Keep local attempts if offline
            }
          })();
        }
      }
    );

    return () => {
      disposed = true;
      window.removeEventListener('storage', syncBookReads);
      cleanupAttempts?.();
    };
  }, [activeUid]);

  const activeAttempts = useMemo(
    () => (attemptState.uid === activeUid ? attemptState.attempts : []),
    [activeUid, attemptState]
  );

  const studyAnalytics = useMemo(
    () =>
      computeStudyAnalytics({
        attempts: activeAttempts,
        bookReads,
        purchases,
      }),
    [activeAttempts, bookReads, purchases]
  );

  return (
    <section aria-label="Study workspace summary" className="ed-container pt-4 sm:pt-5 max-md:pt-3">
      {/* Study Analytics Cards with slightly enlarged icons */}
      <StudyAnalyticsCards
        analytics={studyAnalytics}
        iconClassName="w-5 h-5 shrink-0"
        cardPaddingClassName="p-4 sm:p-5 max-md:p-3.5"
      />

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
