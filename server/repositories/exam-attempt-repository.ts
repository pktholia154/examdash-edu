import https from 'node:https';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  AttemptFeedbackPatch,
  AttemptPerformanceInsights,
  HistoricalExamAttemptRecord,
  PacingFeedback,
  PerceivedDifficulty,
  QuestionAttemptSnapshotItem,
  QuestionTelemetry,
  SectionAnalyticsItem,
} from '../../lib/exam/types';

type FirestoreRestValue = Record<string, unknown>;
type FirestoreRestFieldMap = Record<string, FirestoreRestValue>;

const VALID_DIFFICULTIES = new Set<PerceivedDifficulty>([
  'easy',
  'moderate',
  'challenging',
  'tough',
]);

const VALID_PACING = new Set<PacingFeedback>([
  'comfortable',
  'balanced',
  'rushed',
  'time_shortage',
]);

function getFirestoreDbResourceRoot(): {
  projectId: string;
  databaseId: string;
  docPrefix: string;
  restBase: string;
} {
  const projectId = firebaseConfig.projectId || 'examdash-ed';
  const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
  const docPrefix = `projects/${projectId}/databases/${databaseId}/documents`;
  const restBase = `/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(databaseId)}/documents`;
  return { projectId, databaseId, docPrefix, restBase };
}

function firestoreRestRequest<T>(params: {
  method: 'GET' | 'POST';
  path: string;
  bearerIdToken: string;
  body?: Record<string, unknown>;
}): Promise<{ statusCode: number; data: T | null; rawText: string }> {
  const payload = params.body ? JSON.stringify(params.body) : undefined;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: params.path,
        method: params.method,
        headers: {
          Authorization: `Bearer ${params.bearerIdToken}`,
          Accept: 'application/json',
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
        timeout: 12000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const rawText = Buffer.concat(chunks).toString('utf8');
          const statusCode = res.statusCode || 500;
          let data: T | null = null;
          try {
            data = rawText ? (JSON.parse(rawText) as T) : null;
          } catch {
            // Non-JSON response body
          }
          resolve({ statusCode, data, rawText });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Firestore exam attempt request timed out.'));
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function sanitizeBoundedString(
  val: unknown,
  maxLen: number,
  fallback: string
): string {
  const trimmed = typeof val === 'string' ? val.trim() : String(val ?? '').trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLen);
}

function sanitizeFirestoreId(
  val: unknown,
  fallback: string,
  minLen = 1,
  maxLen = 128
): string {
  const cleaned = String(val ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, maxLen);
  if (cleaned.length >= minLen) return cleaned;
  return fallback;
}

function sanitizeSlug(val: unknown, fallback = 'exam-pack'): string {
  const cleaned = String(val ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
  return cleaned || fallback;
}

function clampInt(val: unknown, min: number, max: number, fallback = 0): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampFloat(
  val: unknown,
  min: number,
  max: number,
  fallback = 0
): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Number(n.toFixed(2))));
}

function sanitizeIsoString(val: unknown, fallbackIso: string): string {
  if (typeof val === 'string' && val.trim().length >= 10) {
    const ms = Date.parse(val);
    if (Number.isFinite(ms)) {
      return new Date(ms).toISOString();
    }
  }
  return fallbackIso;
}

function toRestGenericValue(val: unknown, depth = 0): FirestoreRestValue {
  if (val === null || val === undefined || depth > 4) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { doubleValue: 0 };
    return Number.isInteger(val)
      ? { integerValue: String(val) }
      : { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val.slice(0, 1000) };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.slice(0, 50).map((v) => toRestGenericValue(v, depth + 1)),
      },
    };
  }
  if (typeof val === 'object') {
    const fields: FirestoreRestFieldMap = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>).slice(
      0,
      30
    )) {
      if (v !== undefined) {
        fields[k.slice(0, 128)] = toRestGenericValue(v, depth + 1);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val).slice(0, 500) };
}

function parseRestValue(val: FirestoreRestValue | undefined): unknown {
  if (!val || typeof val !== 'object') return undefined;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('stringValue' in val) return String(val.stringValue);
  if ('timestampValue' in val) return String(val.timestampValue);
  if ('arrayValue' in val) {
    const arrObj = val.arrayValue as { values?: FirestoreRestValue[] } | undefined;
    if (!arrObj || !Array.isArray(arrObj.values)) return [];
    return arrObj.values.map((item) => parseRestValue(item));
  }
  if ('mapValue' in val) {
    const mapObj = val.mapValue as
      | { fields?: FirestoreRestFieldMap }
      | undefined;
    return parseRestFields(mapObj?.fields);
  }
  return undefined;
}

function parseRestFields(
  fields: FirestoreRestFieldMap | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [k, v] of Object.entries(fields)) {
    out[k] = parseRestValue(v);
  }
  return out;
}

