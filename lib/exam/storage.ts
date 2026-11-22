'use client';

import {
  hasOfflineAsset,
  readOfflineAsset,
  readStoredJsonSync,
  saveOfflineAsset,
  writeStoredJsonSync,
} from '../../features/reader/shared/platform-adapter';
import {
  enqueueOfflineVaultMutation,
  listQueuedOfflineMutations,
  removeQueuedOfflineMutation,
} from '../offline/offline-vault';
import { apiUrl } from '../platform/api-base';
import { createUuidV7 } from '../platform/capacitor-bridge';
import { buildHistoricalExamAttemptRecord } from './grading';
import type {
  AttemptFeedbackPatch,
  CompletedAttemptSummary,
  ExamSet,
  HistoricalExamAttemptRecord,
  PersistedExamSession,
} from './types';

const SESSION_PREFIX = 'ed_cbt_session_v1:';
const HISTORY_KEY_PREFIX = 'ed_cbt_attempt_history_v2';
const LEGACY_HISTORY_KEY_PREFIX = 'ed_cbt_attempt_history_v1';
const MUTATION_QUEUE_KEY = 'ed_cbt_offline_queue_v2';
const LEGACY_MUTATION_QUEUE_KEY = 'ed_cbt_offline_queue_v1';
export const EXAM_ATTEMPTS_UPDATED_EVENT = 'ed-exam-attempts-updated';

const inMemoryHistoryByScope = new Map<string, HistoricalExamAttemptRecord[]>();

function normalizeUidScope(uid?: string | null): string {
  const clean = (uid || '').trim();
  return clean ? clean.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) : 'anon';
}

function sessionKey(
  examSlug: string,
  setId: string,
  mode: 'trial' | 'full',
  uid?: string | null
): string {
  const scope = mode === 'trial' ? 'anon' : normalizeUidScope(uid);
  return `${SESSION_PREFIX}${scope}:${examSlug}:${setId}:${mode}`;
}

function legacySessionKey(
  examSlug: string,
  setId: string,
  mode: 'trial' | 'full'
): string {
  return `${SESSION_PREFIX}${examSlug}:${setId}:${mode}`;
}

function historyKey(uid?: string | null): string {
  const scope = normalizeUidScope(uid);
  return scope === 'anon'
    ? HISTORY_KEY_PREFIX
    : `${HISTORY_KEY_PREFIX}:${scope}`;
}

function legacyHistoryKey(uid?: string | null): string {
  const scope = normalizeUidScope(uid);
  return scope === 'anon'
    ? LEGACY_HISTORY_KEY_PREFIX
    : `${LEGACY_HISTORY_KEY_PREFIX}:${scope}`;
}

function mutationQueueKey(uid?: string | null): string {
  const scope = normalizeUidScope(uid);
  return scope === 'anon'
    ? MUTATION_QUEUE_KEY
    : `${MUTATION_QUEUE_KEY}:${scope}`;
}

function packVaultKey(examSlug: string, mode: 'trial' | 'full'): string {
  return `exampack_v1_${examSlug}_${mode}.json`;
}

function notifyExamAttemptsUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EXAM_ATTEMPTS_UPDATED_EVENT));
  }
}

