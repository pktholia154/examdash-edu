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
import type {
  CompletedAttemptSummary,
  ExamSet,
  PersistedExamSession,
} from './types';

const SESSION_PREFIX = 'ed_cbt_session_v1:';
const HISTORY_KEY_PREFIX = 'ed_cbt_attempt_history_v1';
const MUTATION_QUEUE_KEY = 'ed_cbt_offline_queue_v1';
export const EXAM_ATTEMPTS_UPDATED_EVENT = 'ed-exam-attempts-updated';

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

function packVaultKey(examSlug: string, mode: 'trial' | 'full'): string {
  return `exampack_v1_${examSlug}_${mode}.json`;
}

function notifyExamAttemptsUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EXAM_ATTEMPTS_UPDATED_EVENT));
  }
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
 * Purges UID-scoped in-progress CBT sessions & attempt summaries on Sign-Out.
 */
export function purgeUserExamLocalState(uid: string): void {
  if (typeof window === 'undefined' || !uid) return;
  const scope = normalizeUidScope(uid);
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (
        k.startsWith(`${SESSION_PREFIX}${scope}:`) ||
        k === historyKey(uid)
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
  if (typeof window === 'undefined' || !Array.isArray(sets) || sets.length === 0) {
    return false;
  }
  try {
    const encoded = new TextEncoder().encode(JSON.stringify(sets));
    return await saveOfflineAsset(packVaultKey(examSlug, mode), encoded.buffer);
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
   3. Completed Attempt Summaries + Pillar 4 SQLite/IDB UUIDv7 Sync Queue
   ========================================================================== */

export function getCompletedAttemptsSync(
  uid?: string | null
): CompletedAttemptSummary[] {
  const scoped = readStoredJsonSync<CompletedAttemptSummary[]>(historyKey(uid));
  if (Array.isArray(scoped)) return scoped;
  if (uid) {
    const fallback = readStoredJsonSync<CompletedAttemptSummary[]>(
      HISTORY_KEY_PREFIX
    );
    return Array.isArray(fallback) ? fallback : [];
  }
  return [];
}

export function getLatestAttemptForSetSync(
  examSlug: string,
  setId: string,
  uid?: string | null
): CompletedAttemptSummary | null {
  const all = getCompletedAttemptsSync(uid);
  return (
    all.find((a) => a.examSlug === examSlug && a.setId === setId) ?? null
  );
}

export function recordCompletedAttemptSync(
  input: Omit<CompletedAttemptSummary, 'idempotencyKey' | 'synced'>,
  uid?: string | null
): CompletedAttemptSummary {
  const entry: CompletedAttemptSummary = {
    ...input,
    idempotencyKey: createUuidV7(),
    synced: false,
  };

  const targetHistoryKey = historyKey(uid);
  const existing = getCompletedAttemptsSync(uid).filter(
    (item) => !(item.examSlug === entry.examSlug && item.setId === entry.setId)
  );
  const nextHistory = [entry, ...existing].slice(0, 200);
  writeStoredJsonSync(targetHistoryKey, nextHistory);

  // Local fast queue + Eviction-proof Pillar 4 SQLite/IDB mutation queue
  const queue = readStoredJsonSync<CompletedAttemptSummary[]>(MUTATION_QUEUE_KEY);
  const safeQueue = Array.isArray(queue) ? queue : [];
  writeStoredJsonSync(MUTATION_QUEUE_KEY, [...safeQueue, entry].slice(-100));

  void enqueueOfflineVaultMutation({
    idempotencyKey: entry.idempotencyKey,
    uid: uid || 'anon',
    schemaVersion: 1,
    endpoint: '/api/v1/exams/attempts',
    payloadJson: JSON.stringify(entry),
    createdAt: Date.now(),
  });

  notifyExamAttemptsUpdated();
  return entry;
}

export async function flushOfflineAttemptQueue(
  bearerToken?: string | null,
  uid?: string | null
): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine) return;

  const localQueue =
    readStoredJsonSync<CompletedAttemptSummary[]>(MUTATION_QUEUE_KEY) || [];
  const vaultQueue = await listQueuedOfflineMutations(uid || undefined);

  const byKey = new Map<string, CompletedAttemptSummary>();
  if (Array.isArray(localQueue)) {
    for (const item of localQueue) {
      if (item?.idempotencyKey) {
        byKey.set(item.idempotencyKey, item);
      }
    }
  }
  for (const row of vaultQueue) {
    if (!byKey.has(row.idempotencyKey)) {
      try {
        const parsed = JSON.parse(row.payloadJson) as CompletedAttemptSummary;
        if (parsed?.setId) {
          byKey.set(row.idempotencyKey, parsed);
        }
      } catch {
        await removeQueuedOfflineMutation(row.idempotencyKey);
      }
    }
  }

  if (byKey.size === 0) return;

  const remaining: CompletedAttemptSummary[] = [];
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
        body: JSON.stringify({ ...item, schemaVersion: 1 }),
      });
      if (res.ok) {
        syncedKeys.add(idemKey);
        await removeQueuedOfflineMutation(idemKey);
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  writeStoredJsonSync(MUTATION_QUEUE_KEY, remaining);

  if (syncedKeys.size > 0) {
    const targetHistoryKey = historyKey(uid);
    const history = getCompletedAttemptsSync(uid).map((h) =>
      syncedKeys.has(h.idempotencyKey) ? { ...h, synced: true } : h
    );
    writeStoredJsonSync(targetHistoryKey, history);
    notifyExamAttemptsUpdated();
  }
}