function serializeSectionBreakdownItem(
  sec: Partial<SectionAnalyticsItem>,
  idx: number
): FirestoreRestValue {
  const fields: FirestoreRestFieldMap = {
    sectionId: {
      stringValue: sanitizeBoundedString(
        sec.sectionId,
        120,
        `section_${idx + 1}`
      ),
    },
    sectionTitle: {
      stringValue: sanitizeBoundedString(
        sec.sectionTitle,
        200,
        `Section ${idx + 1}`
      ),
    },
    totalQuestions: {
      integerValue: String(clampInt(sec.totalQuestions, 0, 500, 0)),
    },
    maxAttempts:
      typeof sec.maxAttempts === 'number' && Number.isFinite(sec.maxAttempts)
        ? { integerValue: String(clampInt(sec.maxAttempts, 1, 500, 1)) }
        : { nullValue: null },
    maxMarks: { doubleValue: clampFloat(sec.maxMarks, 0, 10000, 0) },
    score: { doubleValue: clampFloat(sec.score, -10000, 10000, 0) },
    attempted: { integerValue: String(clampInt(sec.attempted, 0, 500, 0)) },
    correct: { integerValue: String(clampInt(sec.correct, 0, 500, 0)) },
    partial: { integerValue: String(clampInt(sec.partial, 0, 500, 0)) },
    wrong: { integerValue: String(clampInt(sec.wrong, 0, 500, 0)) },
    unattempted: { integerValue: String(clampInt(sec.unattempted, 0, 500, 0)) },
    accuracyPct: { doubleValue: clampFloat(sec.accuracyPct, 0, 100, 0) },
    attemptPct: { doubleValue: clampFloat(sec.attemptPct, 0, 100, 0) },
    timeSpentMs: {
      integerValue: String(clampInt(sec.timeSpentMs, 0, 86400000, 0)),
    },
    negativeMarksLost: {
      doubleValue: clampFloat(sec.negativeMarksLost, 0, 10000, 0),
    },
  };
  return { mapValue: { fields } };
}

function serializeQuestionBreakdownItem(
  q: Partial<QuestionAttemptSnapshotItem>,
  idx: number
): FirestoreRestValue {
  const validStatuses = new Set(['UNATTEMPTED', 'CORRECT', 'PARTIAL', 'WRONG']);
  const status = validStatuses.has(String(q.status))
    ? String(q.status)
    : 'UNATTEMPTED';
  const validTypes = new Set(['MCQ', 'MSQ', 'NAT']);
  const qType = validTypes.has(String(q.type)) ? String(q.type) : 'MCQ';

  const fields: FirestoreRestFieldMap = {
    questionId: {
      stringValue: sanitizeBoundedString(q.questionId, 120, `q_${idx + 1}`),
    },
    questionNumber: {
      integerValue: String(clampInt(q.questionNumber, 1, 500, idx + 1)),
    },
    sectionId: {
      stringValue: sanitizeBoundedString(q.sectionId, 120, 'section_1'),
    },
    sectionTitle: {
      stringValue: sanitizeBoundedString(q.sectionTitle, 200, 'Section 1'),
    },
    type: { stringValue: qType },
    status: { stringValue: status },
    marksAwarded: { doubleValue: clampFloat(q.marksAwarded, -1000, 1000, 0) },
    positiveMarksPossible: {
      doubleValue: clampFloat(q.positiveMarksPossible, 0, 1000, 1),
    },
    negativePenaltyPossible: {
      doubleValue: clampFloat(q.negativePenaltyPossible, 0, 1000, 0),
    },
    ignoredByCap: { booleanValue: Boolean(q.ignoredByCap) },
    timeSpentMs: {
      integerValue: String(clampInt(q.timeSpentMs, 0, 86400000, 0)),
    },
    visits: { integerValue: String(clampInt(q.visits, 0, 10000, 0)) },
    markedForReview: { booleanValue: Boolean(q.markedForReview) },
    userAnswerSummary: {
      stringValue: sanitizeBoundedString(
        q.userAnswerSummary,
        120,
        status === 'UNATTEMPTED' ? 'Unattempted' : 'Recorded'
      ),
    },
    correctAnswerSummary: {
      stringValue: sanitizeBoundedString(q.correctAnswerSummary, 120, '—'),
    },
  };
  return { mapValue: { fields } };
}