function normalizeAnyAttemptRecord(
  raw: Partial<HistoricalExamAttemptRecord> & Partial<CompletedAttemptSummary>
): HistoricalExamAttemptRecord | null {
  const attemptId = String(raw.attemptId || raw.idempotencyKey || '').trim();
  const setId = String(raw.setId || '').trim();
  if (!attemptId || !setId) return null;

  const totalQuestions = Math.max(1, Number(raw.totalQuestions || 1));
  const totalAttempted = Math.max(0, Number(raw.totalAttempted || 0));
  const totalScore = Number(raw.totalScore || 0);
  const maxScore = Math.max(0, Number(raw.maxScore || 0));
  const accuracyPct = Number(raw.accuracyPct || 0);
  const scorePct =
    typeof raw.scorePct === 'number'
      ? raw.scorePct
      : maxScore > 0
      ? Number(Math.max(0, (totalScore / maxScore) * 100).toFixed(1))
      : 0;
  const attemptPct =
    typeof raw.attemptPct === 'number'
      ? raw.attemptPct
      : Number(((totalAttempted / totalQuestions) * 100).toFixed(1));
  const totalTimeSpentMs = Math.max(0, Math.round(Number(raw.totalTimeSpentMs || 0)));
  const avgTimePerAttemptedMs =
    typeof raw.avgTimePerAttemptedMs === 'number'
      ? Math.round(raw.avgTimePerAttemptedMs)
      : totalAttempted > 0
      ? Math.round(totalTimeSpentMs / totalAttempted)
      : 0;
  const completedAtIso =
    typeof raw.completedAtIso === 'string' && raw.completedAtIso
      ? raw.completedAtIso
      : new Date().toISOString();

  return {
    attemptId,
    idempotencyKey: attemptId,
    ...(raw.userId ? { userId: raw.userId } : {}),
    packId: String(raw.packId || ''),
    examSlug: String(raw.examSlug || ''),
    examTitle: String(raw.examTitle || 'Mock Exam'),
    setId,
    setTitle: String(raw.setTitle || 'Mock Set'),
    mode: raw.mode === 'trial' ? 'trial' : 'full',
    totalScore,
    maxScore,
    scorePct,
    accuracyPct,
    attemptPct,
    totalQuestions,
    totalAttempted,
    totalCorrect: Number(raw.totalCorrect ?? 0),
    totalPartial: Number(raw.totalPartial ?? 0),
    totalWrong: Number(raw.totalWrong ?? 0),
    totalUnattempted: Number(
      raw.totalUnattempted ?? Math.max(0, totalQuestions - totalAttempted)
    ),
    positiveMarksEarned: Number(
      raw.positiveMarksEarned ?? Math.max(0, totalScore)
    ),
    negativeMarksLost: Number(raw.negativeMarksLost ?? 0),
    totalTimeSpentMs,
    avgTimePerAttemptedMs,
    responses:
      raw.responses && typeof raw.responses === 'object' ? raw.responses : {},
    telemetry:
      raw.telemetry && typeof raw.telemetry === 'object' ? raw.telemetry : {},
    markedForReview:
      raw.markedForReview && typeof raw.markedForReview === 'object'
        ? raw.markedForReview
        : {},
    sectionBreakdown: Array.isArray(raw.sectionBreakdown)
      ? raw.sectionBreakdown
      : [],
    questionBreakdown: Array.isArray(raw.questionBreakdown)
      ? raw.questionBreakdown
      : [],
    performanceInsights:
      raw.performanceInsights && typeof raw.performanceInsights === 'object'
        ? raw.performanceInsights
        : {
            pacingVerdict: 'Recorded Attempt',
            negativeMarkingImpactPct: 0,
            slowQuestionsCount: 0,
            markedUnattemptedCount: 0,
            diagnosticSummary: `Scored ${totalScore} / ${maxScore} (${accuracyPct}% accuracy) across ${totalAttempted} of ${totalQuestions} questions.`,
            actionableTakeaways: [
              'Open Solution Review to inspect question-by-question explanations.',
            ],
          },
    ...(raw.perceivedDifficulty
      ? { perceivedDifficulty: raw.perceivedDifficulty }
      : {}),
    ...(raw.pacingFeedback ? { pacingFeedback: raw.pacingFeedback } : {}),
    ...(typeof raw.reflectionNote === 'string' && raw.reflectionNote
      ? { reflectionNote: raw.reflectionNote }
      : {}),
    startedAtIso: String(raw.startedAtIso || completedAtIso),
    completedAtIso,
    updatedAtIso: String(raw.updatedAtIso || completedAtIso),
    synced: Boolean(raw.synced),
  };
}

function sortAndDedupeAttempts(
  items: HistoricalExamAttemptRecord[]
): HistoricalExamAttemptRecord[] {
  const byId = new Map<string, HistoricalExamAttemptRecord>();
  for (const item of items) {
    const id = item.attemptId || item.idempotencyKey;
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, item);
    } else {
      // Prefer synced record or richer record with questionBreakdown & latest updatedAtIso
      const prevHasBreakdown = prev.questionBreakdown.length > 0;
      const itemHasBreakdown = item.questionBreakdown.length > 0;
      const itemNewer =
        new Date(item.updatedAtIso).getTime() >=
        new Date(prev.updatedAtIso).getTime();
      if (
        (item.synced && !prev.synced) ||
        (itemHasBreakdown && !prevHasBreakdown) ||
        (item.synced === prev.synced && itemNewer)
      ) {
        byId.set(id, {
          ...prev,
          ...item,
          synced: Boolean(prev.synced || item.synced),
        });
      }
    }
  }
  const list = Array.from(byId.values());
  list.sort(
    (a, b) =>
      new Date(b.completedAtIso).getTime() -
      new Date(a.completedAtIso).getTime()
  );
  return list;
}

