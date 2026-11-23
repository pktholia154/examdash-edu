import { BUSINESS_INFO, LEGAL_PAGES } from '../legal/business-info';
import type { SitemapCatalogEntry } from '../../server/repositories/catalog-repository';
import { getCanonicalOrigin } from './schema';

/**
 * Deterministic batch size per sitemap shard:
 * 1,000 canonical URLs per shard (~360 KB uncompressed XML including optional <image:image> tag),
 * strictly below Google's 50,000 URL / 50 MB limits and Pillar 4's <= 5,000 URL / < 400 KB target.
 */
export const SITEMAP_BATCH_SIZE = 1000;

/**
 * Dedicated high-priority freshness shard size:
 * Surfaces the 200 most recently published or updated products in `/sitemaps/updates.xml`
 * so Googlebot & Bingbot detect newly published/edited items on their very first poll.
 */
export const SITEMAP_RECENT_UPDATES_LIMIT = 200;

export interface SitemapImageEntry {
  loc: string;
  title?: string;
  caption?: string;
}

export interface SitemapUrlEntry {
  loc: string;
  lastmod: string;
  images?: SitemapImageEntry[];
}

export interface SitemapShardDescriptor {
  shardName: string;
  loc: string;
  lastmod: string;
}

export function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function normalizeIsoTimestamp(rawIso: string, fallbackIso: string): string {
  const ms = new Date(rawIso).getTime();
  if (Number.isFinite(ms) && ms > 0) {
    return new Date(ms).toISOString();
  }
  return fallbackIso;
}

export function computeMaxLastmodIso(
  isoTimestamps: string[],
  fallbackIso: string
): string {
  let maxMs = -1;
  for (const iso of isoTimestamps) {
    const ms = new Date(iso).getTime();
    if (Number.isFinite(ms) && ms > maxMs) {
      maxMs = ms;
    }
  }
  return maxMs > 0 ? new Date(maxMs).toISOString() : fallbackIso;
}

export function partitionIntoShards<T>(
  items: readonly T[],
  batchSize: number = SITEMAP_BATCH_SIZE
): T[][] {
  const safeBatchSize = Math.max(1, Math.min(5000, Math.floor(batchSize) || 1000));
  const shards: T[][] = [];
  for (let i = 0; i < items.length; i += safeBatchSize) {
    shards.push(items.slice(i, i + safeBatchSize));
  }
  return shards;
}

/**
 * Builds `<sitemapindex>` XML strictly adhering to Google Search Central guidelines
 * (only `<loc>` and deterministic `<lastmod>`).
 */
