import { revalidatePath, revalidateTag } from 'next/cache';
import { invalidateCatalogSitemapCache } from '../../server/repositories/catalog-repository';
import {
  formatZodIssues,
  PublishWebhookPayloadSchema,
} from '../validation/cms-ingestion';
import {
  sanitizeCanonicalUrlBatch,
  submitIndexNowBatch,
  type IndexNowDispatchResult,
} from './indexnow';
import { getCanonicalOrigin } from './schema';

const MAX_PREWARM_CONCURRENCY = 4;
const MAX_PREWARM_URLS = 25;
const PREWARM_TIMEOUT_MS = 5000;

export interface PrewarmOutcome {
  url: string;
  status: number;
  ok: boolean;
}

export interface PublishWebhookExecutionResult {
  ok: boolean;
  statusCode: number;
  error?: string;
  details?: string[];
  cacheInvalidated?: boolean;
  revalidatedPaths?: string[];
  prewarmed?: PrewarmOutcome[];
  indexNow?: IndexNowDispatchResult;
}

/**
 * SSRF-hardened pre-warmer: strictly fetches canonical `https://` URLs belonging to
 * `getCanonicalOrigin()` with `redirect: 'manual'`, zero cookies, and a 5s timeout
 * so Next.js `revalidate = false` Full Route Cache and CDN edge cache are warm ahead of bots.
 */
export async function prewarmCanonicalUrls(
  candidateUrls: readonly string[],
  origin: string = getCanonicalOrigin()
): Promise<PrewarmOutcome[]> {
  const safeUrls = sanitizeCanonicalUrlBatch(candidateUrls, origin).slice(
    0,
    MAX_PREWARM_URLS
  );
  if (safeUrls.length === 0) return [];

  const canonicalHost = new URL(origin).host;
  const outcomes: PrewarmOutcome[] = [];

  for (let i = 0; i < safeUrls.length; i += MAX_PREWARM_CONCURRENCY) {
    const chunk = safeUrls.slice(i, i + MAX_PREWARM_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (targetUrl): Promise<PrewarmOutcome> => {
        let parsed: URL;
        try {
          parsed = new URL(targetUrl);
        } catch {
          return { url: targetUrl, status: 0, ok: false };
        }

        // Strict SSRF host & protocol confinement
        if (parsed.protocol !== 'https:' || parsed.host !== canonicalHost) {
          return { url: targetUrl, status: 0, ok: false };
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PREWARM_TIMEOUT_MS);
        try {
          const res = await fetch(parsed.toString(), {
            method: 'GET',
            redirect: 'manual',
            cache: 'no-store',
            signal: controller.signal,
            headers: {
              Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'User-Agent': 'ExamDash-Prewarmer/1.0 (+https://exam-dash.com)',
            },
          });
          // Drain body so Next.js finishes streaming/caching the full HTML payload
          await res.arrayBuffer().catch(() => undefined);
          return {
            url: parsed.toString(),
            status: res.status,
            ok: res.status >= 200 && res.status < 400,
          };
        } catch {
          return { url: parsed.toString(), status: 0, ok: false };
        } finally {
          clearTimeout(timer);
        }
      })
    );
    outcomes.push(...chunkResults);
  }

  return outcomes;
}

/**
 * Executes the full Zod-validated publish/update/delete pipeline:
 * 1. Validates payload via `PublishWebhookPayloadSchema`.
 * 2. Purges in-memory sitemap & tombstone caches + Next.js `revalidateTag` / `revalidatePath`.
 * 3. Immediately pre-fetches live canonical URLs, hubs, and sitemaps ahead of search/AI bots.
 * 4. Dispatches canonical URL batch to IndexNow.
 */
