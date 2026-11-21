import { NextRequest, NextResponse } from 'next/server';
import { verifyBearerIdToken } from '../../../../../server/firebase/verify-auth';

const processedIdempotencyKeys = new Set<string>();

/**
 * Idempotent Exam Attempt Telemetry Sync Endpoint (`/api/v1/exams/attempts`)
 * Accepts UUIDv7 `Idempotency-Key` mutations from online & offline CBT sessions.
 */
export async function POST(req: NextRequest) {
  const idempotencyKey = (req.headers.get('idempotency-key') || '').trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return NextResponse.json(
      { error: 'Valid Idempotency-Key header is required.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const authHeader = req.headers.get('authorization');
  let uid: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const decoded = await verifyBearerIdToken(authHeader);
    uid = decoded?.uid ?? null;
  }

  if (processedIdempotencyKeys.has(idempotencyKey)) {
    return NextResponse.json(
      { ok: true, deduplicated: true, uid },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  if (typeof body.setId !== 'string' || !body.setId.trim()) {
    return NextResponse.json(
      { error: 'setId is required.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  if (processedIdempotencyKeys.size > 2000) {
    processedIdempotencyKeys.clear();
  }
  processedIdempotencyKeys.add(idempotencyKey);

  return NextResponse.json(
    {
      ok: true,
      deduplicated: false,
      uid,
      idempotencyKey,
      syncedAtIso: new Date().toISOString(),
    },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
  );
}
