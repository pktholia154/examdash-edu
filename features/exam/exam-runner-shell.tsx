'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  HardDriveDownload,
  Keyboard,
  LayoutGrid,
  Lock,
  Moon,
  Play,
  RotateCcw,
  Sun,
  Trophy,
  X,
} from 'lucide-react';
import type { PublicExamDTO } from '../../lib/types/catalog';
import type {
  AttemptFeedbackPatch,
  ExamSection,
  ExamSet,
  HistoricalExamAttemptRecord,
  PersistedExamSession,
  QuestionTelemetry,
} from '../../lib/exam/types';
import {
  computeFullExamAnalytics,
  computeRemainingMs,
  countSectionPaletteStates,
  formatCountdownClock,
} from '../../lib/exam/grading';
import {
  cacheExamPackOffline,
  clearExamSessionSync,
  EXAM_ATTEMPTS_UPDATED_EVENT,
  fetchAndMergeCloudExamAttempts,
  flushOfflineAttemptQueue,
  getHistoricalAttemptsForSetSync,
  loadExamSessionSync,
  readCachedExamPackOffline,
  recordHistoricalAttemptSync,
  saveExamSessionSync,
  saveHistoricalAttemptFeedback,
} from '../../lib/exam/storage';
import { fetchClientStorageBytes } from '../../lib/firebase/storage-client';
import {
  readExamSetShardOffline,
  requestSignedAssetUnlock,
} from '../../lib/offline/offline-vault';
import { makeCompositeKey } from '../../lib/registry/content-type-registry';
import { registerLifecycleFlush } from '../reader/shared/platform-adapter';
import dynamic from 'next/dynamic';
import { apiUrl } from '../../lib/platform/api-base';
import { useAuth } from '../auth/auth-provider';
import { useTheme } from '../theme/theme-provider';
import { useToast } from '../toast/toast-context';
import { CbtQuestionPalette } from './cbt-palette';
import { CalculatorPopover } from './calculator-popover';
import { cn } from '../../lib/utils';

const ExamQuestionWorkspace = dynamic(
  () => import('./exam-engine').then((m) => m.ExamQuestionWorkspace),
  { ssr: false }
);

const ExamAnalyticsDashboard = dynamic(
  () =>
    import('./exam-analytics-dashboard').then((m) => m.ExamAnalyticsDashboard),
  { ssr: false }
);

type RunnerStage = 'lobby' | 'active' | 'review';

function createFreshSession(params: {
  exam: PublicExamDTO;
  examSet: ExamSet;
  mode: 'trial' | 'full';
}): PersistedExamSession {
  const { exam, examSet, mode } = params;
  const now = Date.now();
  const firstSec = examSet.sections[0];
  const firstQ = firstSec?.questions[0];

  const sectionEndEpochMs: Record<string, number> = {};
  if (examSet.sectionalTiming && firstSec) {
    const secMins = Number(firstSec.duration || examSet.duration || 60);
    sectionEndEpochMs[firstSec.id] = now + secMins * 60_000;
  }

  return {
    schemaVersion: 1,
    packId: exam.id,
    examSlug: exam.urlSlug,
    setId: examSet.id,
    mode,
    status: 'in_progress',
    startedAtEpochMs: now,
    targetEndEpochMs: now + Math.max(1, Number(examSet.duration || 60)) * 60_000,
    sectionEndEpochMs,
    lockedSectionIds: [],
    activeSectionId: firstSec?.id || '',
    activeQuestionId: firstQ?.id || '',
    responses: {},
    markedForReview: {},
    visitedQuestions: firstQ ? { [firstQ.id]: true } : {},
    telemetry: firstQ ? { [firstQ.id]: { timeSpentMs: 0, visits: 1 } } : {},
    updatedAtEpochMs: now,
  };
}

