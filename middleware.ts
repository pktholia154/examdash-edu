import { NextRequest, NextResponse } from 'next/server';

const CAPACITOR_ALLOWED_ORIGINS = new Set([
  'capacitor://localhost',
  'https://localhost',
  'https://exam-dash.com',
  'https://www.exam-dash.com',
]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get('origin') || '';

  // 1. Bearer-only /api/v1/* CORS allowlisting for Capacitor Hybrid Shell
  if (pathname.startsWith('/api/v1/')) {
    if (req.method === 'OPTIONS') {
      const preflight = new NextResponse(null, { status: 204 });
      if (CAPACITOR_ALLOWED_ORIGINS.has(origin)) {
        preflight.headers.set('Access-Control-Allow-Origin', origin);
        preflight.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

  // 2. Private / Authenticated Routes: strict no-store + noindex
  if (
    pathname.startsWith('/purchased') ||
    pathname.startsWith('/read/') ||
    pathname.startsWith('/attempt/') ||
    pathname.startsWith('/api/')
  ) {
    const res = NextResponse.next();
    res.headers.set('Cache-Control', 'private, no-store');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    res.headers.set('X-Content-Type-Options', 'nosniff');
    return res;
  }

  // 3. Public Discovery, Catalog & Detail Routes: Poison-Free Edge Caching & Zero Cookies
  const cleanRequestHeaders = new Headers(req.headers);
  cleanRequestHeaders.delete('cookie');

  const res = NextResponse.next({
    request: {
      headers: cleanRequestHeaders,
    },
  });

  if (req.method === 'GET') {
    res.headers.set(
      'Cache-Control',
      'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400'
    );
    res.headers.set('Vary', 'Accept-Encoding');
  }

  res.headers.delete('set-cookie');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  const rawHost = (
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    ''
  )
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

  if (
    rawHost &&
    rawHost !== 'exam-dash.com' &&
    rawHost !== 'www.exam-dash.com'
  ) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|wasm/|.*\\.(?:png|wasm)$|\\.well-known/).*)',
  ],
};
