import { NextRequest, NextResponse } from 'next/server';
import {
  getCanonicalOrigin,
  isDefaultFirebaseOrCloudRunHost,
} from '../../lib/seo/schema';
import { buildCatalogRssFeedXml } from '../../lib/seo/sitemaps';
import { getCachedSitemapCatalogEntries } from '../../server/cache/catalog-cache';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const host = (
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    ''
  ).toLowerCase();
  const isMirrorHost = isDefaultFirebaseOrCloudRunHost(host);
  const origin = getCanonicalOrigin();
  const [books, exams] = await Promise.all([
    getCachedSitemapCatalogEntries('books').catch(() => []),
    getCachedSitemapCatalogEntries('ExamPackDocument').catch(() => []),
  ]);

  const xml = buildCatalogRssFeedXml({
    books,
    exams,
    origin,
    limit: 100,
  });

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': isMirrorHost
        ? 'private, no-store'
        : 'public, max-age=60, s-maxage=900, stale-while-revalidate=86400, stale-if-error=86400',
      'X-Robots-Tag': isMirrorHost ? 'noindex, nofollow' : 'noindex, follow',
      ...(isMirrorHost
        ? {}
        : {
            'Surrogate-Key': 'feed catalog',
            'Cache-Tag': 'feed,catalog',
          }),
      Vary: 'X-Forwarded-Host, Accept-Encoding',
    },
  });
}