function serializePerformanceInsights(
  raw: Partial<AttemptPerformanceInsights> | undefined,
  fallbackSummary: string
): FirestoreRestValue {
  const rawTakeaways = Array.isArray(raw?.actionableTakeaways)
    ? raw.actionableTakeaways
        .map((t) => sanitizeBoundedString(t, 400, ''))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const safeTakeaways =
    rawTakeaways.length > 0
      ? rawTakeaways
      : ['Inspect Question-by-Question Solution Review to reinforce core concepts.'];

  const fields: FirestoreRestFieldMap = {
    pacingVerdict: {
      stringValue: sanitizeBoundedString(
        raw?.pacingVerdict,
        80,
        'Balanced Exam Pacing'
      ),
    },
    negativeMarkingImpactPct: {
      doubleValue: clampFloat(raw?.negativeMarkingImpactPct, 0, 1000, 0),
    },
    slowQuestionsCount: {
      integerValue: String(clampInt(raw?.slowQuestionsCount, 0, 500, 0)),
    },
    markedUnattemptedCount: {
      integerValue: String(clampInt(raw?.markedUnattemptedCount, 0, 500, 0)),
    },
    diagnosticSummary: {
      stringValue: sanitizeBoundedString(
        raw?.diagnosticSummary,
        1500,
        fallbackSummary
      ),
    },
    actionableTakeaways: {
      arrayValue: {
        values: safeTakeaways.map((t) => ({ stringValue: t })),
      },
    },
  };

  const strongestTitle = sanitizeBoundedString(
    raw?.strongestSectionTitle,
    200,
    ''
  );
  if (strongestTitle) {
    fields.strongestSectionTitle = { stringValue: strongestTitle };
    fields.strongestSectionAccuracyPct = {
      doubleValue: clampFloat(raw?.strongestSectionAccuracyPct, 0, 100, 0),
    };
  }

  const focusTitle = sanitizeBoundedString(raw?.focusSectionTitle, 200, '');
  if (focusTitle) {
    fields.focusSectionTitle = { stringValue: focusTitle };
    fields.focusSectionAccuracyPct = {
      doubleValue: clampFloat(raw?.focusSectionAccuracyPct, 0, 100, 0),
    };
  }

  return { mapValue: { fields } };
}

