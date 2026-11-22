import https from 'node:https';
import { NextRequest, NextResponse } from 'next/server';
import { buildFirebaseStorageHeaders } from '../../../../../server/firebase/default-db-mirror';
import { verifyBearerIdToken } from '../../../../../server/firebase/verify-auth';
import { resolveBookStreamUpstream } from '../../../../../server/repositories/catalog-repository';

const ALLOWED_STORAGE_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
]);

interface UpstreamResponseMeta {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
}

function fetchUpstreamBytes(
  targetUrl: string,
  options: {
    rangeHeader?: string | null;
    firebaseIdToken?: string | null;
    maxBytes?: number;
  }
): Promise<UpstreamResponseMeta> {
  const parsed = new URL(targetUrl);
  if (parsed.protocol !== 'https:' || !ALLOWED_STORAGE_HOSTS.has(parsed.hostname)) {
    return Promise.reject(new Error('Disallowed upstream storage host.'));
  }

  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024; // 64 MB hard FinOps cap
  const reqHeaders = buildFirebaseStorageHeaders(
    options.firebaseIdToken,
    {
      Accept: '*/*',
      ...(options.rangeHeader ? { Range: options.rangeHeader } : {}),
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
        headers: reqHeaders,
        timeout: 25000,
      },
      (res) => {
        const statusCode = res.statusCode ?? 502;
        const chunks: Buffer[] = [];
        let received = 0;

        res.on('data', (chunk: Buffer) => {
          received += chunk.byteLength;
          if (received > maxBytes) {
            req.destroy(new Error('Upstream asset exceeded 64MB byte budget.'));
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          const headersOut: Record<string, string> = {};
          const copyNames = [
            'content-type',
            'content-length',
            'content-range',
            'accept-ranges',
            'etag',
          ];
          for (const h of copyNames) {
            const val = res.headers[h];
            if (typeof val === 'string' && val) {
              headersOut[h] = val;
            }
          }
          resolve({
            statusCode,
            headers: headersOut,
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Upstream storage fetch timed out.'));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Protected & CORS-Safe Media Stream Endpoint (/api/v1/library/stream)
 * - Supports `206 Partial Content` byte-range forwarding (`Range` / `Accept-Ranges: bytes`) for WebKit & mobile.
 * - Eliminates browser/Worker CORS blocks against `firebasestorage.googleapis.com`.
 * - Enforces <= 15m HMAC signature verification on `mode=full` streams so `fullPdfStoragePath`
 *   and `fullMarkdownStoragePath` never leak to public HTML, and NEVER substitutes sample files in full mode.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const slug = (sp.get('slug') || '').trim();
  const mode = sp.get('mode') === 'full' ? 'full' : 'sample';
  const format = sp.get('format') === 'pdf' ? 'pdf' : 'markdown';
  const uid = (sp.get('uid') || '').trim();
  const expRaw = sp.get('exp') || '';
  const sig = (sp.get('sig') || '').trim();
  const expMs = expRaw ? Number(expRaw) : undefined;

  if (!slug) {
    return NextResponse.json(
      { error: 'Book slug is required.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

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
      { error: 'Signed asset grant UID mismatch.' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  try {
    const resolution = await resolveBookStreamUpstream({
      urlSlug: slug,
      mode,
      format,
      uid,
      expMs,
      sig,
      verifiedTokenUid,
      bearerIdToken: rawBearerToken,
    });

    if (resolution.status === 'unauthorized') {
      return NextResponse.json(
        { error: 'Signed reader URL expired or invalid.', code: 'SIGNED_URL_EXPIRED' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    if (resolution.status === 'not_found') {
      return NextResponse.json(
        { error: 'Requested book stream was not found.' },
        { status: 404, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const rangeHeader = req.headers.get('range');
    let upstream = await fetchUpstreamBytes(resolution.target.upstreamUrl, {
      rangeHeader,
      firebaseIdToken: rawBearerToken,
    });

    // Single brief retry if `(default)` Firestore purchase mirror was just created milliseconds ago
    if (
      mode === 'full' &&
      rawBearerToken &&
      (upstream.statusCode === 401 || upstream.statusCode === 403)
    ) {
      await new Promise<void>((r) => setTimeout(r, 250));
      upstream = await fetchUpstreamBytes(resolution.target.upstreamUrl, {
        rangeHeader,
        firebaseIdToken: rawBearerToken,
      });
    }

    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      return NextResponse.json(
        {
          error: `Unable to stream full ${format.toUpperCase()} file from Firebase Storage (HTTP ${upstream.statusCode}).`,
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

    const responseHeaders = new Headers();
    responseHeaders.set(
      'Content-Type',
      upstream.headers['content-type'] || resolution.target.contentType
    );
    responseHeaders.set('Content-Length', String(upstream.body.byteLength));
    responseHeaders.set(
      'Accept-Ranges',
      upstream.headers['accept-ranges'] || 'bytes'
    );
    if (upstream.headers['content-range']) {
      responseHeaders.set('Content-Range', upstream.headers['content-range']);
    }
    responseHeaders.set('X-ExamDash-Stream-Source', mode);

    responseHeaders.set(
      'Cache-Control',
      mode === 'sample'
        ? 'private, max-age=300'
        : 'private, no-store'
    );
    responseHeaders.set('X-Content-Type-Options', 'nosniff');

    return new NextResponse(new Uint8Array(upstream.body), {
      status: upstream.statusCode === 206 ? 206 : 200,
      headers: responseHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to stream book asset.',
      },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}
