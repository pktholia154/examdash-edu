import { NextRequest, NextResponse } from 'next/server';
import { verifyBearerIdToken } from '../../../../../server/firebase/verify-auth';
import {
  commitExamAttemptToFirestore,
  listUserExamAttemptsFromFirestore,
  updateExamAttemptFeedbackInFirestore,
} from '../../../../../server/repositories/exam-attempt-repository';
import type {
  AttemptFeedbackPatch,
  PacingFeedback,
  PerceivedDifficulty,
} from '../../../../../lib/exam/types';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-cache, no-store, max-age=0',
};

const anonProcessedIdempotencyKeys = new Set<string>();

function extractRawBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const raw = authHeader.slice('Bearer '.length).trim();
  return raw || null;
}

/**
 * GET `/api/v1/exams/attempts`
 * Lists historical exam attempts (section & question time telemetry, solution outcomes,
 * deterministic analysis, and learner feedback) from Firebase `/users/{uid}/examAttempts`.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const rawToken = extractRawBearerToken(authHeader);
  const decoded = await verifyBearerIdToken(authHeader);

  if (!decoded?.uid || !rawToken) {
    return NextResponse.json(
      { error: 'Authentication required to fetch historical exam attempts.' },
      { status: 401, headers: PRIVATE_HEADERS }
    );
  }

  const { searchParams } = new URL(req.url);
  const packId = searchParams.get('packId');
  const examSlug = searchParams.get('examSlug');
  const setId = searchParams.get('setId');
  const attemptId = searchParams.get('attemptId');

  try {
    const attempts = await listUserExamAttemptsFromFirestore({
      userId: decoded.uid,
      bearerIdToken: rawToken,
      packId,
      examSlug,
      setId,
      attemptId,
    });

    return NextResponse.json(
      { ok: true, attempts },
      { status: 200, headers: PRIVATE_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unable to fetch historical exam attempts.',
      },
      { status: 500, headers: PRIVATE_HEADERS }
    );
  }
}

/**
 * POST `/api/v1/exams/attempts`
 * Idempotently persists a completed exam set attempt with full section/question time telemetry,
 * responses, solution review snapshots, and diagnostic analysis to Firebase Firestore.
 */
export async function POST(req: NextRequest) {
  const idempotencyKey = (req.headers.get('idempotency-key') || '').trim();
  if (
    !idempotencyKey ||
    idempotencyKey.length < 5 ||
    idempotencyKey.length > 128
  ) {
    return NextResponse.json(
      { error: 'Valid Idempotency-Key header is required.' },
      { status: 400, headers: PRIVATE_HEADERS }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload.' },
      { status: 400, headers: PRIVATE_HEADERS }
    );
  }

  if (typeof body.setId !== 'string' || !body.setId.trim()) {
    return NextResponse.json(
      { error: 'setId is required.' },
      { status: 400, headers: PRIVATE_HEADERS }
    );
  }

  const authHeader = req.headers.get('authorization');
  const rawToken = extractRawBearerToken(authHeader);
  const decoded = rawToken ? await verifyBearerIdToken(authHeader) : null;

  // Signed-in learner: persist historically to `/users/{uid}/examAttempts/{attemptId}` in Firebase
  if (decoded?.uid && rawToken) {
    try {
      const result = await commitExamAttemptToFirestore({
        userId: decoded.uid,
        emailVerified: Boolean(decoded.email_verified),
        userDisplayName:
          typeof decoded.name === 'string' ? decoded.name : undefined,
        userEmail: decoded.email,
        userPhotoUrl:
          typeof decoded.picture === 'string' ? decoded.picture : undefined,
        bearerIdToken: rawToken,
        idempotencyKey,
        payload: body,
      });

      return NextResponse.json(
        {
          ok: true,
          persistedInFirebase: true,
          deduplicated: result.deduplicated,
          uid: decoded.uid,
          idempotencyKey: result.attempt.attemptId,
          attempt: result.attempt,
          syncedAtIso: new Date().toISOString(),
        },
        { status: 200, headers: PRIVATE_HEADERS }
      );
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : 'Failed to persist historical exam attempt in Firebase.',
        },
        { status: 500, headers: PRIVATE_HEADERS }
      );
    }
  }

  // Anonymous free-sample session: acknowledge local queue idempotently without polluting Firebase
  if (anonProcessedIdempotencyKeys.has(idempotencyKey)) {
    return NextResponse.json(
      { ok: true, persistedInFirebase: false, deduplicated: true, uid: null },
      { status: 200, headers: PRIVATE_HEADERS }
    );
  }
  if (anonProcessedIdempotencyKeys.size > 2000) {
    anonProcessedIdempotencyKeys.clear();
  }
  anonProcessedIdempotencyKeys.add(idempotencyKey);

  return NextResponse.json(
    {
      ok: true,
      persistedInFirebase: false,
      deduplicated: false,
      uid: null,
      idempotencyKey,
      syncedAtIso: new Date().toISOString(),
    },
    { status: 200, headers: PRIVATE_HEADERS }
  );
}

/**
 * PATCH `/api/v1/exams/attempts`
 * Saves or updates post-exam reflection & self-assessment feedback (`SaveAttemptFeedback`)
 * on an existing historical exam attempt in Firebase.
 */
export async function PATCH(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const rawToken = extractRawBearerToken(authHeader);
  const decoded = await verifyBearerIdToken(authHeader);

  if (!decoded?.uid || !rawToken) {
    return NextResponse.json(
      { error: 'Sign in with Google to save post-exam feedback to Firebase.' },
      { status: 401, headers: PRIVATE_HEADERS }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload.' },
      { status: 400, headers: PRIVATE_HEADERS }
    );
  }

  const attemptId =
    typeof body.attemptId === 'string' ? body.attemptId.trim() : '';
  if (!attemptId || attemptId.length < 5 || attemptId.length > 128) {
    return NextResponse.json(
      { error: 'Valid attemptId is required.' },
      { status: 400, headers: PRIVATE_HEADERS }
    );
  }

  const patch: AttemptFeedbackPatch = {};
  if ('perceivedDifficulty' in body) {
    patch.perceivedDifficulty =
      typeof body.perceivedDifficulty === 'string' && body.perceivedDifficulty
        ? (body.perceivedDifficulty as PerceivedDifficulty)
        : null;
  }
  if ('pacingFeedback' in body) {
    patch.pacingFeedback =
      typeof body.pacingFeedback === 'string' && body.pacingFeedback
        ? (body.pacingFeedback as PacingFeedback)
        : null;
  }
  if ('reflectionNote' in body) {
    patch.reflectionNote =
      typeof body.reflectionNote === 'string'
        ? body.reflectionNote.slice(0, 2000)
        : null;
  }

  try {
    const attempt = await updateExamAttemptFeedbackInFirestore({
      userId: decoded.uid,
      emailVerified: Boolean(decoded.email_verified),
      bearerIdToken: rawToken,
      attemptId,
      patch,
    });

    return NextResponse.json(
      { ok: true, attempt },
      { status: 200, headers: PRIVATE_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unable to save post-exam feedback.',
      },
      { status: 500, headers: PRIVATE_HEADERS }
    );
  }
}
