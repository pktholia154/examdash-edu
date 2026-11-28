import { NextRequest, NextResponse } from 'next/server';
import { verifySeoWebhookSecret } from '../../../../../lib/seo/indexnow';
import { executePublishWebhookPipeline } from '../../../../../lib/seo/publish-webhook';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

/**
 * Authenticated publishing & cache-warming webhook (`POST /api/v1/seo/publish`):
 * 1. Validates payload via Zod (`PublishWebhookPayloadSchema`).
 * 2. Purges infinite Next.js server caches (`revalidatePath` + `revalidateTag`) and sitemap/tombstone caches.
 * 3. Immediately pre-fetches live URLs, catalog hubs, and sitemaps ahead of Googlebot / AI crawlers.
 * 4. Dispatches canonical URL notifications to IndexNow.
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
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request body.' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const outcome = await executePublishWebhookPipeline(rawBody);

  if (!outcome.ok && outcome.error) {
    return NextResponse.json(
      { error: outcome.error, details: outcome.details },
      { status: outcome.statusCode, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(
    {
      ok: outcome.ok,
      cacheInvalidated: outcome.cacheInvalidated,
      revalidatedPaths: outcome.revalidatedPaths,
      prewarmedCount: outcome.prewarmed?.length ?? 0,
      prewarmed: outcome.prewarmed,
      ...(outcome.indexNow ?? {}),
    },
    { status: outcome.statusCode, headers: NO_STORE_HEADERS }
  );
}
