import { NextResponse } from 'next/server';
import { getCanonicalOrigin } from '../../lib/seo/schema';
import {
  buildSitemapIndexXml,
  buildSitemapManifest,
} from '../../lib/seo/sitemaps';
import { getSitemapCatalogEntries } from '../../server/repositories/catalog-repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  const origin = getCanonicalOrigin();
  const [books, exams] = await Promise.all([
    getSitemapCatalogEntries('books').catch(() => []),
    getSitemapCatalogEntries('ExamPackDocument').catch(() => []),
  ]);

  const manifest = buildSitemapManifest({ books, exams, origin });
  const xml = buildSitemapIndexXml(manifest.shards);

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control':
        'public, max-age=60, s-maxage=300, stale-while-revalidate=600, stale-if-error=86400',
      'Surrogate-Key': 'sitemaps catalog',
      'Cache-Tag': 'sitemaps,catalog',
      Vary: 'Accept-Encoding',
    },
  });
}
