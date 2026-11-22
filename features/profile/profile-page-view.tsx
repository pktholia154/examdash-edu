'use client';

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Activity,
  Award,
  BookOpen,
  CalendarClock,
  Check,
  ClipboardCheck,
  Clock,
  Copy,
  Flame,
  Heart,
  Library,
  LogOut,
  Mail,
  Send,
  Share2,
  Target,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { EmptyState } from '../../components/ui/state-blocks';
import { formatDurationCompact } from '../../lib/exam/grading';
import {
  EXAM_ATTEMPTS_UPDATED_EVENT,
  fetchAndMergeCloudExamAttempts,
  getHistoricalAttemptsSync,
} from '../../lib/exam/storage';
import type { HistoricalExamAttemptRecord } from '../../lib/exam/types';
import { cn } from '../../lib/utils';
import { useAuth } from '../auth/auth-provider';
import { CatalogCard } from '../catalog/catalog-card';
import { useToast } from '../toast/toast-context';
import { useWishlist } from '../wishlist/wishlist-provider';

const subscribeOriginNoop = () => () => {};

export interface ProfileBookRef {
  id: string;
  urlSlug: string;
  title: string;
  type: string;
}

interface LocalBookReadRecord {
  bookId: string;
  format: 'pdf' | 'markdown';
  updatedAt: number;
  progressLabel: string;
}

function scanLocalBookReadingProgress(): LocalBookReadRecord[] {
  if (typeof window === 'undefined') return [];
  const byBook = new Map<string, LocalBookReadRecord>();

  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;

      const isPdf = key.startsWith('ed-pdf-prog-v1:');
      const isMd = key.startsWith('ed-md-prog-v1:');
      if (!isPdf && !isMd) continue;

      const parts = key.split(':');
      const bookId = parts[1];
      if (!bookId) continue;

      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const updatedAt =
        typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
          ? parsed.updatedAt
          : 0;
      if (updatedAt <= 0) continue;

      let progressLabel = 'Started reading';
      if (isPdf && typeof parsed.pageIndex === 'number') {
        progressLabel = `Page ${Math.max(1, Math.floor(parsed.pageIndex) + 1)}`;
      } else if (
        isMd &&
        typeof parsed.blockProgressRatio === 'number' &&
        Number.isFinite(parsed.blockProgressRatio)
      ) {
        const pct = Math.min(
          100,
          Math.max(1, Math.round(parsed.blockProgressRatio * 100))
        );
        progressLabel = `${pct}% read`;
      }

      const prev = byBook.get(bookId);
      if (!prev || updatedAt > prev.updatedAt) {
        byBook.set(bookId, {
          bookId,
          format: isPdf ? 'pdf' : 'markdown',
          updatedAt,
          progressLabel,
        });
      }
    }
  } catch {
    // Ignore storage access restrictions
  }

  return Array.from(byBook.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

function toDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function computeStreakDays(timestampsMs: number[]): number {
  if (timestampsMs.length === 0) return 0;
  const uniqueDays = new Set(timestampsMs.map((ms) => toDayKey(ms)));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let cursor = new Date(today);
  // Allow streak to continue if user was active today or yesterday
  if (!uniqueDays.has(toDayKey(cursor.getTime()))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!uniqueDays.has(toDayKey(cursor.getTime()))) {
      return 0;
    }
  }

  let streak = 0;
  while (uniqueDays.has(toDayKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function formatLastActiveAndGap(lastMs: number | null): {
  headline: string;
  gapDetail: string;
} {
  if (!lastMs || !Number.isFinite(lastMs)) {
    return {
      headline: 'No sessions yet',
      gapDetail: 'Start a book or mock exam to begin tracking',
    };
  }

  const now = Date.now();
  const diffMs = Math.max(0, now - lastMs);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 5) {
    return {
      headline: 'Just now',
      gapDetail: '0-day gap · Active session',
    };
  }
  if (diffHours < 24 && toDayKey(lastMs) === toDayKey(now)) {
    return {
      headline: diffHours < 1 ? `${diffMins}m ago` : `${diffHours}h ago`,
      gapDetail: '0-day gap · Active today',
    };
  }
  if (diffDays <= 1) {
    return {
      headline: 'Yesterday',
      gapDetail: '1-day gap · Keep momentum going',
    };
  }
  if (diffDays < 7) {
    return {
      headline: `${diffDays} days ago`,
      gapDetail: `${diffDays}-day study gap · Resume today`,
    };
  }
  return {
    headline: `${diffDays} days ago`,
    gapDetail: `${diffDays}-day gap · Quick revision recommended`,
  };
}

function formatShortDate(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(ms) || ms <= 0) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(ms));
  } catch {
    return '';
  }
}

