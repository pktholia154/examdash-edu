import { NextRequest, NextResponse } from 'next/server';
import {
  getConfiguredIndexNowKey,
  verifySeoWebhookSecret,
} from '../../../../../lib/seo/indexnow';
import { executePublishWebhookPipeline } from '../../../../../lib/seo/publish-webhook';

export const dynamic = 'force-dynamic';

/**
 * Serves the plain-text IndexNow domain verification key when rewritten from `/{INDEXNOW_KEY}.txt`.
 */
export async function GET(req: NextRequest) {
  const configuredKey = getConfiguredIndexNowKey();
  const requestedKey = (req.nextUrl.searchParams.get('verifyKey') || '').trim();

  if (!configuredKey || requestedKey !== configuredKey) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=60',
        'X-Robots-Tag': 'noindex',
      },
    });
  }

  return new NextResponse(configuredKey, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'X-Robots-Tag': 'noindex',
    },
  });
}

/**
 * Authenticated publishing webhook (`POST /api/v1/seo/indexnow`) to:
 * 1. Validate webhook payload with Zod and purge in-memory + Next.js (`revalidate = false`) server caches.
 * 2. Immediately pre-fetch live URLs & sitemaps ahead of bots.
 * 3. Dispatch canonical URLs (up to 10,000 per call) to `api.indexnow.org` for instant crawl discovery.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const headerSecret = req.headers.get('x-webhook-secret') || '';

  if (!verifySeoWebhookSecret(bearerToken || headerSecret)) {
    return NextResponse.json(
      { error: 'Unauthorized webhook caller.' },
      {
        status: 401,
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Robots-Tag': 'noindex, nofollow',
        },
      }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request body.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const outcome = await executePublishWebhookPipeline(rawBody);

  if (!outcome.ok && outcome.error) {
    return NextResponse.json(
      { error: outcome.error, details: outcome.details },
      {
        status: outcome.statusCode,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }

  return NextResponse.json(
    {
      ok: outcome.ok,
      cacheInvalidated: outcome.cacheInvalidated,
      revalidatedPaths: outcome.revalidatedPaths,
      prewarmedCount: outcome.prewarmed?.length ?? 0,
      ...(outcome.indexNow ?? {}),
    },
    {
      status: outcome.statusCode,
      headers: { 'Cache-Control': 'private, no-store' },
    }
  );
}