function persistScopedHistorySafely(
  uid: string | null | undefined,
  records: HistoricalExamAttemptRecord[]
): HistoricalExamAttemptRecord[] {
  const sorted = sortAndDedupeAttempts(records).slice(0, 200);
  const scope = normalizeUidScope(uid);
  inMemoryHistoryByScope.set(scope, sorted);

  const key = historyKey(uid);
  // Quota-safe bounded local storage persistence (full telemetry + responses for recent 35 attempts)
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(key, JSON.stringify(sorted.slice(0, 35)));
    } catch {
      try {
        localStorage.setItem(key, JSON.stringify(sorted.slice(0, 12)));
      } catch {
        // Ignore browser storage quota pressure; inMemoryHistoryByScope + Firestore hold full set
      }
    }
  }
  return sorted;
}

/* ==========================================================================
   1. Instant Deterministic CBT Session Persistence (Survives Refresh / Crash)
   ========================================================================== */

export function loadExamSessionSync(
  examSlug: string,
  setId: string,
  mode: 'trial' | 'full',
  uid?: string | null
): PersistedExamSession | null {
  const scoped = readStoredJsonSync<PersistedExamSession>(
    sessionKey(examSlug, setId, mode, uid)
  );
  if (scoped && scoped.schemaVersion === 1 && scoped.setId === setId) {
    return scoped;
  }
  const legacy = readStoredJsonSync<PersistedExamSession>(
    legacySessionKey(examSlug, setId, mode)
  );
  if (legacy && legacy.schemaVersion === 1 && legacy.setId === setId) {
    return legacy;
  }
  return null;
}

export function saveExamSessionSync(
  session: PersistedExamSession,
  uid?: string | null
): void {
  writeStoredJsonSync(
    sessionKey(session.examSlug, session.setId, session.mode, uid),
    session
  );
}

export function clearExamSessionSync(
  examSlug: string,
  setId: string,
  mode: 'trial' | 'full',
  uid?: string | null
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(sessionKey(examSlug, setId, mode, uid));
    localStorage.removeItem(legacySessionKey(examSlug, setId, mode));
  } catch {
    // Ignore storage errors
  }
  notifyExamAttemptsUpdated();
}

/**
 * Purges UID-scoped in-progress CBT sessions & cached attempt records on Sign-Out.
 */
export function purgeUserExamLocalState(uid: string): void {
  if (typeof window === 'undefined' || !uid) return;
  const scope = normalizeUidScope(uid);
  inMemoryHistoryByScope.delete(scope);
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (
        k.startsWith(`${SESSION_PREFIX}${scope}:`) ||
        k === historyKey(uid) ||
        k === legacyHistoryKey(uid) ||
        k === mutationQueueKey(uid)
      ) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      localStorage.removeItem(k);
    }
  } catch {
    // Ignore
  }
  notifyExamAttemptsUpdated();
}

/* ==========================================================================
   2. Eviction-Proof Offline Sample Pack Vault (Web OPFS / Capacitor NoCloud)
   ========================================================================== */

export async function cacheExamPackOffline(
  examSlug: string,
  mode: 'trial' | 'full',
  sets: ExamSet[]
): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    !Array.isArray(sets) ||
    sets.length === 0
  ) {
    return false;
  }
  try {
    const encoded = new TextEncoder().encode(JSON.stringify(sets));
    return await saveOfflineAsset(
      packVaultKey(examSlug, mode),
      encoded.buffer
    );
  } catch {
    return false;
  }
}

export async function readCachedExamPackOffline(
  examSlug: string,
  mode: 'trial' | 'full'
): Promise<ExamSet[] | null> {
  const buf = await readOfflineAsset(packVaultKey(examSlug, mode));
  if (!buf) return null;
  try {
    const json = new TextDecoder('utf-8').decode(buf);
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as ExamSet[]) : null;
  } catch {
    return null;
  }
}

export async function isExamPackCachedOffline(
  examSlug: string,
  mode: 'trial' | 'full'
): Promise<boolean> {
  return hasOfflineAsset(packVaultKey(examSlug, mode));
}