function buildAttemptRestFields(params: {
  userId: string;
  attemptId: string;
  payload: Record<string, unknown>;
}): FirestoreRestFieldMap {
  const { userId, attemptId, payload } = params;
  const nowIso = new Date().toISOString();

  const packId = sanitizeFirestoreId(payload.packId, 'exam_pack', 1, 128);
  const examSlug = sanitizeSlug(payload.examSlug, 'exam-pack');
  const examTitle = sanitizeBoundedString(
    payload.examTitle,
    300,
    'Mock Exam Series'
  );
  const setId = sanitizeFirestoreId(payload.setId, 'exam_set_1', 1, 128);
  const setTitle = sanitizeBoundedString(payload.setTitle, 300, 'Mock Test Set');
  const mode: 'trial' | 'full' = payload.mode === 'trial' ? 'trial' : 'full';

  const totalQuestions = clampInt(payload.totalQuestions, 1, 500, 1);
  const totalAttempted = clampInt(
    payload.totalAttempted,
    0,
    totalQuestions,
    0
  );
  const totalCorrect = clampInt(payload.totalCorrect, 0, totalAttempted, 0);
  const totalPartial = clampInt(payload.totalPartial, 0, totalAttempted, 0);
  const totalWrong = clampInt(
    payload.totalWrong,
    0,
    totalAttempted,
    Math.max(0, totalAttempted - totalCorrect - totalPartial)
  );
  const totalUnattempted = clampInt(
    payload.totalUnattempted,
    0,
    totalQuestions,
    Math.max(0, totalQuestions - totalAttempted)
  );

  const totalScore = clampFloat(payload.totalScore, -10000, 10000, 0);
  const maxScore = clampFloat(
    payload.maxScore,
    0,
    10000,
    Math.max(0, totalScore)
  );
  const computedScorePct =
    maxScore > 0 ? Math.max(0, (totalScore / maxScore) * 100) : 0;
  const scorePct = clampFloat(payload.scorePct, 0, 100, computedScorePct);
  const accuracyPct = clampFloat(payload.accuracyPct, 0, 100, 0);
  const computedAttemptPct =
    totalQuestions > 0 ? (totalAttempted / totalQuestions) * 100 : 0;
  const attemptPct = clampFloat(payload.attemptPct, 0, 100, computedAttemptPct);

  const positiveMarksEarned = clampFloat(
    payload.positiveMarksEarned,
    0,
    10000,
    Math.max(0, totalScore)
  );
  const negativeMarksLost = clampFloat(payload.negativeMarksLost, 0, 10000, 0);
  const totalTimeSpentMs = clampInt(payload.totalTimeSpentMs, 0, 86400000, 0);
  const avgTimePerAttemptedMs = clampInt(
    payload.avgTimePerAttemptedMs,
    0,
    86400000,
    totalAttempted > 0 ? Math.round(totalTimeSpentMs / totalAttempted) : 0
  );

  // Responses map (<= 500 keys)
  const rawResponses =
    payload.responses && typeof payload.responses === 'object'
      ? (payload.responses as Record<string, unknown>)
      : {};
  const responseFields: FirestoreRestFieldMap = {};
  for (const [qId, ans] of Object.entries(rawResponses).slice(0, 500)) {
    if (ans !== undefined) {
      responseFields[qId.slice(0, 128)] = toRestGenericValue(ans);
    }
  }

  // Telemetry map (<= 500 keys)
  const rawTelemetry =
    payload.telemetry && typeof payload.telemetry === 'object'
      ? (payload.telemetry as Record<string, QuestionTelemetry>)
      : {};
  const telemetryFields: FirestoreRestFieldMap = {};
  for (const [qId, tel] of Object.entries(rawTelemetry).slice(0, 500)) {
    if (tel && typeof tel === 'object') {
      telemetryFields[qId.slice(0, 128)] = {
        mapValue: {
          fields: {
            timeSpentMs: {
              integerValue: String(clampInt(tel.timeSpentMs, 0, 86400000, 0)),
            },
            visits: {
              integerValue: String(clampInt(tel.visits, 0, 10000, 0)),
            },
          },
        },
      };
    }
  }

  // MarkedForReview map (<= 500 keys)
  const rawMarked =
    payload.markedForReview && typeof payload.markedForReview === 'object'
      ? (payload.markedForReview as Record<string, unknown>)
      : {};
  const markedFields: FirestoreRestFieldMap = {};
  for (const [qId, flag] of Object.entries(rawMarked).slice(0, 500)) {
    if (flag) {
      markedFields[qId.slice(0, 128)] = { booleanValue: true };
    }
  }

  // Section breakdown list (1..30 items)
  const rawSections = Array.isArray(payload.sectionBreakdown)
    ? (payload.sectionBreakdown as Partial<SectionAnalyticsItem>[]).slice(0, 30)
    : [];
  const sectionValues =
    rawSections.length > 0
      ? rawSections.map((s, i) => serializeSectionBreakdownItem(s, i))
      : [
          serializeSectionBreakdownItem(
            {
              sectionId: 'overall',
              sectionTitle: setTitle,
              totalQuestions,
              maxAttempts: null,
              maxMarks: maxScore,
              score: totalScore,
              attempted: totalAttempted,
              correct: totalCorrect,
              partial: totalPartial,
              wrong: totalWrong,
              unattempted: totalUnattempted,
              accuracyPct,
              attemptPct,
              timeSpentMs: totalTimeSpentMs,
              negativeMarksLost,
            },
            0
          ),
        ];

  // Question breakdown list (1..500 items)
  const rawQuestions = Array.isArray(payload.questionBreakdown)
    ? (payload.questionBreakdown as Partial<QuestionAttemptSnapshotItem>[]).slice(
        0,
        500
      )
    : [];
  const questionValues =
    rawQuestions.length > 0
      ? rawQuestions.map((q, i) => serializeQuestionBreakdownItem(q, i))
      : [
          serializeQuestionBreakdownItem(
            {
              questionId: 'q_1',
              questionNumber: 1,
              sectionId: 'overall',
              sectionTitle: setTitle,
              type: 'MCQ',
              status: totalCorrect > 0 ? 'CORRECT' : 'UNATTEMPTED',
              marksAwarded: totalScore,
              positiveMarksPossible: maxScore,
              negativePenaltyPossible: 0,
              ignoredByCap: false,
              timeSpentMs: totalTimeSpentMs,
              visits: 1,
              markedForReview: false,
              userAnswerSummary: 'Recorded',
              correctAnswerSummary: '—',
            },
            0
          ),
        ];

  const completedAtIso = sanitizeIsoString(payload.completedAtIso, nowIso);
  const startedAtIso = sanitizeIsoString(payload.startedAtIso, completedAtIso);
  const fallbackSummary = `Scored ${totalScore} / ${maxScore} (${accuracyPct}% accuracy) across ${totalAttempted} of ${totalQuestions} questions.`;

  const fields: FirestoreRestFieldMap = {
    attemptId: { stringValue: attemptId },
    userId: { stringValue: userId },
    packId: { stringValue: packId },
    examSlug: { stringValue: examSlug },
    examTitle: { stringValue: examTitle },
    setId: { stringValue: setId },
    setTitle: { stringValue: setTitle },
    mode: { stringValue: mode },
    totalScore: { doubleValue: totalScore },
    maxScore: { doubleValue: maxScore },
    scorePct: { doubleValue: scorePct },
    accuracyPct: { doubleValue: accuracyPct },
    attemptPct: { doubleValue: attemptPct },
    totalQuestions: { integerValue: String(totalQuestions) },
    totalAttempted: { integerValue: String(totalAttempted) },
    totalCorrect: { integerValue: String(totalCorrect) },
    totalPartial: { integerValue: String(totalPartial) },
    totalWrong: { integerValue: String(totalWrong) },
    totalUnattempted: { integerValue: String(totalUnattempted) },
    positiveMarksEarned: { doubleValue: positiveMarksEarned },
    negativeMarksLost: { doubleValue: negativeMarksLost },
    totalTimeSpentMs: { integerValue: String(totalTimeSpentMs) },
    avgTimePerAttemptedMs: { integerValue: String(avgTimePerAttemptedMs) },
    responses: { mapValue: { fields: responseFields } },
    telemetry: { mapValue: { fields: telemetryFields } },
    markedForReview: { mapValue: { fields: markedFields } },
    sectionBreakdown: { arrayValue: { values: sectionValues } },
    questionBreakdown: { arrayValue: { values: questionValues } },
    performanceInsights: serializePerformanceInsights(
      payload.performanceInsights as
        | Partial<AttemptPerformanceInsights>
        | undefined,
      fallbackSummary
    ),
    startedAtIso: { stringValue: startedAtIso },
    completedAtIso: { stringValue: completedAtIso },
  };

  if (
    typeof payload.perceivedDifficulty === 'string' &&
    VALID_DIFFICULTIES.has(payload.perceivedDifficulty as PerceivedDifficulty)
  ) {
    fields.perceivedDifficulty = { stringValue: payload.perceivedDifficulty };
  }

  if (
    typeof payload.pacingFeedback === 'string' &&
    VALID_PACING.has(payload.pacingFeedback as PacingFeedback)
  ) {
    fields.pacingFeedback = { stringValue: payload.pacingFeedback };
  }

  if (
    typeof payload.reflectionNote === 'string' &&
    payload.reflectionNote.trim().length > 0
  ) {
    fields.reflectionNote = {
      stringValue: payload.reflectionNote.trim().slice(0, 2000),
    };
  }

  return fields;
}

