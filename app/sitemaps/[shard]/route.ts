import { NextRequest, NextResponse } from 'next/server';
import { getCanonicalOrigin } from '../../../lib/seo/schema';
import { resolveSitemapShardXml } from '../../../lib/seo/sitemaps';
import { getSitemapCatalogEntries } from '../../../server/repositories/catalog-repository';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ shard: string }> }
) {
  const { shard } = await context.params;
  const origin = getCanonicalOrigin();

  const [books, exams] = await Promise.all([
    getSitemapCatalogEntries('books').catch(() => []),
    getSitemapCatalogEntries('ExamPackDocument').catch(() => []),
  ]);

  const xml = resolveSitemapShardXml({
    rawShardParam: shard || '',
    books,
    exams,
    origin,
  });

  if (!xml) {
    return new NextResponse('Sitemap shard not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=60',
        'X-Robots-Tag': 'noindex',
      },
    });
  }

  const isUpdatesShard = shard.trim().toLowerCase() === 'updates.xml';

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': isUpdatesShard
        ? 'public, max-age=60, s-maxage=180, stale-while-revalidate=600, stale-if-error=86400'
        : 'public, max-age=60, s-maxage=300, stale-while-revalidate=900, stale-if-error=86400',
      'Surrogate-Key': `sitemaps catalog sitemap-${shard.toLowerCase()}`,
      'Cache-Tag': `sitemaps,catalog,sitemap-${shard.toLowerCase()}`,
      Vary: 'Accept-Encoding',
    },
  });
}