/* ==========================================================================
   3. Full Historical Exam Attempts + Firebase Firestore Sync Engine
   ========================================================================== */

export function getHistoricalAttemptsSync(
  uid?: string | null
): HistoricalExamAttemptRecord[] {
  const scope = normalizeUidScope(uid);
  const cachedMem = inMemoryHistoryByScope.get(scope);
  if (cachedMem) return cachedMem;

  const collected: HistoricalExamAttemptRecord[] = [];

  const v2Scoped = readStoredJsonSync<unknown[]>(historyKey(uid));
  if (Array.isArray(v2Scoped)) {
    for (const item of v2Scoped) {
      if (item && typeof item === 'object') {
        const norm = normalizeAnyAttemptRecord(
          item as Partial<HistoricalExamAttemptRecord>
        );
        if (norm) collected.push(norm);
      }
    }
  }

  const v1Scoped = readStoredJsonSync<unknown[]>(legacyHistoryKey(uid));
  if (Array.isArray(v1Scoped)) {
    for (const item of v1Scoped) {
      if (item && typeof item === 'object') {
        const norm = normalizeAnyAttemptRecord(
          item as Partial<CompletedAttemptSummary>
        );
        if (norm) collected.push(norm);
      }
    }
  }

  const deduped = sortAndDedupeAttempts(collected);
  inMemoryHistoryByScope.set(scope, deduped);
  return deduped;
}

export function getHistoricalAttemptsForSetSync(params: {
  examSlug: string;
  setId: string;
  uid?: string | null;
  packId?: string | null;
}): HistoricalExamAttemptRecord[] {
  const all = getHistoricalAttemptsSync(params.uid);
  return all.filter(
    (att) =>
      att.setId === params.setId &&
      (att.examSlug === params.examSlug ||
        (Boolean(params.packId) && att.packId === params.packId))
  );
}

export function getCompletedAttemptsSync(
  uid?: string | null
): CompletedAttemptSummary[] {
  return getHistoricalAttemptsSync(uid);
}

export function getLatestAttemptForSetSync(
  examSlug: string,
  setId: string,
  uid?: string | null,
  packId?: string | null
): HistoricalExamAttemptRecord | null {
  const matches = getHistoricalAttemptsForSetSync({
    examSlug,
    setId,
    uid,
    packId,
  });
  return matches[0] ?? null;
}

export function recordHistoricalAttemptSync(params: {
  packId: string;
  examSlug: string;
  examTitle: string;
  examSet: ExamSet;
  session: PersistedExamSession;
  uid?: string | null;
}): HistoricalExamAttemptRecord {
  const attemptId = createUuidV7();
  const entry = buildHistoricalExamAttemptRecord({
    attemptId,
    userId: params.uid || undefined,
    packId: params.packId,
    examSlug: params.examSlug,
    examTitle: params.examTitle,
    examSet: params.examSet,
    session: params.session,
    completedAtEpochMs: params.session.submittedAtEpochMs || Date.now(),
  });

  // Preserve ALL historical attempts (Attempt #1, Attempt #2, ...); deduplicate strictly by attemptId
  const existing = getHistoricalAttemptsSync(params.uid);
  persistScopedHistorySafely(params.uid, [entry, ...existing]);

  // Enqueue in scoped local queue + eviction-proof IndexedDB/SQLite offline mutation queue
  const qKey = mutationQueueKey(params.uid);
  const currentQueue =
    readStoredJsonSync<HistoricalExamAttemptRecord[]>(qKey) || [];
  const safeQueue = Array.isArray(currentQueue) ? currentQueue : [];
  writeStoredJsonSync(qKey, [...safeQueue, entry].slice(-50));

  void enqueueOfflineVaultMutation({
    idempotencyKey: entry.attemptId,
    uid: params.uid || 'anon',
    schemaVersion: 2,
    endpoint: '/api/v1/exams/attempts',
    payloadJson: JSON.stringify(entry),
    createdAt: Date.now(),
  });

  notifyExamAttemptsUpdated();
  return entry;
}

