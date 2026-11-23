import { NextResponse } from 'next/server';
import { getCanonicalOrigin } from '../../lib/seo/schema';
import { buildCatalogRssFeedXml } from '../../lib/seo/sitemaps';
import { getSitemapCatalogEntries } from '../../server/repositories/catalog-repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  const origin = getCanonicalOrigin();
  const [books, exams] = await Promise.all([
    getSitemapCatalogEntries('books').catch(() => []),
    getSitemapCatalogEntries('ExamPackDocument').catch(() => []),
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
      'Cache-Control':
        'public, max-age=60, s-maxage=180, stale-while-revalidate=600, stale-if-error=86400',
      'Surrogate-Key': 'feed catalog',
      'Cache-Tag': 'feed,catalog',
      Vary: 'Accept-Encoding',
    },
  });
}
