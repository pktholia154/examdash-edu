import { NextRequest, NextResponse } from 'next/server';
import firebaseConfig from './firebase-applet-config.json';
import {
  extractRequestHostname,
  hasFacetFilterParams,
  isDefaultFirebaseOrCloudRunHost,
} from './lib/seo/schema';
import { evaluateSwrState } from './lib/seo/crawl-resilience';

const CAPACITOR_ALLOWED_ORIGINS = new Set([
  'capacitor://localhost',
  'https://localhost',
  'https://exam-dash.com',
  'https://www.exam-dash.com',
]);

const PUBLIC_ROUTER_VARY =
  'RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Router-Segment-Prefetch, X-Forwarded-Host, Accept-Encoding';

const MARKETING_PARAM_NAMES = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'dclid',
  'twclid',
  'yclid',
  'mc_cid',
  'mc_eid',
]);

function hasMarketingQueryParams(searchParams: URLSearchParams): boolean {
  for (const key of searchParams.keys()) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || MARKETING_PARAM_NAMES.has(lower)) {
      return true;
    }
  }
  return false;
}

function isNextPartialFlightRequest(req: NextRequest): boolean {
  return (
    req.headers.has('rsc') ||
    req.headers.has('next-router-prefetch') ||
    req.headers.has('next-router-segment-prefetch') ||
    req.nextUrl.searchParams.has('_rsc')
  );
}

interface EdgeTombstoneSnapshot {
  freshUntilMs: number;
  staleUntilMs: number;
  books: Set<string>;
  exams: Set<string>;
}

const TOMBSTONE_FRESH_TTL_MS = 60_000;
const TOMBSTONE_STALE_TTL_MS = 600_000;
const TOMBSTONE_FETCH_TIMEOUT_MS = 800;

let edgeTombstoneCache: EdgeTombstoneSnapshot | null = null;
let inflightTombstonePromise: Promise<EdgeTombstoneSnapshot> | null = null;