export function recordCompletedAttemptSync(
  input: Omit<CompletedAttemptSummary, 'idempotencyKey' | 'synced'>,
  uid?: string | null
): CompletedAttemptSummary {
  const attemptId = createUuidV7();
  const normalized = normalizeAnyAttemptRecord({
    ...input,
    attemptId,
    idempotencyKey: attemptId,
    synced: false,
  });
  if (!normalized) {
    throw new Error('Invalid completed attempt input.');
  }

  const existing = getHistoricalAttemptsSync(uid);
  persistScopedHistorySafely(uid, [normalized, ...existing]);

  const qKey = mutationQueueKey(uid);
  const currentQueue =
    readStoredJsonSync<HistoricalExamAttemptRecord[]>(qKey) || [];
  const safeQueue = Array.isArray(currentQueue) ? currentQueue : [];
  writeStoredJsonSync(qKey, [...safeQueue, normalized].slice(-50));

  void enqueueOfflineVaultMutation({
    idempotencyKey: normalized.attemptId,
    uid: uid || 'anon',
    schemaVersion: 2,
    endpoint: '/api/v1/exams/attempts',
    payloadJson: JSON.stringify(normalized),
    createdAt: Date.now(),
  });

  notifyExamAttemptsUpdated();
  return normalized;
}

export async function flushOfflineAttemptQueue(
  bearerToken?: string | null,
  uid?: string | null
): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  // Wait until verified Bearer token is ready when flushing a signed-in user's attempts to Firebase
  if (uid && !bearerToken) return;

  const qKey = mutationQueueKey(uid);
  const localQueue =
    readStoredJsonSync<HistoricalExamAttemptRecord[]>(qKey) || [];
  const legacyQueue = !uid
    ? readStoredJsonSync<CompletedAttemptSummary[]>(LEGACY_MUTATION_QUEUE_KEY) ||
      []
    : [];
  const vaultQueue = await listQueuedOfflineMutations(uid || undefined);

  const byKey = new Map<string, HistoricalExamAttemptRecord>();

  if (Array.isArray(localQueue)) {
    for (const item of localQueue) {
      const norm = item ? normalizeAnyAttemptRecord(item) : null;
      if (norm) byKey.set(norm.attemptId, norm);
    }
  }
  if (Array.isArray(legacyQueue)) {
    for (const item of legacyQueue) {
      const norm = item ? normalizeAnyAttemptRecord(item) : null;
      if (norm && !byKey.has(norm.attemptId)) byKey.set(norm.attemptId, norm);
    }
  }
  for (const row of vaultQueue) {
    if (!byKey.has(row.idempotencyKey)) {
      try {
        const parsed = JSON.parse(
          row.payloadJson
        ) as Partial<HistoricalExamAttemptRecord>;
        const norm = normalizeAnyAttemptRecord(parsed);
        if (norm) {
          byKey.set(row.idempotencyKey, norm);
        } else {
          await removeQueuedOfflineMutation(row.idempotencyKey);
        }
      } catch {
        await removeQueuedOfflineMutation(row.idempotencyKey);
      }
    }
  }

  if (byKey.size === 0) return;

  const remaining: HistoricalExamAttemptRecord[] = [];
  const confirmedAttempts: HistoricalExamAttemptRecord[] = [];
  const syncedKeys = new Set<string>();

  for (const [idemKey, item] of byKey.entries()) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Idempotency-Key': idemKey,
      };
      if (bearerToken) {
        headers.Authorization = `Bearer ${bearerToken}`;
      }
      const res = await fetch(apiUrl('/api/v1/exams/attempts'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...item, schemaVersion: 2 }),
      });
      if (res.ok) {
        const bodyJson = (await res.json().catch(() => ({}))) as {
          persistedInFirebase?: boolean;
          attempt?: HistoricalExamAttemptRecord;
        };
        if (uid && bodyJson.persistedInFirebase === false) {
          remaining.push(item);
          continue;
        }
        syncedKeys.add(idemKey);
        if (bodyJson.attempt) {
          confirmedAttempts.push({ ...bodyJson.attempt, synced: true });
        }
        await removeQueuedOfflineMutation(idemKey);
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  writeStoredJsonSync(qKey, remaining);
  if (!uid) {
    writeStoredJsonSync(LEGACY_MUTATION_QUEUE_KEY, []);
  }

  if (syncedKeys.size > 0) {
    const existing = getHistoricalAttemptsSync(uid).map((h) =>
      syncedKeys.has(h.attemptId) ? { ...h, synced: true } : h
    );
    persistScopedHistorySafely(uid, [...confirmedAttempts, ...existing]);
    notifyExamAttemptsUpdated();
  }
}

