import { NextRequest, NextResponse } from 'next/server';
import firebaseConfig from './firebase-applet-config.json';

const CAPACITOR_ALLOWED_ORIGINS = new Set([
  'capacitor://localhost',
  'https://localhost',
  'https://exam-dash.com',
  'https://www.exam-dash.com',
]);

const PUBLIC_ROUTER_VARY =
  'RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Router-Segment-Prefetch, Accept-Encoding';

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
  expiresAtMs: number;
  books: Set<string>;
  exams: Set<string>;
}

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
  const timer = setTimeout(() => controller.abort(), 1500);

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

async function getEdgeTombstones(): Promise<EdgeTombstoneSnapshot> {
  const now = Date.now();
  if (edgeTombstoneCache && edgeTombstoneCache.expiresAtMs > now) {
    return edgeTombstoneCache;
  }
  if (inflightTombstonePromise) {
    return inflightTombstonePromise;
  }

  inflightTombstonePromise = Promise.all([
    queryEdgeDeletedSlugs('books'),
    queryEdgeDeletedSlugs('ExamPackDocument'),
  ])
    .then(([books, exams]) => {
      const snapshot: EdgeTombstoneSnapshot = {
        expiresAtMs: Date.now() + 60_000,
        books,
        exams,
      };
      edgeTombstoneCache = snapshot;
      inflightTombstonePromise = null;
      return snapshot;
    })
    .catch(() => {
      inflightTombstonePromise = null;
      return {
        expiresAtMs: Date.now() + 15_000,
        books: new Set<string>(),
        exams: new Set<string>(),
      };
    });

  return inflightTombstonePromise;
}

function buildGone410Response(): NextResponse {
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
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function deriveSurrogateKeys(pathname: string): {
  surrogateKey: string;
  cacheTag: string;
} {
  if (pathname === '/') {
    return { surrogateKey: 'catalog home books exams', cacheTag: 'catalog,home,books,exams' };
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

  const rawHost = (
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    ''
  )
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

  // 0. Mirror-Domain Canonical Lock: 301 redirect www.exam-dash.com -> exam-dash.com
  if (rawHost === 'www.exam-dash.com') {
    const redirectUrl = new URL(
      `${pathname}${req.nextUrl.search}`,
      'https://exam-dash.com'
    );
    return NextResponse.redirect(redirectUrl, 301);
  }

  // 0b. Dynamic IndexNow Domain Key Verification (`/{INDEXNOW_KEY}.txt`)
  const configuredIndexNowKey = (process.env.INDEXNOW_KEY || '').trim();
  if (
    configuredIndexNowKey &&
    (req.method === 'GET' || req.method === 'HEAD') &&
    pathname === `/${configuredIndexNowKey}.txt`
  ) {
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = '/api/v1/seo/indexnow';
    rewriteUrl.search = `?verifyKey=${encodeURIComponent(configuredIndexNowKey)}`;
    return NextResponse.rewrite(rewriteUrl);
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

  // 2b. Internal Search Trap Route (`/search`): no-store + noindex, follow
  if (pathname === '/search' || pathname.startsWith('/search/')) {
    const res = NextResponse.next();
    res.headers.set('Cache-Control', 'private, no-store');
    res.headers.set('X-Robots-Tag', 'noindex, follow');
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
    if (rawHost && rawHost !== 'exam-dash.com') {
      res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
    return res;
  }

  // 2d. Base Pagination Canonical Normalization (`?page=1` or invalid `<= 1` -> clean base path 301)
  if (
    (req.method === 'GET' || req.method === 'HEAD') &&
    (pathname === '/books' || pathname === '/exams') &&
    searchParams.has('page')
  ) {
    const rawPage = searchParams.get('page') || '';
    const parsedPage = Number(rawPage);
    if (!Number.isInteger(parsedPage) || parsedPage <= 1) {
      const cleanUrl = req.nextUrl.clone();
      cleanUrl.searchParams.delete('page');
      if (rawHost === 'exam-dash.com') {
        const prodTarget = new URL(
          `${cleanUrl.pathname}${cleanUrl.search}`,
          'https://exam-dash.com'
        );
        return NextResponse.redirect(prodTarget, 301);
      }
      return NextResponse.redirect(cleanUrl, 301);
    }
  }

  const isPartialRsc = isNextPartialFlightRequest(req);

  // 2e. Permanently Deleted Entities (`isDeleted == true` Tombstones) -> Genuine HTTP 410 Gone
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
          return buildGone410Response();
        }
      }
    }
  }

  // 3. Public Discovery, Catalog & Detail Routes: Session-Agnostic Cookie-Free Edge Caching
  const cleanRequestHeaders = new Headers(req.headers);
  cleanRequestHeaders.delete('cookie');

  const res = NextResponse.next({
    request: {
      headers: cleanRequestHeaders,
    },
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (isPartialRsc) {
      // Pillar 2: Never let client-router RSC flight payloads overwrite canonical HTML cache entries
      res.headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0');
      res.headers.set('Vary', PUBLIC_ROUTER_VARY);
    } else if (process.env.NODE_ENV === 'production') {
      if (hasMarketingQueryParams(searchParams)) {
        // Short s-maxage=60 on ?utm_* / ?gclid variants to preserve attribution while preventing CDN cache bloat
        res.headers.set(
          'Cache-Control',
          'public, max-age=0, s-maxage=60, stale-while-revalidate=60'
        );
      } else {
        res.headers.set(
          'Cache-Control',
          'public, max-age=60, s-maxage=180, stale-while-revalidate=600, stale-if-error=86400'
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

  // Lock preview / raw Cloud Run origin hosts against accidental indexing
  if (rawHost && rawHost !== 'exam-dash.com') {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|wasm/|.*\\.(?:png|wasm)$|\\.well-known/).*)',
  ],
};