function parseExamAttemptDoc(
  docName: string,
  fields: FirestoreRestFieldMap | undefined,
  fallbackUserId: string
): HistoricalExamAttemptRecord | null {
  if (!fields) return null;
  const segments = docName.split('/');
  const docId = segments[segments.length - 1] || '';
  const d = parseRestFields(fields);

  const attemptId = String(d.attemptId || docId).trim();
  const setId = String(d.setId || '').trim();
  if (!attemptId || !setId) return null;

  const rawInsights =
    d.performanceInsights && typeof d.performanceInsights === 'object'
      ? (d.performanceInsights as Record<string, unknown>)
      : {};

  const performanceInsights: AttemptPerformanceInsights = {
    ...(typeof rawInsights.strongestSectionTitle === 'string' &&
    rawInsights.strongestSectionTitle
      ? {
          strongestSectionTitle: rawInsights.strongestSectionTitle,
          strongestSectionAccuracyPct: Number(
            rawInsights.strongestSectionAccuracyPct ?? 0
          ),
        }
      : {}),
    ...(typeof rawInsights.focusSectionTitle === 'string' &&
    rawInsights.focusSectionTitle
      ? {
          focusSectionTitle: rawInsights.focusSectionTitle,
          focusSectionAccuracyPct: Number(
            rawInsights.focusSectionAccuracyPct ?? 0
          ),
        }
      : {}),
    pacingVerdict: String(rawInsights.pacingVerdict || 'Balanced Exam Pacing'),
    negativeMarkingImpactPct: Number(
      rawInsights.negativeMarkingImpactPct ?? 0
    ),
    slowQuestionsCount: Number(rawInsights.slowQuestionsCount ?? 0),
    markedUnattemptedCount: Number(rawInsights.markedUnattemptedCount ?? 0),
    diagnosticSummary: String(rawInsights.diagnosticSummary || ''),
    actionableTakeaways: Array.isArray(rawInsights.actionableTakeaways)
      ? rawInsights.actionableTakeaways.map((t) => String(t))
      : [],
  };

  const completedAtIso = String(
    d.completedAtIso || d.createdAt || new Date().toISOString()
  );
  const startedAtIso = String(d.startedAtIso || completedAtIso);
  const updatedAtIso = String(d.updatedAt || completedAtIso);

  const rawResponses =
    d.responses && typeof d.responses === 'object'
      ? (d.responses as Record<string, unknown>)
      : {};
  const rawTelemetryObj =
    d.telemetry && typeof d.telemetry === 'object'
      ? (d.telemetry as Record<string, Record<string, unknown>>)
      : {};
  const telemetry: Record<string, QuestionTelemetry> = {};
  for (const [qId, tVal] of Object.entries(rawTelemetryObj)) {
    if (tVal && typeof tVal === 'object') {
      telemetry[qId] = {
        timeSpentMs: Number(tVal.timeSpentMs ?? 0),
        visits: Number(tVal.visits ?? 0),
      };
    }
  }

  const rawMarkedObj =
    d.markedForReview && typeof d.markedForReview === 'object'
      ? (d.markedForReview as Record<string, unknown>)
      : {};
  const markedForReview: Record<string, boolean> = {};
  for (const [qId, flag] of Object.entries(rawMarkedObj)) {
    if (flag) markedForReview[qId] = true;
  }

  const sectionBreakdown: SectionAnalyticsItem[] = Array.isArray(
    d.sectionBreakdown
  )
    ? (d.sectionBreakdown as Array<Record<string, unknown>>).map((s, idx) => ({
        sectionId: String(s.sectionId || `section_${idx + 1}`),
        sectionTitle: String(s.sectionTitle || `Section ${idx + 1}`),
        totalQuestions: Number(s.totalQuestions ?? 0),
        maxAttempts:
          typeof s.maxAttempts === 'number' ? Number(s.maxAttempts) : null,
        maxMarks: Number(s.maxMarks ?? 0),
        score: Number(s.score ?? 0),
        attempted: Number(s.attempted ?? 0),
        correct: Number(s.correct ?? 0),
        partial: Number(s.partial ?? 0),
        wrong: Number(s.wrong ?? 0),
        unattempted: Number(s.unattempted ?? 0),
        accuracyPct: Number(s.accuracyPct ?? 0),
        attemptPct: Number(s.attemptPct ?? 0),
        timeSpentMs: Number(s.timeSpentMs ?? 0),
        negativeMarksLost: Number(s.negativeMarksLost ?? 0),
      }))
    : [];

  const questionBreakdown: QuestionAttemptSnapshotItem[] = Array.isArray(
    d.questionBreakdown
  )
    ? (d.questionBreakdown as Array<Record<string, unknown>>).map((q, idx) => ({
        questionId: String(q.questionId || `q_${idx + 1}`),
        questionNumber: Number(q.questionNumber ?? idx + 1),
        sectionId: String(q.sectionId || 'section_1'),
        sectionTitle: String(q.sectionTitle || 'Section 1'),
        type:
          q.type === 'MSQ' || q.type === 'NAT'
            ? q.type
            : ('MCQ' as const),
        status:
          q.status === 'CORRECT' ||
          q.status === 'PARTIAL' ||
          q.status === 'WRONG'
            ? q.status
            : ('UNATTEMPTED' as const),
        marksAwarded: Number(q.marksAwarded ?? 0),
        positiveMarksPossible: Number(q.positiveMarksPossible ?? 0),
        negativePenaltyPossible: Number(q.negativePenaltyPossible ?? 0),
        ignoredByCap: Boolean(q.ignoredByCap),
        timeSpentMs: Number(q.timeSpentMs ?? 0),
        visits: Number(q.visits ?? 0),
        markedForReview: Boolean(q.markedForReview),
        userAnswerSummary: String(q.userAnswerSummary || '—'),
        correctAnswerSummary: String(q.correctAnswerSummary || '—'),
      }))
    : [];

  return {
    attemptId,
    idempotencyKey: attemptId,
    userId: String(d.userId || fallbackUserId),
    packId: String(d.packId || ''),
    examSlug: String(d.examSlug || ''),
    examTitle: String(d.examTitle || 'Mock Exam'),
    setId,
    setTitle: String(d.setTitle || 'Mock Set'),
    mode: d.mode === 'trial' ? 'trial' : 'full',
    totalScore: Number(d.totalScore ?? 0),
    maxScore: Number(d.maxScore ?? 0),
    scorePct: Number(d.scorePct ?? 0),
    accuracyPct: Number(d.accuracyPct ?? 0),
    attemptPct: Number(d.attemptPct ?? 0),
    totalQuestions: Number(d.totalQuestions ?? 0),
    totalAttempted: Number(d.totalAttempted ?? 0),
    totalCorrect: Number(d.totalCorrect ?? 0),
    totalPartial: Number(d.totalPartial ?? 0),
    totalWrong: Number(d.totalWrong ?? 0),
    totalUnattempted: Number(d.totalUnattempted ?? 0),
    positiveMarksEarned: Number(d.positiveMarksEarned ?? 0),
    negativeMarksLost: Number(d.negativeMarksLost ?? 0),
    totalTimeSpentMs: Number(d.totalTimeSpentMs ?? 0),
    avgTimePerAttemptedMs: Number(d.avgTimePerAttemptedMs ?? 0),
    responses: rawResponses,
    telemetry,
    markedForReview,
    sectionBreakdown,
    questionBreakdown,
    performanceInsights,
    ...(typeof d.perceivedDifficulty === 'string' &&
    VALID_DIFFICULTIES.has(d.perceivedDifficulty as PerceivedDifficulty)
      ? { perceivedDifficulty: d.perceivedDifficulty as PerceivedDifficulty }
      : {}),
    ...(typeof d.pacingFeedback === 'string' &&
    VALID_PACING.has(d.pacingFeedback as PacingFeedback)
      ? { pacingFeedback: d.pacingFeedback as PacingFeedback }
      : {}),
    ...(typeof d.reflectionNote === 'string' && d.reflectionNote.length > 0
      ? { reflectionNote: d.reflectionNote }
      : {}),
    startedAtIso,
    completedAtIso,
    updatedAtIso,
    synced: true,
  };
}