export async function fetchAndMergeCloudExamAttempts(params: {
  bearerToken: string;
  uid: string;
  packId?: string;
  examSlug?: string;
  setId?: string;
}): Promise<HistoricalExamAttemptRecord[]> {
  if (
    typeof window === 'undefined' ||
    !params.uid ||
    !params.bearerToken ||
    !navigator.onLine
  ) {
    return getHistoricalAttemptsSync(params.uid);
  }

  await flushOfflineAttemptQueue(params.bearerToken, params.uid);

  const search = new URLSearchParams();
  if (params.packId) search.set('packId', params.packId);
  if (params.examSlug) search.set('examSlug', params.examSlug);
  if (params.setId) search.set('setId', params.setId);
  const qs = search.toString();

  try {
    const res = await fetch(
      apiUrl(`/api/v1/exams/attempts${qs ? `?${qs}` : ''}`),
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.bearerToken}`,
        },
        cache: 'no-store',
      }
    );
    if (!res.ok) {
      return getHistoricalAttemptsSync(params.uid);
    }
    const json = (await res.json()) as {
      attempts?: HistoricalExamAttemptRecord[];
    };
    const cloudList = Array.isArray(json.attempts)
      ? json.attempts
          .map((item) => normalizeAnyAttemptRecord({ ...item, synced: true }))
          .filter((x): x is HistoricalExamAttemptRecord => Boolean(x))
      : [];

    const localList = getHistoricalAttemptsSync(params.uid);
    const merged = persistScopedHistorySafely(params.uid, [
      ...cloudList,
      ...localList,
    ]);
    notifyExamAttemptsUpdated();
    return merged;
  } catch {
    return getHistoricalAttemptsSync(params.uid);
  }
}

export async function saveHistoricalAttemptFeedback(params: {
  attemptId: string;
  patch: AttemptFeedbackPatch;
  bearerToken?: string | null;
  uid?: string | null;
}): Promise<HistoricalExamAttemptRecord | null> {
  const existing = getHistoricalAttemptsSync(params.uid);
  const target = existing.find((a) => a.attemptId === params.attemptId);
  const nowIso = new Date().toISOString();

  let optimistic: HistoricalExamAttemptRecord | null = null;
  if (target) {
    optimistic = {
      ...target,
      updatedAtIso: nowIso,
    };
    if (params.patch.perceivedDifficulty !== undefined) {
      if (params.patch.perceivedDifficulty) {
        optimistic.perceivedDifficulty = params.patch.perceivedDifficulty;
      } else {
        delete optimistic.perceivedDifficulty;
      }
    }
    if (params.patch.pacingFeedback !== undefined) {
      if (params.patch.pacingFeedback) {
        optimistic.pacingFeedback = params.patch.pacingFeedback;
      } else {
        delete optimistic.pacingFeedback;
      }
    }
    if (params.patch.reflectionNote !== undefined) {
      const trimmed = (params.patch.reflectionNote ?? '').trim().slice(0, 2000);
      if (trimmed) {
        optimistic.reflectionNote = trimmed;
      } else {
        delete optimistic.reflectionNote;
      }
    }

    persistScopedHistorySafely(
      params.uid,
      existing.map((a) => (a.attemptId === params.attemptId ? optimistic! : a))
    );
    notifyExamAttemptsUpdated();
  }

  if (
    params.uid &&
    params.bearerToken &&
    typeof navigator !== 'undefined' &&
    navigator.onLine
  ) {
    const res = await fetch(apiUrl('/api/v1/exams/attempts'), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.bearerToken}`,
      },
      body: JSON.stringify({
        attemptId: params.attemptId,
        ...params.patch,
      }),
    });

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(
        errJson.error || 'Failed to save feedback to Firebase.'
      );
    }

    const data = (await res.json()) as { attempt?: HistoricalExamAttemptRecord };
    if (data.attempt) {
      const norm = normalizeAnyAttemptRecord({ ...data.attempt, synced: true });
      if (norm) {
        const latest = getHistoricalAttemptsSync(params.uid);
        persistScopedHistorySafely(params.uid, [
          norm,
          ...latest.filter((a) => a.attemptId !== norm.attemptId),
        ]);
        notifyExamAttemptsUpdated();
        return norm;
      }
    }
  }

  return optimistic;
}