export function buildSitemapIndexXml(shards: readonly SitemapShardDescriptor[]): string {
  const blocks = shards
    .map(
      (shard) => `  <sitemap>
    <loc>${escapeXml(shard.loc)}</loc>
    <lastmod>${escapeXml(shard.lastmod)}</lastmod>
  </sitemap>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${blocks}
</sitemapindex>`;
}

/**
 * Builds `<urlset>` XML with `<image:image>` support and accurate `<lastmod>`,
 * intentionally omitting deprecated `<priority>` and `<changefreq>` tags per GSC policy.
 */
export function buildSitemapUrlsetXml(entries: readonly SitemapUrlEntry[]): string {
  const hasImages = entries.some((e) => (e.images?.length ?? 0) > 0);
  const imageNs = hasImages
    ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'
    : '';

  const blocks = entries
    .map((entry) => {
      const imageXml = (entry.images ?? [])
        .map(
          (img) => `    <image:image>
      <image:loc>${escapeXml(img.loc)}</image:loc>${
            img.title
              ? `\n      <image:title>${escapeXml(img.title)}</image:title>`
              : ''
          }${
            img.caption
              ? `\n      <image:caption>${escapeXml(img.caption)}</image:caption>`
              : ''
          }
    </image:image>`
        )
        .join('\n');

      return `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${escapeXml(entry.lastmod)}</lastmod>${imageXml ? `\n${imageXml}` : ''}
  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${imageNs}>
${blocks}
</urlset>`;
}

export function mapCatalogEntryToSitemapUrl(
  entry: SitemapCatalogEntry,
  origin: string = getCanonicalOrigin()
): SitemapUrlEntry {
  const collectionSegment = entry.collectionName === 'books' ? 'books' : 'exams';
  const fallbackIso = new Date(BUSINESS_INFO.effectiveDateIso).toISOString();
  const coverUrl = (entry.imageUrl || '').trim();

  return {
    loc: `${origin}/${collectionSegment}/${encodeURIComponent(entry.urlSlug)}`,
    lastmod: normalizeIsoTimestamp(entry.updatedAtIso, fallbackIso),
    ...(coverUrl
      ? {
          images: [
            {
              loc: coverUrl,
              title: entry.imageMeta?.title || entry.title,
              ...(entry.imageMeta?.caption || entry.imageMeta?.alt
                ? { caption: entry.imageMeta.caption || entry.imageMeta.alt }
                : {}),
            },
          ],
        }
      : {}),
  };
}

/**
 * Computes the complete manifest of active sitemap shards and their exact deterministic `<lastmod>`
 * timestamps from live `books` and `exams` entries.
 */
export function buildSitemapManifest(params: {
  books: readonly SitemapCatalogEntry[];
  exams: readonly SitemapCatalogEntry[];
  origin?: string;
}): {
  shards: SitemapShardDescriptor[];
  bookShards: SitemapCatalogEntry[][];
  examShards: SitemapCatalogEntry[][];
  recentUpdates: SitemapCatalogEntry[];
  pagesEntries: SitemapUrlEntry[];
} {
  const origin = params.origin || getCanonicalOrigin();
  const legalLastModIso = new Date(BUSINESS_INFO.effectiveDateIso).toISOString();

  const latestBooksIso = computeMaxLastmodIso(
    params.books.map((b) => b.updatedAtIso),
    legalLastModIso
  );
  const latestExamsIso = computeMaxLastmodIso(
    params.exams.map((e) => e.updatedAtIso),
    legalLastModIso
  );
  const latestOverallIso = computeMaxLastmodIso(
    [latestBooksIso, latestExamsIso, legalLastModIso],
    legalLastModIso
  );

  // Core hub + compliance pages (only include /books or /exams if non-empty, or keep hubs with accurate lastmod)
  const pagesEntries: SitemapUrlEntry[] = [
    { loc: origin, lastmod: latestOverallIso },
    ...(params.books.length > 0
      ? [{ loc: `${origin}/books`, lastmod: latestBooksIso }]
      : []),
    ...(params.exams.length > 0
      ? [{ loc: `${origin}/exams`, lastmod: latestExamsIso }]
      : []),
    ...LEGAL_PAGES.map((page) => ({
      loc: `${origin}${page.href}`,
      lastmod: legalLastModIso,
    })),
  ];

  // Recent updates shard sorted strictly by updatedAt DESC for rapid crawler freshness detection
  const recentUpdates = [...params.books, ...params.exams]
    .sort((a, b) => {
      const diff =
        new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime();
      if (diff !== 0) return diff;
      return (
        new Date(b.publishAtIso).getTime() - new Date(a.publishAtIso).getTime()
      );
    })
    .slice(0, SITEMAP_RECENT_UPDATES_LIMIT);

  const bookShards = partitionIntoShards(params.books, SITEMAP_BATCH_SIZE);
  const examShards = partitionIntoShards(params.exams, SITEMAP_BATCH_SIZE);

  const shards: SitemapShardDescriptor[] = [
    {
      shardName: 'pages.xml',
      loc: `${origin}/sitemaps/pages.xml`,
      lastmod: latestOverallIso,
    },
  ];

  if (recentUpdates.length > 0) {
    shards.push({
      shardName: 'updates.xml',
      loc: `${origin}/sitemaps/updates.xml`,
      lastmod: computeMaxLastmodIso(
        recentUpdates.map((u) => u.updatedAtIso),
        latestOverallIso
      ),
    });
  }

  bookShards.forEach((batch, idx) => {
    const shardName = `books-${idx + 1}.xml`;
    shards.push({
      shardName,
      loc: `${origin}/sitemaps/${shardName}`,
      lastmod: computeMaxLastmodIso(
        batch.map((b) => b.updatedAtIso),
        latestBooksIso
      ),
    });
  });

  examShards.forEach((batch, idx) => {
    const shardName = `exams-${idx + 1}.xml`;
    shards.push({
      shardName,
      loc: `${origin}/sitemaps/${shardName}`,
      lastmod: computeMaxLastmodIso(
        batch.map((e) => e.updatedAtIso),
        latestExamsIso
      ),
    });
  });

  return {
    shards,
    bookShards,
    examShards,
    recentUpdates,
    pagesEntries,
  };
}

/**
 * Resolves a specific `/sitemaps/[shard]` XML document or returns `null` if unknown / out of bounds.
 */
export function resolveSitemapShardXml(params: {
  rawShardParam: string;
  books: readonly SitemapCatalogEntry[];
  exams: readonly SitemapCatalogEntry[];
  origin?: string;
}): string | null {
  const origin = params.origin || getCanonicalOrigin();
  const shard = params.rawShardParam.trim().toLowerCase();
  const manifest = buildSitemapManifest({
    books: params.books,
    exams: params.exams,
    origin,
  });

  if (shard === 'pages.xml') {
    return buildSitemapUrlsetXml(manifest.pagesEntries);
  }

  if (shard === 'updates.xml') {
    if (manifest.recentUpdates.length === 0) return null;
    return buildSitemapUrlsetXml(
      manifest.recentUpdates.map((entry) =>
        mapCatalogEntryToSitemapUrl(entry, origin)
      )
    );
  }

  const bookMatch = shard.match(/^books-(\d+)\.xml$/);
  if (bookMatch) {
    const batchNum = Number(bookMatch[1]);
    if (!Number.isInteger(batchNum) || batchNum < 1) return null;
    const batch = manifest.bookShards[batchNum - 1];
    if (!batch || batch.length === 0) return null;
    return buildSitemapUrlsetXml(
      batch.map((entry) => mapCatalogEntryToSitemapUrl(entry, origin))
    );
  }

  const examMatch = shard.match(/^exams-(\d+)\.xml$/);
  if (examMatch) {
    const batchNum = Number(examMatch[1]);
    if (!Number.isInteger(batchNum) || batchNum < 1) return null;
    const batch = manifest.examShards[batchNum - 1];
    if (!batch || batch.length === 0) return null;
    return buildSitemapUrlsetXml(
      batch.map((entry) => mapCatalogEntryToSitemapUrl(entry, origin))
    );
  }

  return null;
}

/**
 * Builds an RSS 2.0 + Atom `<atom:link>` + `<atom:updated>` feed of the latest 100
 * published/updated catalog products, enabling Googlebot and AI retrieval crawlers
 * to detect newly published items between full sitemap crawls.
 */
export function buildCatalogRssFeedXml(params: {
  books: readonly SitemapCatalogEntry[];
  exams: readonly SitemapCatalogEntry[];
  origin?: string;
  limit?: number;
}): string {
  const origin = params.origin || getCanonicalOrigin();
  const maxItems = Math.max(1, Math.min(200, params.limit ?? 100));
  const fallbackIso = new Date(BUSINESS_INFO.effectiveDateIso).toISOString();

  const latestItems = [...params.books, ...params.exams]
    .sort((a, b) => {
      const diff =
        new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime();
      if (diff !== 0) return diff;
      return (
        new Date(b.publishAtIso).getTime() - new Date(a.publishAtIso).getTime()
      );
    })
    .slice(0, maxItems);

  const lastBuildIso = computeMaxLastmodIso(
    latestItems.map((i) => i.updatedAtIso),
    fallbackIso
  );
  const lastBuildRfc = new Date(lastBuildIso).toUTCString();

  const itemBlocks = latestItems
    .map((item) => {
      const collectionSegment =
        item.collectionName === 'books' ? 'books' : 'exams';
      const itemUrl = `${origin}/${collectionSegment}/${encodeURIComponent(
        item.urlSlug
      )}`;
      const coverUrl = (item.imageUrl || '').trim();
      const pubRfc = new Date(
        normalizeIsoTimestamp(item.publishAtIso, fallbackIso)
      ).toUTCString();
      const updatedIso = normalizeIsoTimestamp(item.updatedAtIso, fallbackIso);
      const summary =
        item.seoDescription ||
        `${item.title} (${item.type}) by ${item.authorName} on ExamDash.`;

      return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(itemUrl)}</link>
      <guid isPermaLink="true">${escapeXml(itemUrl)}</guid>
      <pubDate>${escapeXml(pubRfc)}</pubDate>
      <atom:updated>${escapeXml(updatedIso)}</atom:updated>
      <category>${escapeXml(item.type)}</category>
      <description>${escapeXml(summary)}</description>${
        coverUrl
          ? `\n      <enclosure url="${escapeXml(coverUrl)}" type="image/png" length="0" />`
          : ''
      }
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ExamDash — Latest Books &amp; Mock Exam Packs</title>
    <link>${escapeXml(origin)}</link>
    <description>Newly published and updated digital books, question banks, and full-length mock test packs on ExamDash.</description>
    <language>en-in</language>
    <lastBuildDate>${escapeXml(lastBuildRfc)}</lastBuildDate>
    <atom:link href="${escapeXml(`${origin}/feed.xml`)}" rel="self" type="application/rss+xml" />
${itemBlocks}
  </channel>
</rss>`;
}