export async function executePublishWebhookPipeline(
  rawBody: unknown,
  options?: { skipPrewarmInTests?: boolean }
): Promise<PublishWebhookExecutionResult> {
  const parsed = PublishWebhookPayloadSchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Invalid publish webhook payload.',
      details: formatZodIssues(parsed.error),
    };
  }

  const payload = parsed.data;
  const origin = getCanonicalOrigin();

  // 1. Purge in-memory sitemap & deleted-slug caches immediately
  invalidateCatalogSitemapCache();

  const itemPathsToRevalidate = new Set<string>();
  const livePathsToPrewarm = new Set<string>();
  const allAffectedUrls: unknown[] = [...(payload.urls ?? [])];

  for (const item of payload.items ?? []) {
    const cleanSlug = item.urlSlug.trim().replace(/^\/+|\/+$/g, '');
    if (!cleanSlug) continue;

    if (item.collectionName === 'category') {
      const catPath = `/books/category/${encodeURIComponent(cleanSlug)}`;
      itemPathsToRevalidate.add(catPath);
      allAffectedUrls.push(`${origin}${catPath}`);
      if (item.action !== 'delete') {
        livePathsToPrewarm.add(catPath);
      }
      try {
        revalidateTag('categories');
        revalidateTag(`category:${cleanSlug}`);
      } catch {
        // Safe outside Next.js request context
      }
      continue;
    }

    const hubSegment = item.collectionName === 'books' ? 'books' : 'exams';
    const detailPath = `/${hubSegment}/${encodeURIComponent(cleanSlug)}`;
    itemPathsToRevalidate.add(detailPath);
    allAffectedUrls.push(`${origin}${detailPath}`);

    if (item.action !== 'delete') {
      livePathsToPrewarm.add(detailPath);
    }

    try {
      revalidateTag(
        hubSegment === 'books' ? `book:${cleanSlug}` : `exam:${cleanSlug}`
      );
      if (item.itemId) {
        const colTag =
          hubSegment === 'books' ? 'books' : 'ExamPackDocument';
        revalidateTag(`reviews:${colTag}:${item.itemId}`);
      }
    } catch {
      // Safe outside Next.js request context (e.g. unit tests)
    }
  }

  const sanitizedExplicitUrls = sanitizeCanonicalUrlBatch(
    payload.urls ?? [],
    origin
  );
  for (const fullUrl of sanitizedExplicitUrls) {
    try {
      const u = new URL(fullUrl);
      itemPathsToRevalidate.add(u.pathname);
      livePathsToPrewarm.add(u.pathname);
      const catMatch = u.pathname.match(/^\/books\/category\/([^/]+)$/);
      if (catMatch) {
        const slug = decodeURIComponent(catMatch[1]);
        revalidateTag(`category:${slug}`);
      } else {
        const match = u.pathname.match(/^\/(books|exams)\/([^/]+)$/);
        if (match) {
          const slug = decodeURIComponent(match[2]);
          revalidateTag(match[1] === 'books' ? `book:${slug}` : `exam:${slug}`);
        }
      }
    } catch {
      // Ignore invalid URL
    }
  }

  // 2. Purge Next.js Data Cache tags + Full Route Cache paths (`revalidate = false`)
  const corePaths = [
    '/',
    '/books',
    '/exams',
    '/sitemap.xml',
    '/sitemap-index.xml',
    '/sitemaps/updates.xml',
    '/feed.xml',
  ];
  const revalidatedPaths: string[] = [];

  try {
    revalidateTag('catalog');
    revalidateTag('books');
    revalidateTag('categories');
    revalidateTag('exams');
    revalidateTag('sitemaps');
    revalidateTag('reviews');
  } catch {
    // Safe outside Next.js server runtime
  }

  for (const p of [...corePaths, ...itemPathsToRevalidate]) {
    try {
      revalidatePath(p);
      revalidatedPaths.push(p);
    } catch {
      revalidatedPaths.push(p);
    }
  }

  if (payload.invalidateOnly) {
    return {
      ok: true,
      statusCode: 200,
      cacheInvalidated: true,
      revalidatedPaths,
      prewarmed: [],
      indexNow: {
        dispatched: false,
        statusCode: 200,
        submittedCount: 0,
        message: 'Cache purged (invalidateOnly=true).',
      },
    };
  }

  // 3. Immediately pre-fetch live canonical pages, hubs, and sitemaps ahead of bots
  let prewarmed: PrewarmOutcome[] = [];
  if (payload.prewarm && !options?.skipPrewarmInTests) {
    const prewarmQueue = [
      ...Array.from(livePathsToPrewarm).map((p) => `${origin}${p}`),
      `${origin}/`,
      `${origin}/books`,
      `${origin}/exams`,
      `${origin}/sitemap.xml`,
      `${origin}/sitemaps/updates.xml`,
    ];
    prewarmed = await prewarmCanonicalUrls(prewarmQueue, origin);
  }

  // 4. Notify IndexNow for instant crawl discovery
  const indexNow =
    allAffectedUrls.length > 0
      ? await submitIndexNowBatch(allAffectedUrls)
      : {
          dispatched: false,
          statusCode: 200,
          submittedCount: 0,
          message: 'Caches purged and pre-warmed; no item URLs supplied for IndexNow.',
        };

  return {
    ok: indexNow.statusCode < 400,
    statusCode: indexNow.statusCode === 400 ? 400 : 200,
    cacheInvalidated: true,
    revalidatedPaths,
    prewarmed,
    indexNow,
  };
}
