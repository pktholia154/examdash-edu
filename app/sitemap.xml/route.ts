import { NextResponse } from 'next/server';
import { BUSINESS_INFO, LEGAL_PAGES } from '../../lib/legal/business-info';
import { buildThumbUrls, getCanonicalOrigin } from '../../lib/seo/schema';
import {
  getLiveBooks,
  getLiveExams,
} from '../../server/repositories/catalog-repository';

export const dynamic = 'force-dynamic';

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface SitemapNode {
  loc: string;
  lastmod: string;
  changefreq: 'daily' | 'weekly' | 'monthly';
  priority: string;
  images?: Array<{ loc: string; title?: string }>;
}

export async function GET() {
  const origin = getCanonicalOrigin();
  const [books, exams] = await Promise.all([
    getLiveBooks().catch(() => []),
    getLiveExams().catch(() => []),
  ]);

  const latestCatalogMutation =
    [...books, ...exams]
      .map((i) => new Date(i.updatedAtIso).getTime())
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a)[0] || Date.now();

  const latestCatalogIso = new Date(latestCatalogMutation).toISOString();
  const legalLastModIso = new Date(BUSINESS_INFO.effectiveDateIso).toISOString();

  const nodes: SitemapNode[] = [
    {
      loc: origin,
      lastmod: latestCatalogIso,
      changefreq: 'daily',
      priority: '1.0',
    },
    {
      loc: `${origin}/books`,
      lastmod: latestCatalogIso,
      changefreq: 'daily',
      priority: '0.9',
    },
    {
      loc: `${origin}/exams`,
      lastmod: latestCatalogIso,
      changefreq: 'daily',
      priority: '0.9',
    },
    ...LEGAL_PAGES.map((page) => ({
      loc: `${origin}${page.href}`,
      lastmod: legalLastModIso,
      changefreq: 'monthly' as const,
      priority: '0.6',
    })),
  ];

  for (const book of books.slice(0, 2400)) {
    const { sqPngUrl, ogPngUrl } = buildThumbUrls(
      'books',
      book.urlSlug,
      book.updatedAtIso
    );
    nodes.push({
      loc: `${origin}/books/${book.urlSlug}`,
      lastmod: new Date(book.updatedAtIso).toISOString(),
      changefreq: 'weekly',
      priority: '0.8',
      images: [
        { loc: ogPngUrl, title: book.title },
        { loc: sqPngUrl, title: book.title },
      ],
    });
  }

  for (const exam of exams.slice(0, 2400)) {
    const { sqPngUrl, ogPngUrl } = buildThumbUrls(
      'exams',
      exam.urlSlug,
      exam.updatedAtIso
    );
    nodes.push({
      loc: `${origin}/exams/${exam.urlSlug}`,
      lastmod: new Date(exam.updatedAtIso).toISOString(),
      changefreq: 'weekly',
      priority: '0.8',
      images: [
        { loc: ogPngUrl, title: exam.title },
        { loc: sqPngUrl, title: exam.title },
      ],
    });
  }

  const urlBlocks = nodes
    .map((node) => {
      const imageXml = (node.images ?? [])
        .map(
          (img) => `    <image:image>
      <image:loc>${escapeXml(img.loc)}</image:loc>${
            img.title
              ? `\n      <image:title>${escapeXml(img.title)}</image:title>`
              : ''
          }
    </image:image>`
        )
        .join('\n');

      return `  <url>
    <loc>${escapeXml(node.loc)}</loc>
    <lastmod>${escapeXml(node.lastmod)}</lastmod>
    <changefreq>${node.changefreq}</changefreq>
    <priority>${node.priority}</priority>${imageXml ? `\n${imageXml}` : ''}
  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urlBlocks}
</urlset>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
}
