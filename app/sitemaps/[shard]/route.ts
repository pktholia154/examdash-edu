import { NextRequest, NextResponse } from 'next/server';
import {
  getCanonicalOrigin,
  isDefaultFirebaseOrCloudRunHost,
} from '../../../lib/seo/schema';
import { resolveSitemapShardXml } from '../../../lib/seo/sitemaps';
import {
  getCachedSitemapCatalogEntries,
  getCachedSitemapCategoryEntries,
} from '../../../server/cache/catalog-cache';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ shard: string }> }
) {
  const { shard } = await context.params;
  const host = (
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    ''
  ).toLowerCase();
  const isMirrorHost = isDefaultFirebaseOrCloudRunHost(host);
  const origin = getCanonicalOrigin();

  const [books, exams, categories] = await Promise.all([
    getCachedSitemapCatalogEntries('books').catch(() => []),
    getCachedSitemapCatalogEntries('ExamPackDocument').catch(() => []),
    getCachedSitemapCategoryEntries().catch(() => []),
  ]);

  const xml = resolveSitemapShardXml({
    rawShardParam: shard || '',
    books,
    exams,
    categories,
    origin,
  });

  if (!xml) {
    return new NextResponse('Sitemap shard not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': isMirrorHost
          ? 'private, no-store'
          : 'public, max-age=0, s-maxage=60',
        'X-Robots-Tag': isMirrorHost ? 'noindex, nofollow' : 'noindex',
        Vary: 'X-Forwarded-Host, Accept-Encoding',
      },
    });
  }

  const isUpdatesShard = shard.trim().toLowerCase() === 'updates.xml';

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': isMirrorHost
        ? 'private, no-store'
        : isUpdatesShard
        ? 'public, max-age=60, s-maxage=900, stale-while-revalidate=86400, stale-if-error=86400'
        : 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400',
      'X-Robots-Tag': isMirrorHost ? 'noindex, nofollow' : 'noindex, follow',
      ...(isMirrorHost
        ? {}
        : {
            'Surrogate-Key': `sitemaps catalog sitemap-${shard.toLowerCase()}`,
            'Cache-Tag': `sitemaps,catalog,sitemap-${shard.toLowerCase()}`,
          }),
      Vary: 'X-Forwarded-Host, Accept-Encoding',
    },
  });
}