export function ExamRunnerShell({
  exam,
  initialSetId,
  initialMode,
  initialSource = 'online',
  autostart = false,
  initialView,
  initialAttemptId,
}: {
  exam: PublicExamDTO;
  initialSetId?: string;
  initialMode: 'trial' | 'full';
  initialSource?: 'online' | 'offline';
  autostart?: boolean;
  initialView?: 'review';
  initialAttemptId?: string;
}) {
  const {
    user,
    isAuthReady,
    isEntitlementsReady,
    ownedCompositeKeys,
    ownedSlugs,
    getIdToken,
    signInWithGoogle,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { showToast } = useToast();

  const isOwned =
    initialMode !== 'trial' &&
    (ownedCompositeKeys.has(makeCompositeKey('ExamPackDocument', exam.id)) ||
      ownedSlugs.has(`ExamPackDocument:${exam.urlSlug}`) ||
      (exam.buyPrice === 0 && Boolean(user)));

  const firstSampleSetId = exam.MocktestTitles[0]?.id || 'exam_set_1';
  const [selectedSetId, setSelectedSetId] = useState<string>(
    initialSetId || firstSampleSetId
  );

  // Determine whether the selected set is locked for an unowned visitor
  const isSelectedSampleSet =
    selectedSetId === firstSampleSetId ||
    exam.MocktestTitles.findIndex((m) => m.id === selectedSetId) <= 0;

  const isLockedUnownedSet = !isOwned && !isSelectedSampleSet;
  const sessionMode: 'trial' | 'full' = isOwned ? 'full' : 'trial';

  const [loadedSets, setLoadedSets] = useState<ExamSet[]>([]);
  const [loadingPack, setLoadingPack] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offlineReady, setOfflineReady] = useState<boolean>(false);

  const [stage, setStage] = useState<RunnerStage>(
    initialView === 'review' ? 'review' : 'lobby'
  );
  const [session, setSession] = useState<PersistedExamSession | null>(null);
  const [nowEpochMs, setNowEpochMs] = useState<number>(() => Date.now());
  const [attemptsHistory, setAttemptsHistory] = useState<
    HistoricalExamAttemptRecord[]
  >([]);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(
    initialAttemptId || null
  );
  const [cloudHistoryLoading, setCloudHistoryLoading] = useState<boolean>(
    initialView === 'review'
  );

  const [calcOpen, setCalcOpen] = useState<boolean>(false);
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);
  const [mobilePaletteOpen, setMobilePaletteOpen] = useState<boolean>(false);
  const [submitModalOpen, setSubmitModalOpen] = useState<boolean>(false);

  const sessionRef = useRef<PersistedExamSession | null>(null);
  const questionEnteredAtRef = useRef<number>(0);
  const autostartConsumedRef = useRef<boolean>(false);
  const initialReviewConsumedRef = useRef<boolean>(false);
  const selectedSetIdRef = useRef<string>(selectedSetId);
  const mocktestTitlesRef = useRef(exam.MocktestTitles);

  useEffect(() => {
    mocktestTitlesRef.current = exam.MocktestTitles;
  }, [exam.MocktestTitles]);

  useEffect(() => {
    selectedSetIdRef.current = selectedSetId;
  }, [selectedSetId]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Keep local/cloud historical attempts for the active set synchronized
  useEffect(() => {
    const syncLocalAttempts = () => {
      const list = getHistoricalAttemptsForSetSync({
        examSlug: exam.urlSlug,
        setId: selectedSetId,
        uid: user?.uid,
        packId: exam.id,
      });
      setAttemptsHistory(list);
    };
    syncLocalAttempts();
    window.addEventListener(EXAM_ATTEMPTS_UPDATED_EVENT, syncLocalAttempts);
    window.addEventListener('storage', syncLocalAttempts);
    return () => {
      window.removeEventListener(
        EXAM_ATTEMPTS_UPDATED_EVENT,
        syncLocalAttempts
      );
      window.removeEventListener('storage', syncLocalAttempts);
    };
  }, [exam.id, exam.urlSlug, selectedSetId, user?.uid]);

  // Flush queued offline attempts & hydrate historical attempts from Firebase Firestore
  useEffect(() => {
    if (!isAuthReady) return;
    let cancelled = false;

    const syncCloud = async () => {
      if (!user?.uid) {
        await flushOfflineAttemptQueue(null, null);
        if (!cancelled) setCloudHistoryLoading(false);
        return;
      }
      try {
        const token = await getIdToken();
        if (token) {
          await fetchAndMergeCloudExamAttempts({
            bearerToken: token,
            uid: user.uid,
            packId: exam.id,
            examSlug: exam.urlSlug,
          });
        }
      } finally {
        if (!cancelled) setCloudHistoryLoading(false);
      }
    };

    void syncCloud();
    const onOnline = () => void syncCloud();
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
    };
  }, [exam.id, exam.urlSlug, getIdToken, isAuthReady, user?.uid]);

  const handleSaveAttemptFeedback = useCallback(
    async (attemptId: string, patch: AttemptFeedbackPatch) => {
      const token = user ? await getIdToken() : null;
      await saveHistoricalAttemptFeedback({
        attemptId,
        patch,
        bearerToken: token,
        uid: user?.uid,
      });
      showToast(
        user
          ? 'Post-exam feedback saved to Firebase.'
          : 'Feedback saved on this device.',
        'success'
      );
    },
    [getIdToken, showToast, user]
  );

  const finalizeAndSubmit = useCallback(
    (baseSession: PersistedExamSession, targetSet: ExamSet, reason?: string) => {
      const now = Date.now();
      const qId = baseSession.activeQuestionId;
      const enteredAt = questionEnteredAtRef.current || now;
      const deltaMs = Math.max(0, now - enteredAt);
      questionEnteredAtRef.current = now;

      const nextTelemetry: Record<string, QuestionTelemetry> = {
        ...baseSession.telemetry,
      };
      if (qId) {
        const prev = nextTelemetry[qId] || { timeSpentMs: 0, visits: 1 };
        nextTelemetry[qId] = {
          timeSpentMs: prev.timeSpentMs + deltaMs,
          visits: Math.max(1, prev.visits),
        };
      }

      const sumTime = Object.values(nextTelemetry).reduce(
        (acc, t) => acc + (t.timeSpentMs || 0),
        0
      );

      const submittedSession: PersistedExamSession = {
        ...baseSession,
        status: 'submitted',
        telemetry: nextTelemetry,
        submittedAtEpochMs: now,
        totalTimeSpentMs:
          sumTime > 0 ? sumTime : Math.max(0, now - baseSession.startedAtEpochMs),
        updatedAtEpochMs: now,
      };

      saveExamSessionSync(submittedSession, user?.uid);
      setSession(submittedSession);
      setSubmitModalOpen(false);
      setCalcOpen(false);
      setMobilePaletteOpen(false);
      setStage('review');

      const savedRecord = recordHistoricalAttemptSync({
        packId: exam.id,
        examSlug: exam.urlSlug,
        examTitle: exam.title,
        examSet: targetSet,
        session: submittedSession,
        uid: user?.uid,
      });
      setSelectedAttemptId(savedRecord.attemptId);

      void (async () => {
        const token = user ? await getIdToken() : null;
        await flushOfflineAttemptQueue(token, user?.uid);
      })();

      if (reason) {
        showToast(reason, 'neutral');
      } else {
        showToast(
          user
            ? 'Exam submitted. Telemetry & solutions saved to Firebase.'
            : 'Exam submitted. Detailed analytics unlocked.',
          'success'
        );
      }
    },
    [exam.id, exam.title, exam.urlSlug, getIdToken, showToast, user]
  );

  const hydrateSessionForSet = useCallback(
    (targetSet: ExamSet, modeForSet: 'trial' | 'full') => {
      const existing = loadExamSessionSync(
        exam.urlSlug,
        targetSet.id,
        modeForSet,
        user?.uid
      );

      // Deep-link into historical Analysis & Solutions view when requested via ?view=review
      if (initialView === 'review' && !initialReviewConsumedRef.current) {
        initialReviewConsumedRef.current = true;
        if (existing) {
          setSession(existing);
        } else {
          setSession(null);
        }
        setStage('review');
        return;
      }

      if (existing) {
        setSession(existing);
        if (existing.status === 'in_progress') {
          const now = Date.now();
          questionEnteredAtRef.current = now;
          if (now >= existing.targetEndEpochMs) {
            finalizeAndSubmit(
              existing,
              targetSet,
              'Time expired while away — your saved responses have been submitted.'
            );
          } else {
            setNowEpochMs(now);
            setStage('active');
          }
          return;
        }
      } else {
        setSession(null);
      }

      if (autostart && !autostartConsumedRef.current) {
        autostartConsumedRef.current = true;
        const fresh = createFreshSession({
          exam,
          examSet: targetSet,
          mode: modeForSet,
        });
        saveExamSessionSync(fresh, user?.uid);
        questionEnteredAtRef.current = Date.now();
        setNowEpochMs(Date.now());
        setSession(fresh);
        setStage('active');
        return;
      }

      setStage('lobby');
    },
    [autostart, exam, finalizeAndSubmit, initialView, user?.uid]
  );

  // Resolve target ExamSet from Per-Set Offline Shard (< 200 KB in < 10ms) or Verified Signed Endpoint
  useEffect(() => {
    if (
      (!isAuthReady || (Boolean(user) && !isEntitlementsReady)) &&
      initialMode === 'full'
    ) {
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    const apiMode = isOwned ? 'full' : 'sample';
    const vaultMode: 'trial' | 'full' = isOwned ? 'full' : 'trial';
    const targetSetId = selectedSetId;

    const extractSetsFromRawJson = (parsed: unknown): ExamSet[] => {
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (s): s is ExamSet => Boolean(s && typeof s === 'object')
        );
      }
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        const arr = obj.sets ?? obj.examSets ?? obj.mocktests ?? obj.data;
        if (Array.isArray(arr)) {
          return arr.filter(
            (s): s is ExamSet => Boolean(s && typeof s === 'object')
          );
        }
        if (Array.isArray(obj.sections)) {
          return [parsed as ExamSet];
        }
      }
      return [];
    };

    const selectTargetSetFromPack = (allSets: ExamSet[]): ExamSet[] => {
      if (allSets.length === 0) return [];
      const exact = allSets.filter((s) => s.id === targetSetId);
      if (exact.length > 0) return exact;
      const expectedIdx = mocktestTitlesRef.current.findIndex(
        (m) => m.id === targetSetId
      );
      if (expectedIdx >= 0 && expectedIdx < allSets.length) {
        return [{ ...allSets[expectedIdx], id: targetSetId }];
      }
      return [allSets[0]];
    };

    const applyResolvedSets = (sets: ExamSet[], savedOffline: boolean) => {
      if (cancelled) return;
      setLoadedSets(sets);
      setOfflineReady(savedOffline);
      setLoadError(null);
      setLoadingPack(false);

      const targetSet = sets.find((s) => s.id === targetSetId) || sets[0];
      if (targetSet) {
        hydrateSessionForSet(targetSet, vaultMode);
      }
    };

    const readOwnedSetOffline = async (): Promise<ExamSet[] | null> => {
      if (isOwned) {
        if (!user?.uid) return null;
        const shard = await readExamSetShardOffline(
          user.uid,
          exam.id,
          targetSetId
        );
        return shard ? [shard] : null;
      }
      const legacy = await readCachedExamPackOffline(exam.urlSlug, 'trial');
      if (legacy && legacy.length > 0) {
        const matched = legacy.filter((s) => s.id === targetSetId);
        return matched.length > 0 ? matched : [legacy[0]];
      }
      return null;
    };

    const fetchSets = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoadingPack(true);
      setLoadError(null);

      const preferOffline =
        initialSource === 'offline' ||
        (typeof navigator !== 'undefined' && !navigator.onLine);

      // 1. Fast Path: Per-Set Offline Shard (< 200 KB, zero full-pack RAM spike)
      if (preferOffline && isOwned && user?.uid) {
        const localSlice = await readOwnedSetOffline();
        if (cancelled) return;
        if (localSlice && localSlice.length > 0) {
          applyResolvedSets(localSlice, true);
          return;
        }
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setLoadError(
            'You are offline and this mock set has not been saved to your device vault yet.'
          );
          setLoadingPack(false);
          return;
        }
      }

      // 2. Verified Online Fetch (Single-Set Filtered Slice to protect WebView RAM)
      try {
        const headers: Record<string, string> = {};
        let endpointUrl = `/api/v1/exams/${encodeURIComponent(
          exam.urlSlug
        )}?mode=${apiMode}&setId=${encodeURIComponent(targetSetId)}`;
        let unlockedStoragePath = '';
        let unlockedDirectJsonUrl = '';

        if (user) {
          const token = await getIdToken();
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          }
          if (isOwned) {
            try {
              const grant = await requestSignedAssetUnlock({
                uid: user.uid,
                collectionName: 'ExamPackDocument',
                urlSlug: exam.urlSlug,
                getIdToken,
                signal: abortController.signal,
              });
              unlockedStoragePath =
                grant.storagePaths?.fullJsonStoragePath || '';
              unlockedDirectJsonUrl = grant.directUrls?.jsonUrl || '';
              if (grant.assets.jsonUrl) {
                const sep = grant.assets.jsonUrl.includes('?') ? '&' : '?';
                endpointUrl = `${
                  grant.assets.jsonUrl
                }${sep}setId=${encodeURIComponent(targetSetId)}`;
              }
            } catch {
              // Bearer token header on /api/v1/exams/[packId] remains authoritative fallback
            }
          }
        }

        const res = await fetch(apiUrl(endpointUrl), {
          headers,
          signal: abortController.signal,
        });

        if (res.ok) {
          const sets = (await res.json()) as ExamSet[];
          if (!cancelled && Array.isArray(sets) && sets.length > 0) {
            let hasLocalCopy = false;
            if (isOwned && user?.uid) {
              const existingShard = await readExamSetShardOffline(
                user.uid,
                exam.id,
                sets[0].id
              );
              hasLocalCopy = Boolean(existingShard);
            } else {
              hasLocalCopy = await cacheExamPackOffline(
                exam.urlSlug,
                'trial',
                sets
              );
            }
            applyResolvedSets(sets, hasLocalCopy);
            return;
          }
        }

        // Direct Firebase Storage SDK fallback for fullJsonStoragePath when owned
        if (isOwned && (unlockedStoragePath || unlockedDirectJsonUrl)) {
          let rawBuf: ArrayBuffer | null = null;
          if (unlockedStoragePath) {
            rawBuf = await fetchClientStorageBytes(
              unlockedStoragePath,
              abortController.signal
            ).catch(() => null);
          }
          if (!rawBuf && unlockedDirectJsonUrl) {
            const dRes = await fetch(unlockedDirectJsonUrl, {
              method: 'GET',
              signal: abortController.signal,
            }).catch(() => null);
            if (dRes?.ok) {
              rawBuf = await dRes.arrayBuffer().catch(() => null);
            }
          }
          if (rawBuf && !cancelled) {
            const text = new TextDecoder('utf-8').decode(rawBuf);
            const parsedSets = extractSetsFromRawJson(JSON.parse(text));
            const targetSlice = selectTargetSetFromPack(parsedSets);
            if (targetSlice.length > 0) {
              const existingShard =
                user?.uid
                  ? await readExamSetShardOffline(
                      user.uid,
                      exam.id,
                      targetSlice[0].id
                    )
                  : null;
              applyResolvedSets(targetSlice, Boolean(existingShard));
              return;
            }
          }
        }

        // Automatic Offline Shard / Vault Fallback
        const cached = await readOwnedSetOffline();
        if (!cancelled && cached && cached.length > 0) {
          applyResolvedSets(cached, true);
          return;
        }

        if (!cancelled) {
          const errPayload = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setLoadError(
            errPayload.error || 'Unable to load exam set questions right now.'
          );
          setLoadingPack(false);
        }
      } catch {
        if (cancelled) return;
        const cached = await readOwnedSetOffline();
        if (!cancelled && cached && cached.length > 0) {
          applyResolvedSets(cached, true);
          return;
        }
        if (!cancelled) {
          setLoadError(
            'You appear to be offline and this exam pack is not saved on this device yet.'
          );
          setLoadingPack(false);
        }
      }
    };

    void fetchSets();
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [
    exam.id,
    exam.urlSlug,
    getIdToken,
    hydrateSessionForSet,
    initialMode,
    initialSource,
    isAuthReady,
    isEntitlementsReady,
    isOwned,
    selectedSetId,
    user,
  ]);

  const activeSet: ExamSet | null = useMemo(() => {
    if (loadedSets.length === 0) return null;
    return (
      loadedSets.find((s) => s.id === selectedSetId) || loadedSets[0] || null
    );
  }, [loadedSets, selectedSetId]);

  const handleSelectSetId = useCallback(
    (nextSetId: string) => {
      setSelectedSetId(nextSetId);
      const alreadyLoaded = loadedSets.find((s) => s.id === nextSetId);
      if (alreadyLoaded) {
        hydrateSessionForSet(alreadyLoaded, sessionMode);
      }
    },
    [hydrateSessionForSet, loadedSets, sessionMode]
  );

  const startFreshAttempt = useCallback(() => {
    if (!activeSet) return;
    const fresh = createFreshSession({
      exam,
      examSet: activeSet,
      mode: sessionMode,
    });
    saveExamSessionSync(fresh, user?.uid);
    questionEnteredAtRef.current = Date.now();
    setNowEpochMs(Date.now());
    setSession(fresh);
    setStage('active');
  }, [activeSet, exam, sessionMode, user?.uid]);

  const flushActiveDwellTime = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur || cur.status !== 'in_progress') return;
    const now = Date.now();
    const enteredAt = questionEnteredAtRef.current || now;
    const delta = Math.max(0, now - enteredAt);
    questionEnteredAtRef.current = now;
    if (delta <= 0 || !cur.activeQuestionId) return;

    const prevTel = cur.telemetry[cur.activeQuestionId] || {
      timeSpentMs: 0,
      visits: 1,
    };
    const updated: PersistedExamSession = {
      ...cur,
      telemetry: {
        ...cur.telemetry,
        [cur.activeQuestionId]: {
          timeSpentMs: prevTel.timeSpentMs + delta,
          visits: Math.max(1, prevTel.visits),
        },
      },
      updatedAtEpochMs: now,
    };
    sessionRef.current = updated;
    saveExamSessionSync(updated, user?.uid);
    setSession(updated);
  }, [user?.uid]);

  // Register lifecycle flush (visibilitychange + pagehide + Capacitor appStateChange)
  useEffect(() => {
    if (stage !== 'active') return;
    return registerLifecycleFlush(flushActiveDwellTime);
  }, [flushActiveDwellTime, stage]);

  // Sleep-Proof Monotonic Countdown & Sectional Auto-Advance Ticker
  useEffect(() => {
    if (stage !== 'active' || !activeSet) return;

    const reconcileClock = () => {
      const cur = sessionRef.current;
      if (!cur || cur.status !== 'in_progress') return;
      const now = Date.now();
      setNowEpochMs(now);

      if (now >= cur.targetEndEpochMs) {
        finalizeAndSubmit(
          cur,
          activeSet,
          'Exam duration completed. Submitting responses automatically.'
        );
        return;
      }

      if (activeSet.sectionalTiming && cur.activeSectionId) {
        const secTarget = cur.sectionEndEpochMs[cur.activeSectionId];
        if (secTarget && now >= secTarget) {
          const lockedSet = new Set([
            ...cur.lockedSectionIds,
            cur.activeSectionId,
          ]);
          const nextSec = activeSet.sections.find((s) => !lockedSet.has(s.id));

          if (!nextSec) {
            finalizeAndSubmit(
              cur,
              activeSet,
              'All timed sections completed. Submitting exam.'
            );
            return;
          }

          const enteredAt = questionEnteredAtRef.current || now;
          const delta = Math.max(0, now - enteredAt);
          questionEnteredAtRef.current = now;
          const prevTel = cur.telemetry[cur.activeQuestionId] || {
            timeSpentMs: 0,
            visits: 1,
          };
          const nextFirstQ = nextSec.questions[0]?.id || '';
          const nextFirstTel = cur.telemetry[nextFirstQ] || {
            timeSpentMs: 0,
            visits: 0,
          };
          const secDurationMs =
            Math.max(1, Number(nextSec.duration || 20)) * 60_000;

          const transitioned: PersistedExamSession = {
            ...cur,
            lockedSectionIds: Array.from(lockedSet),
            activeSectionId: nextSec.id,
            activeQuestionId: nextFirstQ,
            sectionEndEpochMs: {
              ...cur.sectionEndEpochMs,
              [nextSec.id]: Math.min(cur.targetEndEpochMs, now + secDurationMs),
            },
            visitedQuestions: nextFirstQ
              ? { ...cur.visitedQuestions, [nextFirstQ]: true }
              : cur.visitedQuestions,
            telemetry: {
              ...cur.telemetry,
              ...(cur.activeQuestionId
                ? {
                    [cur.activeQuestionId]: {
                      timeSpentMs: prevTel.timeSpentMs + delta,
                      visits: Math.max(1, prevTel.visits),
                    },
                  }
                : {}),
              ...(nextFirstQ
                ? {
                    [nextFirstQ]: {
                      timeSpentMs: nextFirstTel.timeSpentMs,
                      visits: nextFirstTel.visits + 1,
                    },
                  }
                : {}),
            },
            updatedAtEpochMs: now,
          };

          sessionRef.current = transitioned;
          saveExamSessionSync(transitioned, user?.uid);
          setSession(transitioned);
          showToast(
            `Section time completed. Moved to "${nextSec.title}".`,
            'neutral'
          );
        }
      }
    };

    const interval = window.setInterval(reconcileClock, 500);
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        questionEnteredAtRef.current = Date.now();
        reconcileClock();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', reconcileClock);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', reconcileClock);
    };
  }, [activeSet, finalizeAndSubmit, showToast, stage, user?.uid]);

  // Active Section & Question Resolution
  const activeSection: ExamSection | null = useMemo(() => {
    if (!activeSet) return null;
    return (
      activeSet.sections.find((s) => s.id === session?.activeSectionId) ||
      activeSet.sections[0] ||
      null
    );
  }, [activeSet, session?.activeSectionId]);

  const sectionGlobalOffset = useMemo(() => {
    if (!activeSet || !activeSection) return 0;
    let offset = 0;
    for (const s of activeSet.sections) {
      if (s.id === activeSection.id) break;
      offset += s.questions.length;
    }
    return offset;
  }, [activeSection, activeSet]);

  const activeQuestionIndex = useMemo(() => {
    if (!activeSection) return 0;
    const idx = activeSection.questions.findIndex(
      (q) => q.id === session?.activeQuestionId
    );
    return idx >= 0 ? idx : 0;
  }, [activeSection, session?.activeQuestionId]);

  const activeQuestion = activeSection?.questions[activeQuestionIndex] || null;
  const globalQuestionNumber = sectionGlobalOffset + activeQuestionIndex + 1;

  // Mutate session helper with instant synchronous persistence
  const updateActiveSession = useCallback(
    (updater: (cur: PersistedExamSession, now: number) => PersistedExamSession) => {
      const cur = sessionRef.current;
      if (!cur || cur.status !== 'in_progress') return;
      const now = Date.now();
      const next = updater(cur, now);
      sessionRef.current = next;
      saveExamSessionSync(next, user?.uid);
      setSession(next);
    },
    [user?.uid]
  );

  const navigateToQuestion = useCallback(
    (
      targetSectionId: string,
      targetQuestionId: string,
      extraPatch?: (
        cur: PersistedExamSession
      ) => Partial<
        Pick<PersistedExamSession, 'responses' | 'markedForReview'>
      >
    ) => {
      updateActiveSession((cur, now) => {
        const enteredAt = questionEnteredAtRef.current || now;
        const delta = Math.max(0, now - enteredAt);
        questionEnteredAtRef.current = now;

        const prevQId = cur.activeQuestionId;
        const isSwitchingQuestion = prevQId !== targetQuestionId;

        const prevTel = cur.telemetry[prevQId] || { timeSpentMs: 0, visits: 1 };
        const targetTel = cur.telemetry[targetQuestionId] || {
          timeSpentMs: 0,
          visits: 0,
        };

        const patch = extraPatch ? extraPatch(cur) : {};

        return {
          ...cur,
          ...patch,
          activeSectionId: targetSectionId,
          activeQuestionId: targetQuestionId,
          visitedQuestions: {
            ...cur.visitedQuestions,
            [targetQuestionId]: true,
          },
          telemetry: {
            ...cur.telemetry,
            ...(prevQId
              ? {
                  [prevQId]: {
                    timeSpentMs: prevTel.timeSpentMs + delta,
                    visits: Math.max(1, prevTel.visits),
                  },
                }
              : {}),
            [targetQuestionId]: {
              timeSpentMs:
                (prevQId === targetQuestionId
                  ? prevTel.timeSpentMs + delta
                  : targetTel.timeSpentMs),
              visits: isSwitchingQuestion
                ? targetTel.visits + 1
                : Math.max(1, targetTel.visits),
            },
          },
          updatedAtEpochMs: now,
        };
      });
      setMobilePaletteOpen(false);
    },
    [updateActiveSession]
  );

  const handleAnswerChange = useCallback(
    (questionId: string, nextAnswer: unknown) => {
      updateActiveSession((cur, now) => {
        const nextResponses = { ...cur.responses };
        if (
          nextAnswer === null ||
          nextAnswer === undefined ||
          nextAnswer === '' ||
          (Array.isArray(nextAnswer) && nextAnswer.length === 0)
        ) {
          delete nextResponses[questionId];
        } else {
          nextResponses[questionId] = nextAnswer;
        }
        return {
          ...cur,
          responses: nextResponses,
          updatedAtEpochMs: now,
        };
      });
    },
    [updateActiveSession]
  );

  const resolveNextTarget = useCallback((): {
    sectionId: string;
    questionId: string;
  } | null => {
    if (!activeSet || !activeSection) return null;
    if (activeQuestionIndex < activeSection.questions.length - 1) {
      return {
        sectionId: activeSection.id,
        questionId: activeSection.questions[activeQuestionIndex + 1].id,
      };
    }
    if (!activeSet.sectionalTiming) {
      const secIdx = activeSet.sections.findIndex(
        (s) => s.id === activeSection.id
      );
      const nextSec =
        activeSet.sections[(secIdx + 1) % activeSet.sections.length];
      if (nextSec?.questions[0]) {
        return { sectionId: nextSec.id, questionId: nextSec.questions[0].id };
      }
    }
    return {
      sectionId: activeSection.id,
      questionId: activeSection.questions[0]?.id || activeQuestion?.id || '',
    };
  }, [activeQuestion?.id, activeQuestionIndex, activeSection, activeSet]);

  const resolvePrevTarget = useCallback((): {
    sectionId: string;
    questionId: string;
  } | null => {
    if (!activeSet || !activeSection) return null;
    if (activeQuestionIndex > 0) {
      return {
        sectionId: activeSection.id,
        questionId: activeSection.questions[activeQuestionIndex - 1].id,
      };
    }
    if (!activeSet.sectionalTiming) {
      const secIdx = activeSet.sections.findIndex(
        (s) => s.id === activeSection.id
      );
      if (secIdx > 0) {
        const prevSec = activeSet.sections[secIdx - 1];
        const lastQ = prevSec.questions[prevSec.questions.length - 1];
        if (lastQ) {
          return { sectionId: prevSec.id, questionId: lastQ.id };
        }
      }
    }
    return null;
  }, [activeQuestionIndex, activeSection, activeSet]);

  const handleSaveAndNext = useCallback(() => {
    if (!activeQuestion) return;
    const next = resolveNextTarget();
    if (!next) return;
    navigateToQuestion(next.sectionId, next.questionId, (cur) => ({
      markedForReview: {
        ...cur.markedForReview,
        [activeQuestion.id]: false,
      },
    }));
  }, [activeQuestion, navigateToQuestion, resolveNextTarget]);

  const handleMarkForReviewAndNext = useCallback(() => {
    if (!activeQuestion) return;
    const next = resolveNextTarget();
    if (!next) return;
    navigateToQuestion(next.sectionId, next.questionId, (cur) => ({
      markedForReview: {
        ...cur.markedForReview,
        [activeQuestion.id]: true,
      },
    }));
  }, [activeQuestion, navigateToQuestion, resolveNextTarget]);

  const handleClearResponse = useCallback(() => {
    if (!activeQuestion) return;
    updateActiveSession((cur, now) => {
      const nextResponses = { ...cur.responses };
      delete nextResponses[activeQuestion.id];
      return {
        ...cur,
        responses: nextResponses,
        markedForReview: {
          ...cur.markedForReview,
          [activeQuestion.id]: false,
        },
        updatedAtEpochMs: now,
      };
    });
  }, [activeQuestion, updateActiveSession]);

  const handlePrevious = useCallback(() => {
    const prev = resolvePrevTarget();
    if (!prev) return;
    navigateToQuestion(prev.sectionId, prev.questionId);
  }, [navigateToQuestion, resolvePrevTarget]);

  // Keyboard Shortcuts & Android/Browser Back Navigation Guard during Active Exam
  useEffect(() => {
    if (stage !== 'active') return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (e.key === '?' && !inInput) {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
        return;
      }

      if (e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        handleSaveAndNext();
        return;
      }
      if (e.altKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        handleMarkForReviewAndNext();
        return;
      }
      if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        handleClearResponse();
        return;
      }
      if (!inInput && e.key === 'ArrowRight') {
        e.preventDefault();
        handleSaveAndNext();
        return;
      }
      if (!inInput && e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevious();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleClearResponse,
    handleMarkForReviewAndNext,
    handlePrevious,
    handleSaveAndNext,
    stage,
  ]);

  const backHref = isOwned ? '/purchased' : `/exams/${exam.urlSlug}`;

  // ============================================================================
  // RENDER 1: LOCKED SET GATE (Unowned User Requesting Set 2..N)
  // ============================================================================
  if (isAuthReady && isLockedUnownedSet) {
    return (
      <div className="ed-container py-12">
        <div className="max-w-xl mx-auto rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 sm:p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-main)] mx-auto">
            <Lock className="w-5 h-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-extrabold text-[var(--text-main)]">
            Unlock Full Exam Series to Attempt This Set
          </h1>
          <p className="text-sm text-[var(--text-muted)] leading-relaxed">
            The 1st mock test in <strong>{exam.title}</strong> is available as a
            free sample. Purchase this exam pack to unlock all{' '}
            {exam.totalMocktest} full-length sets in your library.
          </p>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <a
              href={`/exams/${exam.urlSlug}`}
              className="inline-flex items-center justify-center min-h-12 px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Unlock Exam Pack
            </a>
            <button
              type="button"
              onClick={() => handleSelectSetId(firstSampleSetId)}
              className="inline-flex items-center justify-center min-h-12 px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              Try 1st Sample Set Free
            </button>
            {!user && (
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                className="inline-flex items-center justify-center min-h-12 px-4 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                Already purchased? Sign in →
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER 2: POST-EXAM ANALYTICS, HISTORICAL TELEMETRY & SOLUTION REVIEW STAGE
  // (Renders immediately when historical Firebase attempt data is available, even while ExamSet loads)
  // ============================================================================
  if (
    stage === 'review' &&
    (attemptsHistory.length > 0 || (session && activeSet))
  ) {
    return (
      <ExamAnalyticsDashboard
        examTitle={exam.title}
        examSlug={exam.urlSlug}
        examSet={activeSet}
        loadingExamSet={loadingPack}
        session={session}
        attemptsHistory={attemptsHistory}
        selectedAttemptId={selectedAttemptId}
        onSelectAttempt={(id) => setSelectedAttemptId(id)}
        onSaveFeedback={handleSaveAttemptFeedback}
        isSignedIn={Boolean(user)}
        isOwned={isOwned}
        backHref={backHref}
        onReattempt={() => {
          if (activeSet) {
            clearExamSessionSync(
              exam.urlSlug,
              activeSet.id,
              sessionMode,
              user?.uid
            );
            startFreshAttempt();
          } else {
            setStage('lobby');
          }
        }}
      />
    );
  }

  // ============================================================================
  // RENDER 3: LOADING / ERROR STATES
  // ============================================================================
  if (loadingPack || (stage === 'review' && cloudHistoryLoading)) {
    return (
      <div className="ed-container py-10 space-y-4">
        <div className="h-14 w-72 rounded-lg ed-skeleton" />
        <div className="h-80 w-full rounded-[var(--radius-card)] ed-skeleton" />
      </div>
    );
  }

  if (loadError || !activeSet) {
    return (
      <div className="ed-container py-12">
        <div className="max-w-lg mx-auto rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 text-center space-y-4">
          <AlertTriangle
            className="w-8 h-8 text-[var(--status-warning)] mx-auto"
            aria-hidden="true"
          />
          <h1 className="text-lg font-bold text-[var(--text-main)]">
            Exam Set Unavailable
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            {loadError || 'No mock sets were found in this exam pack.'}
          </p>
          <a
            href={backHref}
            className="inline-flex items-center justify-center min-h-12 px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold"
          >
            Return to Exam Details
          </a>
        </div>
      </div>
    );
  }

  // If deep-linked with ?view=review but zero attempts exist yet, drop gracefully into CBT Lobby
  if (stage === 'review') {
    return (
      <div className="ed-container py-12">
        <div className="max-w-lg mx-auto rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 text-center space-y-4">
          <Trophy
            className="w-8 h-8 text-[var(--text-muted)] mx-auto"
            aria-hidden="true"
          />
          <h1 className="text-lg font-bold text-[var(--text-main)]">
            No Completed Attempts Recorded Yet
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            Complete an attempt on <strong>{activeSet.title}</strong> to unlock
            section-wise time telemetry, official solutions, and post-exam
            analysis.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={startFreshAttempt}
              className="inline-flex items-center justify-center gap-2 min-h-12 px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold whitespace-nowrap"
            >
              <Play className="w-4 h-4" aria-hidden="true" />
              <span>Start Mock Test</span>
            </button>
            <a
              href={backHref}
              className="inline-flex items-center justify-center min-h-12 px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm font-semibold text-[var(--text-main)] whitespace-nowrap"
            >
              Back
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER 4: INDIAN CBT LOBBY & INSTRUCTIONS SCREEN
  // ============================================================================
  if (stage === 'lobby') {
    const previousSubmitted =
      session?.status === 'submitted' ? session : null;
    const previousAnalytics = previousSubmitted
      ? computeFullExamAnalytics({
          exam: activeSet,
          responses: previousSubmitted.responses,
          telemetry: previousSubmitted.telemetry,
          markedForReview: previousSubmitted.markedForReview,
          fallbackTotalTimeMs: previousSubmitted.totalTimeSpentMs,
        })
      : null;

    return (
      <div className="ed-container py-6 sm:py-8 space-y-6">
        {/* Top Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3.5 min-w-0">
            <a
              href={backHref}
              aria-label="Back to exam pack"
              className="inline-flex items-center justify-center min-h-12 min-w-12 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            </a>
            <div className="min-w-0">
              <p className="text-xs font-medium text-[var(--text-muted)]">
                {exam.title} ·{' '}
                {sessionMode === 'trial'
                  ? 'Free Sample CBT Test'
                  : 'Full Unlocked CBT Series'}{' '}
                {offlineReady ? '· Offline Ready' : ''}
              </p>
              <h1 className="text-lg sm:text-2xl font-extrabold text-[var(--text-main)] truncate">
                {activeSet.title}
              </h1>
            </div>
          </div>

          {/* Set Switcher when multiple sets exist in owned pack */}
          {(isOwned && exam.MocktestTitles.length > 1) || loadedSets.length > 1 ? (
            <div className="flex items-center gap-2 shrink-0">
              <label
                htmlFor="cbt-set-selector"
                className="text-xs font-semibold text-[var(--text-muted)] whitespace-nowrap"
              >
                Exam Set:
              </label>
              <select
                id="cbt-set-selector"
                value={activeSet.id}
                onChange={(e) => handleSelectSetId(e.target.value)}
                className="min-h-12 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-xs sm:text-sm font-semibold text-[var(--text-main)]"
              >
                {(isOwned && exam.MocktestTitles.length > 1
                  ? exam.MocktestTitles.map((m) => ({ id: m.id, title: m.title }))
                  : loadedSets.map((s) => ({ id: s.id, title: s.title }))
                ).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 8 Cols: Official CBT Instructions & Section Structure */}
          <div className="lg:col-span-8 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-7 space-y-6">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[var(--text-main)]">
                Candidate Instructions & Paper Structure
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-[var(--text-muted)]">
                Please review the marking scheme, sectional timing rules, and
                question palette states before starting the timer.
              </p>
            </div>

            {/* Paper KPI Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 tabular-nums">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5">
                <span className="text-xs text-[var(--text-muted)]">Duration</span>
                <p className="mt-1 text-lg font-extrabold text-[var(--text-main)]">
                  {activeSet.duration} min
                </p>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5">
                <span className="text-xs text-[var(--text-muted)]">Questions</span>
                <p className="mt-1 text-lg font-extrabold text-[var(--text-main)]">
                  {activeSet.totalQuestions}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5">
                <span className="text-xs text-[var(--text-muted)]">Max Marks</span>
                <p className="mt-1 text-lg font-extrabold text-[var(--text-main)]">
                  {activeSet.totalMarks}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5">
                <span className="text-xs text-[var(--text-muted)]">Calculator</span>
                <p className="mt-1 text-sm font-extrabold text-[var(--text-main)] capitalize">
                  {activeSet.calculator === 'none'
                    ? 'Not Permitted'
                    : `${activeSet.calculator} Calc`}
                </p>
              </div>
            </div>

            {/* Section Breakdown Table */}
            <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
              <table className="w-full text-start border-collapse text-xs sm:text-sm tabular-nums">
                <thead>
                  <tr className="bg-[var(--bg-elevated)]/60 border-b border-[var(--border-subtle)] text-[var(--text-muted)] font-semibold">
                    <th scope="col" className="py-2.5 px-3.5 text-start">
                      Section
                    </th>
                    <th scope="col" className="py-2.5 px-3.5 text-end">
                      Questions
                    </th>
                    <th scope="col" className="py-2.5 px-3.5 text-end">
                      Attempt Cap
                    </th>
                    <th scope="col" className="py-2.5 px-3.5 text-end">
                      Timing
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {activeSet.sections.map((sec) => (
                    <tr key={sec.id}>
                      <td className="py-2.5 px-3.5 font-semibold text-[var(--text-main)]">
                        {sec.title}
                      </td>
                      <td className="py-2.5 px-3.5 text-end text-[var(--text-muted)]">
                        {sec.totalQuestions}
                      </td>
                      <td className="py-2.5 px-3.5 text-end text-[var(--text-muted)]">
                        {sec.maxAttempts
                          ? `First ${sec.maxAttempts} attempts`
                          : 'All questions'}
                      </td>
                      <td className="py-2.5 px-3.5 text-end text-[var(--text-main)] font-medium">
                        {activeSet.sectionalTiming && sec.duration
                          ? `${sec.duration} min (Locked)`
                          : 'Shared Clock'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Authentic Indian CBT Rules */}
            <ul className="space-y-2 text-xs sm:text-sm text-[var(--text-main)] leading-relaxed list-disc ps-5">
              <li>
                The countdown clock runs monotonically on device time. If your
                browser refreshes or loses power, your saved answers and remaining
                timer restore automatically.
              </li>
              <li>
                Questions marked as{' '}
                <strong>Answered &amp; Marked for Review</strong>{' '}
                <em>will be evaluated</em> during final scoring, matching official
                TCS iON / GATE / CAT evaluation rules.
              </li>
              {activeSet.sectionalTiming && (
                <li>
                  <strong>Sectional Timing Enabled:</strong> Each section has its
                  own dedicated timer. Once a section&apos;s timer expires, the
                  runner advances automatically to the next section.
                </li>
              )}
            </ul>
          </div>

          {/* Right 4 Cols: Palette Key + Launch Card */}
          <aside className="lg:col-span-4 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6 space-y-5">
            <h3 className="text-sm font-bold text-[var(--text-main)]">
              Question Palette Legend
            </h3>
            <div className="space-y-2.5 text-xs text-[var(--text-muted)]">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] font-bold text-[var(--text-main)] shrink-0">
                  1
                </span>
                <span>You have not visited the question yet.</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-b-xl rounded-t-md bg-rose-600 font-bold text-white shrink-0">
                  2
                </span>
                <span>You have visited but not answered the question.</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-t-xl rounded-b-md bg-emerald-600 font-bold text-white shrink-0">
                  3
                </span>
                <span>You have answered the question.</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 font-bold text-white shrink-0">
                  4
                </span>
                <span>Marked for review without an answer.</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 font-bold text-white shrink-0">
                  5
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Check className="h-2.5 w-2.5 stroke-[3]" aria-hidden="true" />
                  </span>
                </span>
                <span>
                  Answered &amp; Marked for Review (counted toward final score).
                </span>
              </div>
            </div>

            {(attemptsHistory.length > 0 || previousAnalytics) && (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 space-y-2 tabular-nums">
                <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-muted)]">
                  <span>
                    {attemptsHistory.length > 1
                      ? `Attempt History (${attemptsHistory.length} Runs)`
                      : 'Last Completed Score'}
                  </span>
                  <Trophy
                    className="w-4 h-4 text-[var(--status-success)]"
                    aria-hidden="true"
                  />
                </div>
                <p className="text-xl font-extrabold text-[var(--text-main)]">
                  {attemptsHistory[0]
                    ? `${attemptsHistory[0].totalScore} / ${attemptsHistory[0].maxScore}`
                    : `${previousAnalytics?.evaluation.totalScore ?? 0} / ${
                        previousAnalytics?.evaluation.maxScore ?? 0
                      }`}{' '}
                  <span className="text-xs font-semibold text-[var(--text-muted)]">
                    (
                    {attemptsHistory[0]
                      ? attemptsHistory[0].accuracyPct
                      : previousAnalytics?.accuracyPct ?? 0}
                    % accuracy)
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (attemptsHistory[0]) {
                      setSelectedAttemptId(attemptsHistory[0].attemptId);
                    }
                    setStage('review');
                  }}
                  className="w-full min-h-11 px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
                >
                  {attemptsHistory.length > 1
                    ? `Analysis & Solutions (${attemptsHistory.length})`
                    : 'Analysis & Solutions'}
                </button>
              </div>
            )}

            <div className="pt-2 space-y-2.5">
              <button
                type="button"
                onClick={startFreshAttempt}
                className="w-full inline-flex items-center justify-center gap-2 min-h-12 px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-bold hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                {previousSubmitted || attemptsHistory.length > 0 ? (
                  <>
                    <RotateCcw className="w-4 h-4" aria-hidden="true" />
                    <span>Start Fresh Attempt</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" aria-hidden="true" />
                    <span>Start Mock Test</span>
                  </>
                )}
              </button>

              {offlineReady && (
                <p className="flex items-center justify-center gap-1.5 text-xs text-[var(--status-success)] font-medium">
                  <HardDriveDownload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Saved to device vault for offline execution</span>
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER 5: ACTIVE 100dvh INDIAN CBT WORKSPACE
  // ============================================================================
  if (!session || !activeSection || !activeQuestion) return null;

  const overallRemainingMs = computeRemainingMs(
    session.targetEndEpochMs,
    nowEpochMs
  );
  const activeSecTargetMs =
    activeSet.sectionalTiming && session.sectionEndEpochMs[activeSection.id]
      ? session.sectionEndEpochMs[activeSection.id]
      : session.targetEndEpochMs;
  const activeClockMs = activeSet.sectionalTiming
    ? Math.min(overallRemainingMs, computeRemainingMs(activeSecTargetMs, nowEpochMs))
    : overallRemainingMs;
  const isLowTime = activeClockMs <= 5 * 60_000;

  const isMarked = Boolean(session.markedForReview[activeQuestion.id]);
  const hasPrev = Boolean(resolvePrevTarget());

  return (
    <div
      data-state="cbt-active"
      className="fixed inset-0 z-40 h-[100dvh] w-screen flex flex-col bg-[var(--bg-canvas)] text-[var(--text-main)] overflow-hidden"
    >
      {/* Top CBT Command Header */}
      <header className="h-14 px-3 sm:px-5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0 flex items-center gap-2.5">
          <a
            href={backHref}
            aria-label="Exit to exam details (progress saved)"
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--text-main)] shrink-0"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </a>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-extrabold text-[var(--text-main)] truncate">
              {activeSet.title}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] truncate hidden sm:block">
              {exam.title} · Autosaved locally
            </p>
          </div>
        </div>

        {/* Monotonic Countdown Clock + Tools */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 tabular-nums">
          <div
            aria-live="off"
            aria-label="Remaining exam time"
            data-testid="cbt-timer"
            className={cn(
              'inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg border font-mono text-sm sm:text-base font-extrabold',
              isLowTime
                ? 'border-[var(--status-danger)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]'
                : 'border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--text-main)]'
            )}
          >
            <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{formatCountdownClock(activeClockMs)}</span>
          </div>

          {activeSet.calculator !== 'none' && (
            <button
              type="button"
              aria-label="Toggle exam calculator"
              aria-expanded={calcOpen}
              onClick={() => setCalcOpen((prev) => !prev)}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 min-h-[40px] px-2.5 sm:px-3 rounded-lg border text-xs font-semibold transition-colors',
                calcOpen
                  ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-main)] hover:border-[var(--border-strong)]'
              )}
            >
              <Calculator className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="hidden md:inline">Calculator</span>
            </button>
          )}

          <button
            type="button"
            aria-label="Keyboard shortcuts"
            onClick={() => setShortcutsOpen((prev) => !prev)}
            className="hidden sm:inline-flex items-center justify-center w-10 h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
          >
            <Keyboard className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            aria-label={
              theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
            }
            onClick={toggleTheme}
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Moon className="w-4 h-4" aria-hidden="true" />
            )}
          </button>

          {/* Mobile Question Palette & Submit Controls */}
          <button
            type="button"
            aria-label="Open question palette"
            onClick={() => setMobilePaletteOpen(true)}
            className="xl:hidden inline-flex items-center justify-center gap-1.5 min-h-[40px] px-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-xs font-bold text-[var(--text-main)]"
          >
            <LayoutGrid className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Palette</span>
          </button>

          <button
            type="button"
            onClick={() => setSubmitModalOpen(true)}
            className="xl:hidden inline-flex items-center justify-center min-h-[40px] px-3 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-bold whitespace-nowrap"
          >
            Submit
          </button>
        </div>
      </header>

      {/* Sectional Tabs Strip */}
      <div
        role="tablist"
        aria-label="Exam sections"
        className="px-3 sm:px-5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/70 flex items-center gap-2 overflow-x-auto shrink-0 tabular-nums"
      >
        {activeSet.sections.map((sec) => {
          const isCurrentSec = sec.id === activeSection.id;
          const isSecLocked =
            activeSet.sectionalTiming && !isCurrentSec;
          const secCounts = countSectionPaletteStates(
            sec,
            session.responses,
            session.visitedQuestions,
            session.markedForReview
          );
          const answeredTotal =
            secCounts.ANSWERED + secCounts.ANSWERED_AND_MARKED;

          return (
            <button
              key={sec.id}
              type="button"
              role="tab"
              aria-selected={isCurrentSec}
              disabled={isSecLocked}
              onClick={() => {
                if (isSecLocked || isCurrentSec) return;
                const firstQ = sec.questions[0]?.id;
                if (firstQ) {
                  navigateToQuestion(sec.id, firstQ);
                }
              }}
              className={cn(
                'inline-flex items-center gap-2 min-h-[40px] px-3.5 rounded-lg border text-xs font-semibold whitespace-nowrap transition-colors shrink-0',
                isCurrentSec
                  ? 'border-[var(--brand-primary)] bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
                  : isSecLocked
                  ? 'border-transparent bg-transparent text-[var(--text-muted)] opacity-60 cursor-not-allowed'
                  : 'border-transparent bg-transparent text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)]/60'
              )}
            >
              {isSecLocked && <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />}
              <span className="max-w-[205px] sm:max-w-none truncate">
                {sec.title}
              </span>
              <span className="text-[11px] font-bold text-[var(--status-success)] shrink-0">
                {answeredTotal}/{sec.questions.length}
              </span>
            </button>
          );
        })}

        {activeSet.sectionalTiming && (
          <div className="ms-auto pl-2 shrink-0">
            {activeSet.sections.findIndex((s) => s.id === activeSection.id) <
              activeSet.sections.length - 1 && (
              <button
                type="button"
                onClick={() => {
                  const now = Date.now();
                  updateActiveSession((cur) => ({
                    ...cur,
                    sectionEndEpochMs: {
                      ...cur.sectionEndEpochMs,
                      [activeSection.id]: now - 1,
                    },
                  }));
                }}
                className="min-h-[36px] px-2.5 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[11px] font-semibold text-[var(--text-main)] hover:bg-[var(--bg-canvas)] whitespace-nowrap"
              >
                Finish Section →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Split Body: Scrollable Question Workspace + Right Desktop Palette */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <main
            aria-label="Exam question workspace"
            className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5"
          >
            <ExamQuestionWorkspace
              section={activeSection}
              question={activeQuestion}
              questionNumber={globalQuestionNumber}
              sectionResponses={session.responses}
              onChange={handleAnswerChange}
              mode="exam"
              showVirtualKeypad={true}
            />
          </main>

          {/* Bottom Indian CBT Action Footer (>= 48x48px touch targets, single row on mobile & desktop) */}
          <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 sm:px-5 py-2 pb-[calc(0.5rem+var(--safe-area-inset-bottom))] flex items-center justify-between gap-1.5 sm:gap-2 shrink-0 chrome-no-select">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                aria-label="Mark for Review and Next"
                onClick={handleMarkForReviewAndNext}
                className={cn(
                  'min-h-12 px-2.5 sm:px-4 rounded-lg border text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap',
                  isMarked
                    ? 'border-violet-600 bg-violet-600 text-white'
                    : 'border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)]'
                )}
              >
                <span className="sm:hidden">Mark &amp; Next</span>
                <span className="hidden sm:inline">
                  Mark for Review &amp; Next
                </span>
              </button>

              <button
                type="button"
                aria-label="Clear Response"
                onClick={handleClearResponse}
                className="min-h-12 px-2.5 sm:px-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs sm:text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--status-danger)] hover:border-[var(--status-danger)] transition-colors whitespace-nowrap"
              >
                <span className="sm:hidden">Clear</span>
                <span className="hidden sm:inline">Clear Response</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 ms-auto">
              <button
                type="button"
                aria-label="Previous Question"
                disabled={!hasPrev}
                onClick={handlePrevious}
                className="inline-flex items-center justify-center gap-1 min-h-12 min-w-12 px-2.5 sm:px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-xs sm:text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">Previous</span>
              </button>

              <button
                type="button"
                onClick={handleSaveAndNext}
                className="inline-flex items-center justify-center gap-1 min-h-12 px-3.5 sm:px-5 rounded-lg bg-emerald-600 text-white text-xs sm:text-sm font-bold hover:bg-emerald-700 transition-colors whitespace-nowrap"
              >
                <span>Save &amp; Next</span>
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </footer>
        </div>

        {/* Desktop Right Question Palette Sidebar */}
        <aside className="hidden xl:block w-[320px] border-s border-[var(--border-subtle)] shrink-0 h-full overflow-hidden">
          <CbtQuestionPalette
            section={activeSection}
            globalOffset={sectionGlobalOffset}
            activeQuestionId={activeQuestion.id}
            responses={session.responses}
            visitedQuestions={session.visitedQuestions}
            markedForReview={session.markedForReview}
            onSelectQuestion={(qId) =>
              navigateToQuestion(activeSection.id, qId)
            }
            onOpenSubmitModal={() => setSubmitModalOpen(true)}
          />
        </aside>
      </div>

      {/* Mobile Slide-Over Question Palette Drawer */}
      {mobilePaletteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Question palette drawer"
          className="xl:hidden fixed inset-0 z-50 flex justify-end"
        >
          <button
            type="button"
            aria-label="Close palette drawer"
            onClick={() => setMobilePaletteOpen(false)}
            className="fixed inset-0 bg-slate-950/55"
          />
          <div className="relative z-10 w-[310px] max-w-[88vw] h-[100dvh] flex flex-col bg-[var(--bg-surface)] border-s border-[var(--border-strong)] shadow-2xl">
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--border-subtle)]">
              <span className="text-xs font-bold text-[var(--text-main)]">
                Question Palette
              </span>
              <button
                type="button"
                aria-label="Close question palette"
                onClick={() => setMobilePaletteOpen(false)}
                className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <CbtQuestionPalette
                section={activeSection}
                globalOffset={sectionGlobalOffset}
                activeQuestionId={activeQuestion.id}
                responses={session.responses}
                visitedQuestions={session.visitedQuestions}
                markedForReview={session.markedForReview}
                onSelectQuestion={(qId) =>
                  navigateToQuestion(activeSection.id, qId)
                }
                onOpenSubmitModal={() => {
                  setMobilePaletteOpen(false);
                  setSubmitModalOpen(true);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Draggable Scientific / Basic Calculator */}
      {activeSet.calculator !== 'none' && (
        <CalculatorPopover
          mode={activeSet.calculator}
          open={calcOpen}
          onClose={() => setCalcOpen(false)}
        />
      )}

      {/* Keyboard Shortcuts Reference Modal */}
      {shortcutsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close keyboard shortcuts"
            onClick={() => setShortcutsOpen(false)}
            className="fixed inset-0 bg-slate-950/50"
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-xl space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[var(--text-main)]">
                CBT Keyboard Shortcuts
              </h2>
              <button
                type="button"
                aria-label="Close shortcuts dialog"
                onClick={() => setShortcutsOpen(false)}
                className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-[var(--bg-elevated)]"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-2 text-[var(--text-muted)] font-mono">
              <div className="flex justify-between">
                <span>Save &amp; Next</span>
                <kbd className="text-[var(--text-main)] font-bold">Alt + N / →</kbd>
              </div>
              <div className="flex justify-between">
                <span>Previous Question</span>
                <kbd className="text-[var(--text-main)] font-bold">←</kbd>
              </div>
              <div className="flex justify-between">
                <span>Mark for Review &amp; Next</span>
                <kbd className="text-[var(--text-main)] font-bold">Alt + M</kbd>
              </div>
              <div className="flex justify-between">
                <span>Clear Response</span>
                <kbd className="text-[var(--text-main)] font-bold">Alt + C</kbd>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Submit Exam Confirmation Summary Modal */}
      {submitModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm exam submission"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Cancel submission"
            onClick={() => setSubmitModalOpen(false)}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-[2px]"
          />
          <div className="relative z-10 w-full max-w-xl rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 sm:p-6 shadow-2xl space-y-5 tabular-nums">
            <div>
              <h2 className="text-lg font-extrabold text-[var(--text-main)]">
                Submit Exam &amp; View Official Score?
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-[var(--text-muted)]">
                Time Remaining:{' '}
                <strong className="font-mono text-[var(--text-main)]">
                  {formatCountdownClock(overallRemainingMs)}
                </strong>
                . Review your section-wise response summary below before final
                submission.
              </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
              <table className="w-full text-start border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] text-[var(--text-muted)] font-semibold">
                    <th className="py-2.5 px-3 text-start">Section</th>
                    <th className="py-2.5 px-3 text-end">Answered</th>
                    <th className="py-2.5 px-3 text-end">Ans &amp; Marked</th>
                    <th className="py-2.5 px-3 text-end">Not Answered</th>
                    <th className="py-2.5 px-3 text-end">Not Visited</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {activeSet.sections.map((sec) => {
                    const c = countSectionPaletteStates(
                      sec,
                      session.responses,
                      session.visitedQuestions,
                      session.markedForReview
                    );
                    return (
                      <tr key={sec.id}>
                        <td className="py-2.5 px-3 font-semibold text-[var(--text-main)]">
                          {sec.title}
                        </td>
                        <td className="py-2.5 px-3 text-end font-bold text-emerald-600">
                          {c.ANSWERED}
                        </td>
                        <td className="py-2.5 px-3 text-end font-bold text-violet-600">
                          {c.ANSWERED_AND_MARKED}
                        </td>
                        <td className="py-2.5 px-3 text-end font-semibold text-rose-600">
                          {c.NOT_ANSWERED + c.MARKED_FOR_REVIEW}
                        </td>
                        <td className="py-2.5 px-3 text-end text-[var(--text-muted)]">
                          {c.NOT_VISITED}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setSubmitModalOpen(false)}
                className="min-h-12 px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                Return to Questions
              </button>
              <button
                type="button"
                onClick={() => finalizeAndSubmit(session, activeSet)}
                className="min-h-12 px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-bold hover:opacity-90 transition-opacity"
              >
                Confirm &amp; Submit Exam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
