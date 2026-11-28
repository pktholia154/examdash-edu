import { NextRequest, NextResponse } from 'next/server';
import {
  getCanonicalOrigin,
  isDefaultFirebaseOrCloudRunHost,
} from '../../lib/seo/schema';
import {
  buildSitemapIndexXml,
  buildSitemapManifest,
} from '../../lib/seo/sitemaps';
import {
  getCachedSitemapCatalogEntries,
  getCachedSitemapCategoryEntries,
} from '../../server/cache/catalog-cache';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
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

  const manifest = buildSitemapManifest({ books, exams, categories, origin });
  const xml = buildSitemapIndexXml(manifest.shards);

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': isMirrorHost
        ? 'private, no-store'
        : 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400',
      'X-Robots-Tag': isMirrorHost ? 'noindex, nofollow' : 'noindex, follow',
      ...(isMirrorHost
        ? {}
        : {
            'Surrogate-Key': 'sitemaps catalog',
            'Cache-Tag': 'sitemaps,catalog',
          }),
      Vary: 'X-Forwarded-Host, Accept-Encoding',
    },
  });
}
