'use client';

import {
  hasOfflineAsset,
  readOfflineAsset,
  readStoredJsonSync,
  saveOfflineAsset,
  writeStoredJsonSync,
} from '../../features/reader/shared/platform-adapter';
import { createUuidV7 } from '../platform/capacitor-bridge';
import type {
  CompletedAttemptSummary,
  ExamSet,
  PersistedExamSession,
} from './types';

const SESSION_PREFIX = 'ed_cbt_session_v1:';
const HISTORY_KEY = 'ed_cbt_attempt_history_v1';
const MUTATION_QUEUE_KEY = 'ed_cbt_offline_queue_v1';
export const EXAM_ATTEMPTS_UPDATED_EVENT = 'ed-exam-attempts-updated';

function sessionKey(examSlug: string, setId: string, mode: 'trial' | 'full'): string {
  return `${SESSION_PREFIX}${examSlug}:${setId}:${mode}`;
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
  mode: 'trial' | 'full'
): PersistedExamSession | null {
  const data = readStoredJsonSync<PersistedExamSession>(
    sessionKey(examSlug, setId, mode)
  );
  if (!data || data.schemaVersion !== 1 || data.setId !== setId) return null;
  return data;
}

export function saveExamSessionSync(session: PersistedExamSession): void {
  writeStoredJsonSync(
    sessionKey(session.examSlug, session.setId, session.mode),
    session
  );
}

export function clearExamSessionSync(
  examSlug: string,
  setId: string,
  mode: 'trial' | 'full'
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(sessionKey(examSlug, setId, mode));
  } catch {
    // Ignore storage errors
  }
  notifyExamAttemptsUpdated();
}

/* ==========================================================================
   2. Eviction-Proof Offline ExamSet[] Pack Vault (Web OPFS / Capacitor NoCloud)
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
   3. Completed Attempt Summaries + UUIDv7 Offline Sync Queue
   ========================================================================== */

export function getCompletedAttemptsSync(): CompletedAttemptSummary[] {
  const list = readStoredJsonSync<CompletedAttemptSummary[]>(HISTORY_KEY);
  return Array.isArray(list) ? list : [];
}

export function getLatestAttemptForSetSync(
  examSlug: string,
  setId: string
): CompletedAttemptSummary | null {
  const all = getCompletedAttemptsSync();
  return (
    all.find((a) => a.examSlug === examSlug && a.setId === setId) ?? null
  );
}

export function recordCompletedAttemptSync(
  input: Omit<CompletedAttemptSummary, 'idempotencyKey' | 'synced'>
): CompletedAttemptSummary {
  const entry: CompletedAttemptSummary = {
    ...input,
    idempotencyKey: createUuidV7(),
    synced: false,
  };

  const existing = getCompletedAttemptsSync().filter(
    (item) => !(item.examSlug === entry.examSlug && item.setId === entry.setId)
  );
  const nextHistory = [entry, ...existing].slice(0, 200);
  writeStoredJsonSync(HISTORY_KEY, nextHistory);

  const queue = readStoredJsonSync<CompletedAttemptSummary[]>(MUTATION_QUEUE_KEY);
  const safeQueue = Array.isArray(queue) ? queue : [];
  writeStoredJsonSync(MUTATION_QUEUE_KEY, [...safeQueue, entry].slice(-100));

  notifyExamAttemptsUpdated();
  return entry;
}

export async function flushOfflineAttemptQueue(
  bearerToken?: string | null
): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  const queue = readStoredJsonSync<CompletedAttemptSummary[]>(MUTATION_QUEUE_KEY);
  if (!Array.isArray(queue) || queue.length === 0) return;

  const remaining: CompletedAttemptSummary[] = [];
  const syncedKeys = new Set<string>();

  for (const item of queue) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Idempotency-Key': item.idempotencyKey,
      };
      if (bearerToken) {
        headers.Authorization = `Bearer ${bearerToken}`;
      }
      const res = await fetch('/api/v1/exams/attempts', {
        method: 'POST',
        headers,
        body: JSON.stringify(item),
      });
      if (res.ok) {
        syncedKeys.add(item.idempotencyKey);
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  writeStoredJsonSync(MUTATION_QUEUE_KEY, remaining);

  if (syncedKeys.size > 0) {
    const history = getCompletedAttemptsSync().map((h) =>
      syncedKeys.has(h.idempotencyKey) ? { ...h, synced: true } : h
    );
    writeStoredJsonSync(HISTORY_KEY, history);
    notifyExamAttemptsUpdated();
  }
}