export function ProfilePageView({
  booksCatalog = [],
}: {
  booksCatalog?: ProfileBookRef[];
}) {
  const {
    user,
    isAuthReady,
    isSigningIn,
    purchases,
    signInWithGoogle,
    signOutUser,
    getIdToken,
  } = useAuth();
  const { items: wishlistItems, clearWishlist } = useWishlist();
  const { showToast } = useToast();

  const [attempts, setAttempts] = useState<HistoricalExamAttemptRecord[]>([]);
  const [bookReads, setBookReads] = useState<LocalBookReadRecord[]>([]);
  const [copiedAppLink, setCopiedAppLink] = useState(false);
  const [avatarLoadError, setAvatarLoadError] = useState(false);

  const safeGoogleAvatarUrl = useMemo(() => {
    if (!user?.photoURL || avatarLoadError) return null;
    try {
      const parsed = new URL(user.photoURL);
      if (
        parsed.protocol === 'https:' &&
        parsed.hostname.endsWith('.googleusercontent.com')
      ) {
        return user.photoURL;
      }
    } catch {
      return null;
    }
    return null;
  }, [user?.photoURL, avatarLoadError]);

  const getIdTokenRef = useRef(getIdToken);
  useEffect(() => {
    getIdTokenRef.current = getIdToken;
  }, [getIdToken]);

  const userId = user?.uid || null;

  // Hydrate local book reads and local exam attempts
  useEffect(() => {
    const syncLocal = () => {
      setBookReads(scanLocalBookReadingProgress());
      if (userId) {
        setAttempts(getHistoricalAttemptsSync(userId));
      } else {
        setAttempts([]);
      }
    };
    syncLocal();
    window.addEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, syncLocal);
    window.addEventListener('storage', syncLocal);
    return () => {
      window.removeEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, syncLocal);
      window.removeEventListener('storage', syncLocal);
    };
  }, [userId]);

  // Merge cloud exam attempts when signed in & online
  useEffect(() => {
    if (!userId) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    let active = true;
    void (async () => {
      try {
        const token = await getIdTokenRef.current();
        if (!token || !active) return;
        const merged = await fetchAndMergeCloudExamAttempts({
          bearerToken: token,
          uid: userId,
        });
        if (active) {
          setAttempts(merged);
        }
      } catch {
        // Keep local attempts if offline
      }
    })();

    return () => {
      active = false;
    };
  }, [userId]);

  const booksById = useMemo(() => {
    const map = new Map<string, ProfileBookRef>();
    for (const b of booksCatalog) {
      map.set(b.id, b);
      map.set(b.urlSlug, b);
    }
    return map;
  }, [booksCatalog]);

  const analytics = useMemo(() => {
    const unlockedBooksCount = purchases.filter(
      (p) => p.collectionName === 'books'
    ).length;
    const unlockedExamsCount = purchases.filter(
      (p) => p.collectionName === 'ExamPackDocument'
    ).length;

    const totalExamsAttempted = attempts.length;
    const uniqueSetsAttempted = new Set(
      attempts.map((a) => `${a.packId || a.examSlug}::${a.setId}`)
    ).size;

    let totalQuestionsAttempted = 0;
    let totalCorrect = 0;
    let totalTimeMs = 0;
    let bestScorePct = 0;

    const activityTimestamps: number[] = [];

    for (const att of attempts) {
      totalQuestionsAttempted += att.totalAttempted || 0;
      totalCorrect += att.totalCorrect || 0;
      totalTimeMs += att.totalTimeSpentMs || 0;
      if (typeof att.scorePct === 'number' && att.scorePct > bestScorePct) {
        bestScorePct = att.scorePct;
      }
      const ms = Date.parse(att.completedAtIso);
      if (Number.isFinite(ms) && ms > 0) {
        activityTimestamps.push(ms);
      }
    }

    for (const br of bookReads) {
      if (br.updatedAt > 0) {
        activityTimestamps.push(br.updatedAt);
      }
    }

    const weightedAccuracyPct =
      totalQuestionsAttempted > 0
        ? (totalCorrect / totalQuestionsAttempted) * 100
        : totalExamsAttempted > 0
        ? attempts.reduce((sum, a) => sum + (a.accuracyPct || 0), 0) /
          totalExamsAttempted
        : null;

    const lastActiveMs =
      activityTimestamps.length > 0 ? Math.max(...activityTimestamps) : null;
    const uniqueActiveDays = new Set(
      activityTimestamps.map((ms) => toDayKey(ms))
    ).size;
    const currentStreak = computeStreakDays(activityTimestamps);

    return {
      booksReadCount: bookReads.length,
      unlockedBooksCount,
      unlockedExamsCount,
      totalExamsAttempted,
      uniqueSetsAttempted,
      totalQuestionsAttempted,
      weightedAccuracyPct,
      bestScorePct,
      totalTimeMs,
      uniqueActiveDays,
      currentStreak,
      lastActive: formatLastActiveAndGap(lastActiveMs),
    };
  }, [attempts, bookReads, purchases]);

  const userInitials = useMemo(() => {
    const source = user?.displayName || user?.email || 'ED';
    const parts = source.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return source.slice(0, 2).toUpperCase();
  }, [user?.displayName, user?.email]);

  const appShareUrl = useSyncExternalStore(
    subscribeOriginNoop,
    () => window.location.origin,
    () => 'https://exam-dash.com'
  );
  const appShareText =
    'Study with ExamDash — curated ebooks, question banks, and full-length CBT mock exam series.';

  const handleCopyAppLink = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(appShareUrl);
      }
      setCopiedAppLink(true);
      showToast('ExamDash link copied to clipboard', 'success');
      window.setTimeout(() => setCopiedAppLink(false), 2200);
    } catch {
      showToast('Unable to copy link right now', 'danger');
    }
  };

  const handleShareApp = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'ExamDash — Books, Mock Exams & Study Library',
          text: appShareText,
          url: appShareUrl,
        });
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
      }
    }
    await handleCopyAppLink();
  };

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(
    `${appShareText} ${appShareUrl}`
  )}`;
  const twitterHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    appShareText
  )}&url=${encodeURIComponent(appShareUrl)}`;
  const mailHref = `mailto:?subject=${encodeURIComponent(
    'ExamDash — Books & Mock Exams'
  )}&body=${encodeURIComponent(`${appShareText}\n\n${appShareUrl}`)}`;

  return (
    <div className="ed-container py-6 sm:py-8 space-y-8 max-md:py-4 max-md:space-y-6">
      {/* 1. User Profile Identity Card */}
      <section
        aria-labelledby="profile-heading"
        className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6 max-md:p-4"
      >
        {!isAuthReady ? (
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full ed-skeleton shrink-0" />
            <div className="space-y-2 flex-1">
              <div className="h-5 w-44 rounded ed-skeleton" />
              <div className="h-4 w-56 rounded ed-skeleton" />
            </div>
          </div>
        ) : user ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
            <div className="flex items-center gap-4 min-w-0">
              {safeGoogleAvatarUrl ? (
                <Image
                  src={safeGoogleAvatarUrl}
                  alt={user.displayName || 'User profile'}
                  width={64}
                  height={64}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarLoadError(true)}
                  className="w-16 h-16 rounded-full object-cover border border-[var(--border-strong)] shrink-0"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="w-16 h-16 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-strong)] flex items-center justify-center text-lg font-extrabold text-[var(--text-main)] shrink-0"
                >
                  {userInitials}
                </div>
              )}

              <div className="min-w-0">
                <h1
                  id="profile-heading"
                  className="text-xl sm:text-2xl font-extrabold tracking-tight text-[var(--text-main)] truncate"
                >
                  {user.displayName || 'ExamDash Learner'}
                </h1>
                {user.email && (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs sm:text-sm text-[var(--text-muted)] truncate max-w-full">
                    <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{user.email}</span>
                  </p>
                )}
                <p className="mt-1.5 text-xs text-[var(--text-muted)] tabular-nums">
                  {purchases.length}{' '}
                  {purchases.length === 1 ? 'item' : 'items'} unlocked ·{' '}
                  {wishlistItems.length} in wishlist
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0 max-md:w-full max-md:grid max-md:grid-cols-2 max-md:gap-2">
              <Link
                href="/purchased"
                prefetch={false}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
              >
                <Library className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>My Library</span>
              </Link>
              <button
                type="button"
                onClick={() => void signOutUser()}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
              >
                <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-16 h-16 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-strong)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
                <UserIcon className="w-7 h-7" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1
                  id="profile-heading"
                  className="text-xl sm:text-2xl font-extrabold tracking-tight text-[var(--text-main)]"
                >
                  Guest Study Profile
                </h1>
                <p className="mt-1 text-xs sm:text-sm text-[var(--text-muted)]">
                  Sign in with Google to sync your exam analytics, cloud
                  wishlist, and unlocked library across devices.
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={isSigningIn}
              onClick={() => void signInWithGoogle()}
              className="inline-flex items-center justify-center min-h-[48px] px-5 max-md:w-full rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              {isSigningIn ? 'Signing in...' : 'Continue with Google'}
            </button>
          </div>
        )}
      </section>

      {/* 2. Study Analytics Overview */}
      <section aria-labelledby="analytics-heading" className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2
              id="analytics-heading"
              className="text-[length:var(--text-h2)] font-extrabold tracking-tight text-[var(--text-main)]"
            >
              Study Analytics
            </h2>
            <p className="mt-0.5 text-xs sm:text-sm text-[var(--text-muted)]">
              Reading progress, mock exam performance, accuracy, and consistency
            </p>
          </div>
        </div>

        {/* 4 Primary Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 max-md:gap-2.5 tabular-nums">
          <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 max-md:p-3.5">
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--text-muted)]">
              <span>Books Read</span>
              <BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
            </div>
            <p className="mt-2.5 max-md:mt-2 text-2xl sm:text-3xl max-md:text-xl font-extrabold tracking-tight text-[var(--text-main)]">
              {analytics.booksReadCount}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {analytics.unlockedBooksCount} unlocked in library
            </p>
          </div>

          <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 max-md:p-3.5">
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--text-muted)]">
              <span>Exams Attempted</span>
              <ClipboardCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
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

          <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 max-md:p-3.5">
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--text-muted)]">
              <span>Overall Accuracy</span>
              <Target className="w-4 h-4 shrink-0" aria-hidden="true" />
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

          <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 max-md:p-3.5">
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--text-muted)]">
              <span>Last Active &amp; Gap</span>
              <CalendarClock className="w-4 h-4 shrink-0" aria-hidden="true" />
            </div>
            <p className="mt-2.5 max-md:mt-2 text-lg sm:text-xl max-md:text-base font-extrabold tracking-tight text-[var(--text-main)] leading-snug">
              {analytics.lastActive.headline}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {analytics.lastActive.gapDetail}
            </p>
          </div>
        </div>

        {/* Secondary Engagement Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border-subtle)] max-sm:divide-y-0 max-sm:[&>*:nth-child(n+3)]:border-t max-sm:[&>*:nth-child(even)]:border-s max-sm:[&>*]:border-[var(--border-subtle)] rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] tabular-nums">
          <div className="p-3.5 sm:p-4 flex items-center gap-3">
            <Clock
              className="w-4 h-4 text-[var(--text-muted)] shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-[11px] text-[var(--text-muted)]">
                Exam Study Time
              </p>
              <p className="text-sm font-bold text-[var(--text-main)]">
                {analytics.totalTimeMs > 0
                  ? formatDurationCompact(analytics.totalTimeMs)
                  : '0m'}
              </p>
            </div>
          </div>

          <div className="p-3.5 sm:p-4 flex items-center gap-3">
            <Flame
              className="w-4 h-4 text-[var(--status-warning)] shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-[11px] text-[var(--text-muted)]">
                Study Streak
              </p>
              <p className="text-sm font-bold text-[var(--text-main)]">
                {analytics.currentStreak}{' '}
                {analytics.currentStreak === 1 ? 'day' : 'days'}
              </p>
            </div>
          </div>

          <div className="p-3.5 sm:p-4 flex items-center gap-3">
            <Activity
              className="w-4 h-4 text-[var(--text-muted)] shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-[11px] text-[var(--text-muted)]">
                Questions Solved
              </p>
              <p className="text-sm font-bold text-[var(--text-main)]">
                {analytics.totalQuestionsAttempted}
              </p>
            </div>
          </div>

          <div className="p-3.5 sm:p-4 flex items-center gap-3">
            <Award
              className="w-4 h-4 text-[var(--status-success)] shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-[11px] text-[var(--text-muted)]">
                Active Study Days
              </p>
              <p className="text-sm font-bold text-[var(--text-main)]">
                {analytics.uniqueActiveDays}{' '}
                {analytics.uniqueActiveDays === 1 ? 'day' : 'days'}
              </p>
            </div>
          </div>
        </div>

        {/* Recent Study Activity (Exams & Books Read) */}
        {(attempts.length > 0 || bookReads.length > 0) && (
          <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
            <div className="px-4 py-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-[var(--text-main)]">
                Recent Activity
              </h3>
              <Link
                href="/purchased"
                prefetch={false}
                className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] hover:underline underline-offset-4 max-md:min-h-[44px] max-md:inline-flex max-md:items-center"
              >
                Open Library →
              </Link>
            </div>

            {attempts.slice(0, 4).map((att) => (
              <div
                key={att.attemptId}
                className="px-4 py-3 flex items-center justify-between gap-3 text-xs sm:text-sm tabular-nums"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--text-main)] truncate">
                    {att.examTitle} · {att.setTitle}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    Score {att.totalScore}/{att.maxScore} ·{' '}
                    {att.accuracyPct.toFixed(1)}% accuracy ·{' '}
                    {formatShortDate(att.completedAtIso)}
                  </p>
                </div>
                <Link
                  href={`/attempt/${att.examSlug}/${encodeURIComponent(
                    att.setId
                  )}?mode=${att.mode}&view=review&attemptId=${encodeURIComponent(
                    att.attemptId
                  )}`}
                  prefetch={false}
                  className="text-xs font-semibold text-[var(--text-main)] hover:underline underline-offset-4 whitespace-nowrap shrink-0 max-md:min-h-[44px] max-md:inline-flex max-md:items-center"
                >
                  Review →
                </Link>
              </div>
            ))}

            {bookReads.slice(0, 3).map((br) => {
              const matchedBook = booksById.get(br.bookId);
              const title = matchedBook?.title || `Book #${br.bookId}`;
              const href = matchedBook
                ? `/read/${matchedBook.urlSlug}?format=${br.format}`
                : '/purchased';
              return (
                <div
                  key={`${br.bookId}:${br.format}`}
                  className="px-4 py-3 flex items-center justify-between gap-3 text-xs sm:text-sm tabular-nums"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text-main)] truncate">
                      {title}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {br.progressLabel} · {br.format.toUpperCase()} ·{' '}
                      {formatShortDate(br.updatedAt)}
                    </p>
                  </div>
                  <Link
                    href={href}
                    prefetch={false}
                    className="text-xs font-semibold text-[var(--text-main)] hover:underline underline-offset-4 whitespace-nowrap shrink-0 max-md:min-h-[44px] max-md:inline-flex max-md:items-center"
                  >
                    Continue →
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. User Wishlist Section (List View) */}
      <section aria-labelledby="wishlist-heading" className="space-y-4">
        <div className="flex items-end justify-between gap-4 pb-3 border-b border-[var(--border-subtle)]">
          <div>
            <h2
              id="wishlist-heading"
              className="inline-flex items-center gap-2 text-[length:var(--text-h2)] font-extrabold tracking-tight text-[var(--text-main)]"
            >
              <Heart
                className="w-5 h-5 text-[var(--status-wishlist)]"
                aria-hidden="true"
              />
              <span>My Wishlist</span>
              <span className="text-sm font-medium text-[var(--text-muted)] tabular-nums">
                ({wishlistItems.length})
              </span>
            </h2>
            <p className="mt-0.5 text-xs sm:text-sm text-[var(--text-muted)]">
              Books and mock exam packs saved for later review or purchase
            </p>
          </div>

          {wishlistItems.length > 0 && (
            <button
              type="button"
              onClick={clearWishlist}
              className="inline-flex items-center gap-1.5 min-h-[40px] max-md:min-h-[44px] px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--status-danger)] hover:border-[var(--status-danger)] transition-colors whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Clear Wishlist</span>
            </button>
          )}
        </div>

        {wishlistItems.length === 0 ? (
          <EmptyState
            title="Your wishlist is empty"
            description="Tap the heart icon on any book or mock exam thumbnail to bookmark it here."
            actionLabel="Explore Catalog"
            actionHref="/"
          />
        ) : (
          <div className="flex flex-col gap-3">
            {wishlistItems.map((item) => (
              <CatalogCard
                key={item.compositeKey}
                item={item}
                viewMode="list"
              />
            ))}
          </div>
        )}
      </section>

      {/* 4. Share App Section */}
      <section
        aria-labelledby="share-app-heading"
        className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6 max-md:p-4"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 max-md:gap-4">
          <div className="min-w-0">
            <h2
              id="share-app-heading"
              className="text-base sm:text-lg font-extrabold tracking-tight text-[var(--text-main)]"
            >
              Share ExamDash
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-[var(--text-muted)] max-w-xl">
              Invite classmates and study partners to explore curated ebooks,
              question banks, and full-length mock exam packs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0 max-md:w-full max-md:grid max-md:grid-cols-2 max-md:gap-2">
            <button
              type="button"
              onClick={() => void handleShareApp()}
              className="inline-flex items-center justify-center gap-2 min-h-[46px] px-4 max-md:col-span-2 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <Share2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Share App</span>
            </button>

            <button
              type="button"
              onClick={() => void handleCopyAppLink()}
              className="inline-flex items-center justify-center gap-2 min-h-[46px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
            >
              {copiedAppLink ? (
                <>
                  <Check
                    className="w-4 h-4 text-[var(--status-success)] shrink-0"
                    aria-hidden="true"
                  />
                  <span>Link Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Copy Link</span>
                </>
              )}
            </button>

            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'inline-flex items-center justify-center gap-1.5 min-h-[46px] px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap'
              )}
            >
              <Send className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>WhatsApp</span>
            </a>

            <a
              href={twitterHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 min-h-[46px] px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap"
            >
              <span>Share on X</span>
            </a>

            <a
              href={mailHref}
              className="inline-flex items-center justify-center gap-1.5 min-h-[46px] px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap"
            >
              <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Email</span>
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
