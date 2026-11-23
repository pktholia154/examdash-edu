import type { HistoricalExamAttemptRecord } from '../exam/types';
import type { UserPurchaseRecord } from '../types/catalog';

export interface LocalBookReadRecord {
  bookId: string;
  format: 'pdf' | 'markdown';
  updatedAt: number;
  progressLabel: string;
}

export interface StudyAnalyticsSummary {
  booksReadCount: number;
  unlockedBooksCount: number;
  unlockedExamsCount: number;
  totalExamsAttempted: number;
  uniqueSetsAttempted: number;
  totalQuestionsAttempted: number;
  weightedAccuracyPct: number | null;
  bestScorePct: number;
  totalTimeMs: number;
  uniqueActiveDays: number;
  currentStreak: number;
  lastActive: {
    headline: string;
    gapDetail: string;
  };
}

export function scanLocalBookReadingProgress(): LocalBookReadRecord[] {
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

export function toDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function computeStreakDays(timestampsMs: number[]): number {
  if (timestampsMs.length === 0) return 0;
  const uniqueDays = new Set(timestampsMs.map((ms) => toDayKey(ms)));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const cursor = new Date(today);
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

export function formatLastActiveAndGap(lastMs: number | null): {
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

export function formatShortDate(isoOrMs: string | number): string {
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

export function computeStudyAnalytics(params: {
  attempts: HistoricalExamAttemptRecord[];
  bookReads: LocalBookReadRecord[];
  purchases: UserPurchaseRecord[];
}): StudyAnalyticsSummary {
  const { attempts, bookReads, purchases } = params;

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
}
