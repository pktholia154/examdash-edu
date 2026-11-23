import { NextRequest, NextResponse } from 'next/server';
import {
  getConfiguredIndexNowKey,
  submitIndexNowBatch,
  verifySeoWebhookSecret,
} from '../../../../../lib/seo/indexnow';
import { invalidateCatalogSitemapCache } from '../../../../../server/repositories/catalog-repository';

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
 * 1. Immediately invalidate in-memory sitemap & 410 tombstone caches on publish/update/delete.
 * 2. Dispatch canonical URLs (up to 10,000 per call) to `api.indexnow.org` for instant crawl discovery.
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

  let body: { urls?: unknown[]; invalidateOnly?: boolean } = {};
  try {
    body = (await req.json()) as { urls?: unknown[]; invalidateOnly?: boolean };
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request body.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  // Always purge in-memory sitemap & deleted-slug caches immediately
  invalidateCatalogSitemapCache();

  if (body.invalidateOnly === true) {
    return NextResponse.json(
      {
        ok: true,
        cacheInvalidated: true,
        dispatched: false,
        submittedCount: 0,
      },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const urls = Array.isArray(body.urls) ? body.urls : [];
  const result = await submitIndexNowBatch(urls);

  return NextResponse.json(
    {
      ok: result.statusCode < 400,
      cacheInvalidated: true,
      ...result,
    },
    {
      status: result.statusCode === 400 ? 400 : 200,
      headers: { 'Cache-Control': 'private, no-store' },
    }
  );
}