async function queryEdgeDeletedSlugs(
  collectionId: 'books' | 'ExamPackDocument'
): Promise<Set<string>> {
  const projectId = firebaseConfig.projectId || 'examdash-ed';
  const apiKey = firebaseConfig.apiKey || '';
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents:runQuery${
    apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''
  }`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOMBSTONE_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId }],
          select: {
            fields: [{ fieldPath: 'urlSlug' }, { fieldPath: 'isDeleted' }],
          },
          where: {
            fieldFilter: {
              field: { fieldPath: 'isDeleted' },
              op: 'EQUAL',
              value: { booleanValue: true },
            },
          },
          limit: 2000,
        },
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!res.ok) return new Set<string>();
    const rows = (await res.json()) as Array<{
      document?: {
        name?: string;
        fields?: {
          urlSlug?: { stringValue?: string };
          isDeleted?: { booleanValue?: boolean };
        };
      };
    }>;

    const slugs = new Set<string>();
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row?.document?.name) continue;
        if (row.document.fields?.isDeleted?.booleanValue !== true) continue;
        const segments = row.document.name.split('/');
        const fallbackId = segments[segments.length - 1] || '';
        const slug = (
          row.document.fields?.urlSlug?.stringValue || fallbackId
        ).trim();
        if (slug) slugs.add(slug);
      }
    }
    return slugs;
  } catch {
    return new Set<string>();
  } finally {
    clearTimeout(timer);
  }
}

function refreshEdgeTombstones(): Promise<EdgeTombstoneSnapshot> {
  if (inflightTombstonePromise) {
    return inflightTombstonePromise;
  }

  inflightTombstonePromise = Promise.all([
    queryEdgeDeletedSlugs('books'),
    queryEdgeDeletedSlugs('ExamPackDocument'),
  ])
    .then(([books, exams]) => {
      const completedAt = Date.now();
      const snapshot: EdgeTombstoneSnapshot = {
        freshUntilMs: completedAt + TOMBSTONE_FRESH_TTL_MS,
        staleUntilMs: completedAt + TOMBSTONE_STALE_TTL_MS,
        books,
        exams,
      };
      edgeTombstoneCache = snapshot;
      inflightTombstonePromise = null;
      return snapshot;
    })
    .catch(() => {
      inflightTombstonePromise = null;
      const now = Date.now();
      if (edgeTombstoneCache) {
        return edgeTombstoneCache;
      }
      return {
        freshUntilMs: now + 15_000,
        staleUntilMs: now + 60_000,
        books: new Set<string>(),
        exams: new Set<string>(),
      };
    });

  return inflightTombstonePromise;
}

async function getEdgeTombstones(): Promise<EdgeTombstoneSnapshot> {
  const now = Date.now();
  const state = evaluateSwrState(edgeTombstoneCache, now);

  if (state === 'fresh' && edgeTombstoneCache) {
    return edgeTombstoneCache;
  }

  if (state === 'stale' && edgeTombstoneCache) {
    // Serve warm tombstone snapshot immediately (0ms TTFB) and refresh in background
    void refreshEdgeTombstones();
    return edgeTombstoneCache;
  }

  return refreshEdgeTombstones();
}

function buildGone410Response(isFirebaseOrCloudRunHost: boolean): NextResponse {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>410 Gone — Resource Permanently Removed | ExamDash</title>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#F0F0F0;color:#111315;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
    main{max-width:480px;width:100%;background:#FFFFFF;border:1px solid #D8DADC;border-radius:16px;padding:32px;text-align:center}
    p.code{font-family:ui-monospace,monospace;font-size:12px;font-weight:700;color:#5C6268;margin:0}
    h1{font-size:22px;margin:10px 0 8px}
    p.desc{font-size:14px;line-height:1.6;color:#5C6268;margin:0 0 24px}
    .links{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
    a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600;border:1px solid #111315;color:#111315}
    a.primary{background:#111315;color:#FFFFFF}
  </style>
</head>
<body>
  <main>
    <p class="code">HTTP 410 GONE</p>
    <h1>This resource has been permanently removed</h1>
    <p class="desc">The requested study book or mock exam pack is no longer offered in the ExamDash catalog.</p>
    <div class="links">
      <a class="primary" href="/">Explore Home</a>
      <a href="/books">Browse Books</a>
      <a href="/exams">Browse Exams</a>
    </div>
  </main>
</body>
</html>`;

  return new NextResponse(html, {
    status: 410,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': isFirebaseOrCloudRunHost
        ? 'private, no-store'
        : 'public, max-age=0, s-maxage=3600',
      'X-Robots-Tag': isFirebaseOrCloudRunHost ? 'noindex, nofollow' : 'noindex',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function buildSameHostRedirectUrl(
  req: NextRequest,
  targetPathname: string,
  targetSearchParams: URLSearchParams
): string {
  const rawForwardedHost = (
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    ''
  )
    .split(',')[0]
    ?.trim();
  const rawProto = (
    req.headers.get('x-forwarded-proto') ||
    req.nextUrl.protocol.replace(/:$/, '') ||
    'https'
  )
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  const safeProto = rawProto === 'http' ? 'http' : 'https';
  const qs = targetSearchParams.toString();
  const suffix = `${targetPathname}${qs ? `?${qs}` : ''}`;

  if (rawForwardedHost) {
    return `${safeProto}://${rawForwardedHost}${suffix}`;
  }
  return `${req.nextUrl.origin}${suffix}`;
}

function deriveSurrogateKeys(pathname: string): {
  surrogateKey: string;
  cacheTag: string;
} {
  if (pathname === '/') {
    return { surrogateKey: 'catalog home books exams', cacheTag: 'catalog,home,books,exams' };
  }
  if (pathname.startsWith('/books/category/')) {
    return {
      surrogateKey: 'catalog books categories',
      cacheTag: 'catalog,books,categories',
    };
  }
  if (pathname === '/books' || pathname.startsWith('/books/')) {
    return { surrogateKey: 'catalog books', cacheTag: 'catalog,books' };
  }
  if (pathname === '/exams' || pathname.startsWith('/exams/')) {
    return { surrogateKey: 'catalog exams', cacheTag: 'catalog,exams' };
  }
  return { surrogateKey: 'site legal', cacheTag: 'site,legal' };
}

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const origin = req.headers.get('origin') || '';

  const host = extractRequestHostname(
    (
      req.headers.get('x-forwarded-host') ||
      req.headers.get('host') ||
      ''
    ).toLowerCase()
  );
  const isFirebaseOrCloudRunHost = isDefaultFirebaseOrCloudRunHost(host);

  // 0. Dynamic IndexNow Domain Key Verification (`/{INDEXNOW_KEY}.txt`)
  const configuredIndexNowKey = (process.env.INDEXNOW_KEY || '').trim();
  if (
    configuredIndexNowKey &&
    (req.method === 'GET' || req.method === 'HEAD') &&
    pathname === `/${configuredIndexNowKey}.txt`
  ) {
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = '/api/v1/seo/indexnow';
    rewriteUrl.search = `?verifyKey=${encodeURIComponent(configuredIndexNowKey)}`;
    const rewriteRes = NextResponse.rewrite(rewriteUrl);
    if (isFirebaseOrCloudRunHost) {
      rewriteRes.headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
    return rewriteRes;
  }

  // 1. Bearer-only /api/v1/* CORS allowlisting for Capacitor Hybrid Shell
  if (pathname.startsWith('/api/v1/')) {
    if (req.method === 'OPTIONS') {
      const preflight = new NextResponse(null, { status: 204 });
      if (CAPACITOR_ALLOWED_ORIGINS.has(origin)) {
        preflight.headers.set('Access-Control-Allow-Origin', origin);
        preflight.headers.set(
          'Access-Control-Allow-Methods',
          'GET, POST, DELETE, OPTIONS'
        );
        preflight.headers.set(
          'Access-Control-Allow-Headers',
          'Authorization, Content-Type, Idempotency-Key, Range, X-Platform, X-App-Version'
        );
        preflight.headers.set(
          'Access-Control-Expose-Headers',
          'Accept-Ranges, Content-Range, Content-Length'
        );
        preflight.headers.set('Access-Control-Max-Age', '86400');
      }
      return preflight;
    }

    const res = NextResponse.next();
    if (CAPACITOR_ALLOWED_ORIGINS.has(origin)) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, Idempotency-Key, Range, X-Platform, X-App-Version'
      );
      res.headers.set(
        'Access-Control-Expose-Headers',
        'Accept-Ranges, Content-Range, Content-Length'
      );
    }
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    res.headers.set('X-Content-Type-Options', 'nosniff');
    return res;
  }

  // 2. Private / Authenticated / Non-Indexable App Routes: strict no-store + noindex, nofollow
  if (
    pathname.startsWith('/purchased') ||
    pathname.startsWith('/profile') ||
    pathname.startsWith('/read/') ||
    pathname.startsWith('/attempt/') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/account') ||
    pathname.startsWith('/checkout') ||
    pathname.startsWith('/api/')
  ) {
    const res = NextResponse.next();
    res.headers.set('Cache-Control', 'private, no-store');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    res.headers.set('X-Content-Type-Options', 'nosniff');
    return res;
  }

  // 2b. Internal Search Trap Route (`/search`): no-store + noindex, follow (or noindex, nofollow on mirror hosts)
  if (pathname === '/search' || pathname.startsWith('/search/')) {
    const res = NextResponse.next();
    res.headers.set('Cache-Control', 'private, no-store');
    res.headers.set(
      'X-Robots-Tag',
      isFirebaseOrCloudRunHost ? 'noindex, nofollow' : 'noindex, follow'
    );
    res.headers.set('X-Content-Type-Options', 'nosniff');
    return res;
  }

  // 2c. Sitemaps, RSS Feed & Robots.txt: Cookie-Free Pass-Through Preserving Route Cache-Control
  if (
    pathname === '/sitemap.xml' ||
    pathname === '/sitemap-index.xml' ||
    pathname.startsWith('/sitemaps/') ||
    pathname === '/feed.xml' ||
    pathname === '/robots.txt'
  ) {
    const cleanHeaders = new Headers(req.headers);
    cleanHeaders.delete('cookie');
    const res = NextResponse.next({ request: { headers: cleanHeaders } });
    res.headers.delete('set-cookie');
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('Vary', 'X-Forwarded-Host, Accept-Encoding');
    if (isFirebaseOrCloudRunHost) {
      res.headers.set('Cache-Control', 'private, no-store');
      res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
    return res;
  }

  const isPartialRsc = isNextPartialFlightRequest(req);

  // 2d-0. Single-Hop 301 URL Normalization for Category Aliases & Redundant `?page=1`
  // Preserves incoming host (`x-forwarded-host` / `host`) so `www.exam-dash.com` never cross-host loops.
  if ((req.method === 'GET' || req.method === 'HEAD') && !isPartialRsc) {
    const legacyCategoryMatch = pathname.match(/^\/categor(?:y|ies)\/([^/]+)\/?$/);
    if (legacyCategoryMatch) {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (
        nextParams.getAll('page').length === 1 &&
        nextParams.get('page')?.trim() === '1'
      ) {
        nextParams.delete('page');
      }
      const targetUrl = buildSameHostRedirectUrl(
        req,
        `/books/category/${legacyCategoryMatch[1]}`,
        nextParams
      );
      const redirectRes = NextResponse.redirect(targetUrl, 301);
      if (isFirebaseOrCloudRunHost) {
        redirectRes.headers.set('X-Robots-Tag', 'noindex, nofollow');
      }
      return redirectRes;
    }

    const isPaginatedHubPath =
      pathname === '/books' ||
      pathname === '/exams' ||
      /^\/books\/category\/[^/]+$/.test(pathname);
    if (
      isPaginatedHubPath &&
      searchParams.getAll('page').length === 1 &&
      searchParams.get('page')?.trim() === '1'
    ) {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete('page');
      const targetUrl = buildSameHostRedirectUrl(req, pathname, nextParams);
      const redirectRes = NextResponse.redirect(targetUrl, 301);
      if (isFirebaseOrCloudRunHost) {
        redirectRes.headers.set('X-Robots-Tag', 'noindex, nofollow');
      }
      return redirectRes;
    }
  }

  // 2d. Permanently Deleted Entities (`isDeleted == true` Tombstones) -> Genuine HTTP 410 Gone
  if ((req.method === 'GET' || req.method === 'HEAD') && !isPartialRsc) {
    const detailMatch = pathname.match(/^\/(books|exams)\/([^/]+)$/);
    if (detailMatch) {
      const section = detailMatch[1];
      let decodedSlug = '';
      try {
        decodedSlug = decodeURIComponent(detailMatch[2] || '').trim();
      } catch {
        decodedSlug = (detailMatch[2] || '').trim();
      }
      if (decodedSlug) {
        const tombstones = await getEdgeTombstones();
        const isDeleted =
          section === 'books'
            ? tombstones.books.has(decodedSlug)
            : tombstones.exams.has(decodedSlug);
        if (isDeleted) {
          return buildGone410Response(isFirebaseOrCloudRunHost);
        }
      }
    }
  }

  // 3. Public Discovery, Catalog & Detail Routes: Session-Agnostic Cookie-Free Edge Caching (Zero Redirects)
  const cleanRequestHeaders = new Headers(req.headers);
  cleanRequestHeaders.delete('cookie');

  const res = NextResponse.next({
    request: {
      headers: cleanRequestHeaders,
    },
  });

  const isFilteredQuery = hasFacetFilterParams(searchParams);

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (isPartialRsc || isFirebaseOrCloudRunHost) {
      // Never cache client-router RSC flight payloads or default Firebase/Cloud Run mirror responses in shared CDN
      res.headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0');
      res.headers.set('Vary', PUBLIC_ROUTER_VARY);
    } else if (process.env.NODE_ENV === 'production') {
      if (hasMarketingQueryParams(searchParams) || isFilteredQuery) {
        // Short s-maxage=60 on ?utm_* / ?gclid / filter variants to prevent CDN cache bloat
        res.headers.set(
          'Cache-Control',
          'public, max-age=0, s-maxage=60, stale-while-revalidate=60'
        );
      } else {
        const isCatalogHubRoute =
          pathname === '/' ||
          pathname === '/books' ||
          pathname === '/exams' ||
          pathname.startsWith('/books/category/');
        const edgeCacheDirective = isCatalogHubRoute
          ? 'public, max-age=60, s-maxage=120, stale-while-revalidate=600, stale-if-error=86400'
          : 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400';
        res.headers.set('Cache-Control', edgeCacheDirective);
        res.headers.set(
          'CDN-Cache-Control',
          isCatalogHubRoute
            ? 'public, s-maxage=120, stale-while-revalidate=600, stale-if-error=86400'
            : 'public, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400'
        );
      }
      res.headers.set('Vary', PUBLIC_ROUTER_VARY);
      const { surrogateKey, cacheTag } = deriveSurrogateKeys(pathname);
      res.headers.set('Surrogate-Key', surrogateKey);
      res.headers.set('Cache-Tag', cacheTag);
    } else {
      res.headers.set('Cache-Control', 'no-store, must-revalidate');
      res.headers.set('Vary', PUBLIC_ROUTER_VARY);
    }
  }

  res.headers.delete('set-cookie');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Block indexing strictly on default Firebase/Cloud Run mirror domains (.web.app, .firebaseapp.com, .run.app),
  // leaving exam-dash.com completely untouched (except explicit facet/filter/sort query variants).
  if (isFirebaseOrCloudRunHost) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  } else if (isFilteredQuery) {
    res.headers.set('X-Robots-Tag', 'noindex, follow');
  }

  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|wasm/|.*\\.(?:png|wasm)$|\\.well-known/).*)',
  ],
};
