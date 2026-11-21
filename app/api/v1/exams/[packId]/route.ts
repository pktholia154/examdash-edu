import https from 'node:https';
import { NextRequest, NextResponse } from 'next/server';
import { verifyBearerIdToken } from '../../../../../server/firebase/verify-auth';
import { resolveExamPackUpstream } from '../../../../../server/repositories/catalog-repository';
import { buildFallbackExamSetsForPack } from '../../../../../lib/exam/benchmark-packs';
import type { ExamSet } from '../../../../../lib/exam/types';

const ALLOWED_STORAGE_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
]);

function fetchStorageJson(
  targetUrl: string,
  firebaseIdToken?: string | null
): Promise<{ statusCode: number; text: string }> {
  if (!targetUrl) {
    return Promise.resolve({ statusCode: 404, text: '' });
  }
  const parsed = new URL(targetUrl);
  if (
    parsed.protocol !== 'https:' ||
    !ALLOWED_STORAGE_HOSTS.has(parsed.hostname)
  ) {
    return Promise.reject(new Error('Disallowed upstream storage host.'));
  }

  const maxBytes = 16 * 1024 * 1024; // 16 MB JSON cap
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
  };

  if (firebaseIdToken && !parsed.searchParams.has('token')) {
    headers.Authorization = `Firebase ${firebaseIdToken}`;
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers,
        timeout: 15000,
      },
      (res) => {
        const statusCode = res.statusCode ?? 502;
        const chunks: Buffer[] = [];
        let received = 0;

        res.on('data', (chunk: Buffer) => {
          received += chunk.byteLength;
          if (received > maxBytes) {
            req.destroy(new Error('Exam JSON exceeded 16MB budget.'));
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          resolve({
            statusCode,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Exam JSON fetch timed out.'));
    });
    req.on('error', reject);
    req.end();
  });
}

function redactExamSetsForLiveAttempt(sets: ExamSet[]): ExamSet[] {
  return sets.map((s) => ({
    ...s,
    sections: (s.sections || []).map((sec) => ({
      ...sec,
      questions: (sec.questions || []).map((q) => ({
        ...q,
        answer: q.type === 'MSQ' ? [] : q.type === 'NAT' ? [0, 0] : '',
        explanation: '',
        explanationVisuals: [],
      })),
    })),
  }));
}

/**
 * Authenticated & Sample ExamSet[] Delivery Route (`/api/v1/exams/[packId]`)
 * - `mode=sample`: Delivers `sampleJsonStoragePath` (1st sample test) for instant "Try Free Sample" previews.
 * - `mode=full`: Strictly enforces Firebase Auth Bearer token + purchase ownership (or <= 15m HMAC grant)
 *   before delivering `fullJsonStoragePath` (`Cache-Control: private, no-store`).
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ packId: string }> }
) {
  const { packId } = await context.params;
  const sp = req.nextUrl.searchParams;
  const mode = sp.get('mode') === 'full' ? 'full' : 'sample';
  const redact = sp.get('redact') === '1';
  const setFilter = (sp.get('setId') || '').trim();
  const uid = (sp.get('uid') || '').trim();
  const expRaw = sp.get('exp') || '';
  const sig = (sp.get('sig') || '').trim();
  const expMs = expRaw ? Number(expRaw) : undefined;

  const authHeader = req.headers.get('authorization');
  let verifiedTokenUid: string | null = null;
  let rawBearerToken: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const candidate = authHeader.slice('Bearer '.length).trim();
    const decoded = await verifyBearerIdToken(authHeader);
    if (decoded?.uid) {
      verifiedTokenUid = decoded.uid;
      rawBearerToken = candidate;
    }
  }

  if (mode === 'full' && verifiedTokenUid && uid && verifiedTokenUid !== uid) {
    return NextResponse.json(
      { error: 'Signed exam grant UID mismatch.' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  try {
    const resolution = await resolveExamPackUpstream({
      packIdentifier: packId,
      mode,
      uid,
      expMs,
      sig,
      verifiedTokenUid,
      bearerIdToken: rawBearerToken,
    });

    if (resolution.status === 'unauthorized') {
      return NextResponse.json(
        {
          error: 'Sign in required to access full exam pack sets.',
          code: 'AUTH_REQUIRED',
        },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    if (resolution.status === 'forbidden') {
      return NextResponse.json(
        {
          error: 'Purchase entitlement required to unlock all exam sets.',
          code: 'PURCHASE_REQUIRED',
        },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    if (resolution.status === 'not_found') {
      return NextResponse.json(
        { error: 'Requested exam pack was not found.' },
        { status: 404, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    let sets: ExamSet[] | null = null;
    let streamSource = mode;

    if (resolution.target.upstreamUrl) {
      const upstream = await fetchStorageJson(
        resolution.target.upstreamUrl,
        rawBearerToken
      );

      if (upstream.statusCode >= 200 && upstream.statusCode < 300) {
        const parsed = JSON.parse(upstream.text) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          sets = parsed as ExamSet[];
        }
      } else if (
        mode === 'full' &&
        resolution.target.fallbackSampleUrl &&
        resolution.target.fallbackSampleUrl !== resolution.target.upstreamUrl
      ) {
        const fallbackUpstream = await fetchStorageJson(
          resolution.target.fallbackSampleUrl,
          rawBearerToken
        );
        if (
          fallbackUpstream.statusCode >= 200 &&
          fallbackUpstream.statusCode < 300
        ) {
          const parsed = JSON.parse(fallbackUpstream.text) as unknown;
          if (Array.isArray(parsed) && parsed.length > 0) {
            sets = parsed as ExamSet[];
            streamSource = 'sample-storage-fallback';
          }
        }
      }
    }

    // Resilient schema-exact benchmark fallback when Firebase Storage rules block anonymous sample access
    if (!sets || sets.length === 0) {
      sets = buildFallbackExamSetsForPack(
        resolution.target.mocktestTitles,
        mode
      );
      streamSource = `${mode}-benchmark-fallback`;
    }

    // In sample mode, expose strictly the 1st test as sample preview unless sample JSON specifically defines 1 set
    let effectiveSets =
      mode === 'sample' ? sets.slice(0, 1) : sets;

    if (setFilter) {
      const matched = effectiveSets.filter((s) => s.id === setFilter);
      if (matched.length > 0) {
        effectiveSets = matched;
      }
    }

    if (redact) {
      effectiveSets = redactExamSetsForLiveAttempt(effectiveSets);
    }

    const headers = new Headers();
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-ExamDash-Stream-Source', streamSource);
    headers.set(
      'Cache-Control',
      mode === 'sample' && !rawBearerToken
        ? 'public, max-age=60, s-maxage=300'
        : 'private, no-store'
    );

    return new NextResponse(JSON.stringify(effectiveSets), {
      status: 200,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to load exam set JSON.',
      },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}
