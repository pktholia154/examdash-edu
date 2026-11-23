import { NextRequest, NextResponse } from 'next/server';
import { getCanonicalOrigin } from '../../lib/seo/schema';
import {
  APP_ICON_VERSION,
  loadAppIconDataUri,
} from '../../server/pwa/icon-assets';

export const runtime = 'nodejs';

const SAFE_HOST_PATTERN = /^[a-z0-9.-]+(?::\d+)?$/;

function resolveManifestContext(req: NextRequest): {
  origin: string;
  hostname: string;
  isCookieGatedRunApp: boolean;
} {
  const rawHost = (
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    ''
  )
    .split(',')[0]
    .trim()
    .toLowerCase();

  if (rawHost && SAFE_HOST_PATTERN.test(rawHost)) {
    const hostname = rawHost.replace(/:\d+$/, '');
    const isLocal =
      hostname === 'localhost' || hostname === '127.0.0.1';
    const forwardedProto = (req.headers.get('x-forwarded-proto') || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const proto =
      forwardedProto === 'http' || forwardedProto === 'https'
        ? forwardedProto
        : isLocal
        ? 'http'
        : 'https';
    return {
      origin: `${proto}://${rawHost}`,
      hostname,
      isCookieGatedRunApp: hostname.endsWith('.run.app'),
    };
  }

  const canonical = getCanonicalOrigin();
  return {
    origin: canonical,
    hostname: new URL(canonical).hostname,
    isCookieGatedRunApp: false,
  };
}

function buildManifestCorsHeaders(
  req: NextRequest,
  resolvedOrigin: string,
  isCookieGatedRunApp: boolean
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/manifest+json; charset=utf-8',
    'Cache-Control': isCookieGatedRunApp
      ? 'private, max-age=0, must-revalidate'
      : 'public, max-age=300, s-maxage=3600',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin, Accept-Encoding',
  };

  const requestOrigin = (req.headers.get('origin') || '').trim();
  if (requestOrigin && requestOrigin === resolvedOrigin) {
    headers['Access-Control-Allow-Origin'] = resolvedOrigin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export async function GET(req: NextRequest) {
  const { origin, isCookieGatedRunApp } = resolveManifestContext(req);

  const icons = isCookieGatedRunApp
    ? await Promise.all([
        loadAppIconDataUri('icon-192.png').then((src) => ({
          src,
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        })),
        loadAppIconDataUri('icon-512.png').then((src) => ({
          src,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        })),
        loadAppIconDataUri('maskable-192.png').then((src) => ({
          src,
          sizes: '192x192',
          type: 'image/png',
          purpose: 'maskable',
        })),
        loadAppIconDataUri('maskable-512.png').then((src) => ({
          src,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        })),
      ])
    : [
        {
          src: `${origin}/app-icons/icon-192.png?v=${APP_ICON_VERSION}`,
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: `${origin}/app-icons/icon-512.png?v=${APP_ICON_VERSION}`,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: `${origin}/app-icons/maskable-192.png?v=${APP_ICON_VERSION}`,
          sizes: '192x192',
          type: 'image/png',
          purpose: 'maskable',
        },
        {
          src: `${origin}/app-icons/maskable-512.png?v=${APP_ICON_VERSION}`,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ];

  const manifestPayload = {
    id: '/?source=pwa',
    name: 'ExamDash — Books, Mock Exams & Study Library',
    short_name: 'ExamDash',
    description:
      'Discover curated ebooks, quizbooks, and full-length mock exam packs with instant syllabus previews and unified study library access.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    background_color: '#F0F0F0',
    theme_color: '#7627A1',
    handle_links: 'preferred',
    launch_handler: {
      client_mode: ['navigate-existing', 'auto'],
    },
    prefer_related_applications: false,
    related_applications: [
      {
        platform: 'webapp',
        url: `${origin}/manifest.webmanifest?v=${APP_ICON_VERSION}`,
        id: `${origin}/?source=pwa`,
      },
      {
        platform: 'webapp',
        url: `${origin}/manifest.webmanifest`,
        id: `${origin}/?source=pwa`,
      },
    ],
    icons,
  };

  return new NextResponse(JSON.stringify(manifestPayload, null, 2), {
    status: 200,
    headers: buildManifestCorsHeaders(req, origin, isCookieGatedRunApp),
  });
}