export async function commitExamAttemptToFirestore(params: {
  userId: string;
  emailVerified: boolean;
  userDisplayName?: string | null;
  userEmail?: string | null;
  userPhotoUrl?: string | null;
  bearerIdToken: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}): Promise<{
  deduplicated: boolean;
  attempt: HistoricalExamAttemptRecord;
}> {
  if (!params.emailVerified) {
    throw new Error('Verified Google email is required to save exam attempts.');
  }

  const { docPrefix, restBase } = getFirestoreDbResourceRoot();
  const uid = params.userId;
  const attemptId = sanitizeFirestoreId(
    params.idempotencyKey || params.payload.attemptId,
    `att_${Date.now()}`,
    5,
    128
  );

  const [userRes, existingAttemptRes] = await Promise.all([
    firestoreRestRequest<{ fields?: FirestoreRestFieldMap }>({
      method: 'GET',
      path: `${restBase}/users/${encodeURIComponent(uid)}`,
      bearerIdToken: params.bearerIdToken,
    }),
    firestoreRestRequest<{ name?: string; fields?: FirestoreRestFieldMap }>({
      method: 'GET',
      path: `${restBase}/users/${encodeURIComponent(
        uid
      )}/examAttempts/${encodeURIComponent(attemptId)}`,
      bearerIdToken: params.bearerIdToken,
    }),
  ]);

  if (existingAttemptRes.statusCode === 200 && existingAttemptRes.data?.fields) {
    const parsedExisting = parseExamAttemptDoc(
      existingAttemptRes.data.name || attemptId,
      existingAttemptRes.data.fields,
      uid
    );
    if (parsedExisting) {
      return { deduplicated: true, attempt: parsedExisting };
    }
  }

  const writes: Array<Record<string, unknown>> = [];

  if (userRes.statusCode !== 200) {
    const profileFields: FirestoreRestFieldMap = {
      uid: { stringValue: uid },
      displayName: {
        stringValue: sanitizeBoundedString(
          params.userDisplayName || params.userEmail?.split('@')[0],
          120,
          'ExamDash Learner'
        ),
      },
      preferredView: { stringValue: 'grid' },
    };
    const safePhoto = sanitizeBoundedString(params.userPhotoUrl, 1024, '');
    if (safePhoto) {
      profileFields.photoURL = { stringValue: safePhoto };
    }
    writes.push({
      update: {
        name: `${docPrefix}/users/${uid}`,
        fields: profileFields,
      },
      currentDocument: { exists: false },
      updateTransforms: [
        { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
    });
  }

  const attemptFields = buildAttemptRestFields({
    userId: uid,
    attemptId,
    payload: params.payload,
  });

  writes.push({
    update: {
      name: `${docPrefix}/users/${uid}/examAttempts/${attemptId}`,
      fields: attemptFields,
    },
    currentDocument: { exists: false },
    updateTransforms: [
      { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
      { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
    ],
  });

  const commitRes = await firestoreRestRequest({
    method: 'POST',
    path: `${restBase}:commit`,
    bearerIdToken: params.bearerIdToken,
    body: { writes },
  });

  if (commitRes.statusCode < 200 || commitRes.statusCode >= 300) {
    throw new Error(
      `Failed to save historical exam attempt in Firestore (HTTP ${commitRes.statusCode}): ${commitRes.rawText.slice(
        0,
        240
      )}`
    );
  }

  const parsedSaved = parseExamAttemptDoc(attemptId, attemptFields, uid);
  if (!parsedSaved) {
    throw new Error('Saved exam attempt failed post-commit normalization.');
  }
  return { deduplicated: false, attempt: parsedSaved };
}

export async function listUserExamAttemptsFromFirestore(params: {
  userId: string;
  bearerIdToken: string;
  packId?: string | null;
  examSlug?: string | null;
  setId?: string | null;
  attemptId?: string | null;
}): Promise<HistoricalExamAttemptRecord[]> {
  const { restBase } = getFirestoreDbResourceRoot();
  const uid = params.userId;

  if (params.attemptId) {
    const cleanId = sanitizeFirestoreId(params.attemptId, '', 5, 128);
    if (!cleanId) return [];
    const singleRes = await firestoreRestRequest<{
      name?: string;
      fields?: FirestoreRestFieldMap;
    }>({
      method: 'GET',
      path: `${restBase}/users/${encodeURIComponent(
        uid
      )}/examAttempts/${encodeURIComponent(cleanId)}`,
      bearerIdToken: params.bearerIdToken,
    }).catch(() => null);

    if (singleRes?.statusCode === 200 && singleRes.data?.fields) {
      const parsed = parseExamAttemptDoc(
        singleRes.data.name || cleanId,
        singleRes.data.fields,
        uid
      );
      return parsed && parsed.userId === uid ? [parsed] : [];
    }
    return [];
  }

  const queryRes = await firestoreRestRequest<
    Array<{
      document?: {
        name?: string;
        fields?: FirestoreRestFieldMap;
      };
    }>
  >({
    method: 'POST',
    path: `${restBase}/users/${encodeURIComponent(uid)}:runQuery`,
    bearerIdToken: params.bearerIdToken,
    body: {
      structuredQuery: {
        from: [{ collectionId: 'examAttempts' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'userId' },
            op: 'EQUAL',
            value: { stringValue: uid },
          },
        },
        limit: 200,
      },
    },
  }).catch(() => null);

  if (
    !queryRes ||
    queryRes.statusCode < 200 ||
    queryRes.statusCode >= 300 ||
    !Array.isArray(queryRes.data)
  ) {
    return [];
  }

  const out: HistoricalExamAttemptRecord[] = [];
  for (const row of queryRes.data) {
    if (!row?.document?.name) continue;
    const parsed = parseExamAttemptDoc(
      row.document.name,
      row.document.fields,
      uid
    );
    if (!parsed || parsed.userId !== uid) continue;
    if (
      params.packId &&
      parsed.packId !== params.packId &&
      params.examSlug &&
      parsed.examSlug !== params.examSlug
    ) {
      continue;
    }
    if (params.packId && !params.examSlug && parsed.packId !== params.packId) {
      continue;
    }
    if (params.examSlug && !params.packId && parsed.examSlug !== params.examSlug) {
      continue;
    }
    if (params.setId && parsed.setId !== params.setId) {
      continue;
    }
    out.push(parsed);
  }

  out.sort(
    (a, b) =>
      new Date(b.completedAtIso).getTime() -
      new Date(a.completedAtIso).getTime()
  );

  return out;
}

export async function updateExamAttemptFeedbackInFirestore(params: {
  userId: string;
  emailVerified: boolean;
  bearerIdToken: string;
  attemptId: string;
  patch: AttemptFeedbackPatch;
}): Promise<HistoricalExamAttemptRecord> {
  if (!params.emailVerified) {
    throw new Error('Verified Google email is required to update feedback.');
  }

  const { docPrefix, restBase } = getFirestoreDbResourceRoot();
  const uid = params.userId;
  const cleanAttemptId = sanitizeFirestoreId(params.attemptId, '', 5, 128);
  if (!cleanAttemptId) {
    throw new Error('Valid attemptId is required.');
  }

  const existingRes = await firestoreRestRequest<{
    name?: string;
    fields?: FirestoreRestFieldMap;
  }>({
    method: 'GET',
    path: `${restBase}/users/${encodeURIComponent(
      uid
    )}/examAttempts/${encodeURIComponent(cleanAttemptId)}`,
    bearerIdToken: params.bearerIdToken,
  });

  if (existingRes.statusCode !== 200 || !existingRes.data?.fields) {
    throw new Error('Historical exam attempt record not found in Firebase.');
  }

  // Preserve all immutable fields & createdAt verbatim so SaveAttemptFeedback diff passes strictly
  const updatedFields: FirestoreRestFieldMap = {
    ...existingRes.data.fields,
  };
  delete updatedFields.updatedAt;

  if (params.patch.perceivedDifficulty !== undefined) {
    if (
      params.patch.perceivedDifficulty &&
      VALID_DIFFICULTIES.has(params.patch.perceivedDifficulty)
    ) {
      updatedFields.perceivedDifficulty = {
        stringValue: params.patch.perceivedDifficulty,
      };
    } else {
      delete updatedFields.perceivedDifficulty;
    }
  }

  if (params.patch.pacingFeedback !== undefined) {
    if (
      params.patch.pacingFeedback &&
      VALID_PACING.has(params.patch.pacingFeedback)
    ) {
      updatedFields.pacingFeedback = {
        stringValue: params.patch.pacingFeedback,
      };
    } else {
      delete updatedFields.pacingFeedback;
    }
  }

  if (params.patch.reflectionNote !== undefined) {
    const trimmed = (params.patch.reflectionNote ?? '').trim().slice(0, 2000);
    if (trimmed.length > 0) {
      updatedFields.reflectionNote = { stringValue: trimmed };
    } else {
      delete updatedFields.reflectionNote;
    }
  }

  const commitRes = await firestoreRestRequest({
    method: 'POST',
    path: `${restBase}:commit`,
    bearerIdToken: params.bearerIdToken,
    body: {
      writes: [
        {
          update: {
            name: `${docPrefix}/users/${uid}/examAttempts/${cleanAttemptId}`,
            fields: updatedFields,
          },
          currentDocument: { exists: true },
          updateTransforms: [
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        },
      ],
    },
  });

  if (commitRes.statusCode < 200 || commitRes.statusCode >= 300) {
    throw new Error(
      `Failed to save post-exam feedback (HTTP ${commitRes.statusCode}).`
    );
  }

  const parsed = parseExamAttemptDoc(
    cleanAttemptId,
    {
      ...updatedFields,
      updatedAt: { timestampValue: new Date().toISOString() },
    },
    uid
  );
  if (!parsed) {
    throw new Error('Updated exam attempt failed normalization.');
  }
  return parsed;
}
