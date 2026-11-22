import https from 'node:https';
import { NextRequest, NextResponse } from 'next/server';
import { buildFirebaseStorageHeaders } from '../../../../../server/firebase/default-db-mirror';
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
  const headers = buildFirebaseStorageHeaders(
    firebaseIdToken,
    {
      Accept: 'application/json, text/plain, */*',
    },
    {
      omitAuthIfTokenParamPresent: true,
      targetUrl,
    }
  );

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

function normalizeExamSetsPayload(parsed: unknown): ExamSet[] {
  if (Array.isArray(parsed)) {
    return parsed as ExamSet[];
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.sets)) return obj.sets as ExamSet[];
    if (Array.isArray(obj.examSets)) return obj.examSets as ExamSet[];
    if (Array.isArray(obj.mocktests)) return obj.mocktests as ExamSet[];
    if (Array.isArray(obj.sections)) return [obj as unknown as ExamSet];
  }
  return [];
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
 *   before delivering `fullJsonStoragePath` (`Cache-Control: private, no-store`), never substituting sample sets.
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

    let sets: ExamSet[] = [];
    let streamSource: string = mode;

    if (resolution.target.upstreamUrl) {
      let upstream = await fetchStorageJson(
        resolution.target.upstreamUrl,
        rawBearerToken
      );

      if (
        mode === 'full' &&
        rawBearerToken &&
        (upstream.statusCode === 401 || upstream.statusCode === 403)
      ) {
        await new Promise<void>((r) => setTimeout(r, 250));
        upstream = await fetchStorageJson(
          resolution.target.upstreamUrl,
          rawBearerToken
        );
      }

      if (upstream.statusCode >= 200 && upstream.statusCode < 300) {
        const parsed = JSON.parse(upstream.text) as unknown;
        sets = normalizeExamSetsPayload(parsed);
      } else if (mode === 'full') {
        const storageMsg =
          upstream.statusCode === 401 || upstream.statusCode === 403
            ? `Firebase Storage bucket rules denied read access to the full exam JSON file (HTTP ${upstream.statusCode}).`
            : `Unable to load full exam JSON from Firebase Storage (HTTP ${upstream.statusCode}).`;
        return NextResponse.json(
          {
            error: storageMsg,
            code: 'UPSTREAM_STORAGE_ERROR',
            upstreamStatus: upstream.statusCode,
          },
          {
            status:
              upstream.statusCode === 404
                ? 404
                : upstream.statusCode === 401 || upstream.statusCode === 403
                ? 403
                : 502,
            headers: { 'Cache-Control': 'private, no-store' },
          }
        );
      }
    }

    // Only allow benchmark sample fallback in public `sample` mode when anonymous sample Storage rules block preview
    if (sets.length === 0) {
      if (mode === 'sample') {
        sets = buildFallbackExamSetsForPack(
          resolution.target.mocktestTitles,
          'sample'
        );
        streamSource = 'sample-benchmark-fallback';
      } else {
        return NextResponse.json(
          {
            error: 'Full exam pack JSON contained no valid exam sets.',
            code: 'EMPTY_EXAM_PACK',
          },
          { status: 404, headers: { 'Cache-Control': 'private, no-store' } }
        );
      }
    }

    // In sample mode, expose strictly the 1st test as sample preview
    let effectiveSets = mode === 'sample' ? sets.slice(0, 1) : sets;

    if (setFilter) {
      const matched = effectiveSets.filter((s) => s.id === setFilter);
      if (matched.length > 0) {
        effectiveSets = matched;
      } else if (mode === 'full') {
        // Match by 1-based set index if MocktestTitles IDs differ slightly from ExamSet.id inside fullJsonStoragePath
        const titleIndex = resolution.target.mocktestTitles.findIndex(
          (t) => t.id === setFilter
        );
        if (titleIndex >= 0 && titleIndex < effectiveSets.length) {
          effectiveSets = [effectiveSets[titleIndex]];
        }
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
