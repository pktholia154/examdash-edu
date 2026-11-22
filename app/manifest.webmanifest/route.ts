import { NextRequest, NextResponse } from 'next/server';
import { getCanonicalOrigin } from '../../lib/seo/schema';

const SAFE_HOST_PATTERN = /^[a-z0-9.-]+(?::\d+)?$/;

function resolveManifestOrigin(req: NextRequest): string {
  const rawHost = (
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    ''
  )
    .split(',')[0]
    .trim()
    .toLowerCase();

  if (rawHost && SAFE_HOST_PATTERN.test(rawHost)) {
    const isLocal =
      rawHost.startsWith('localhost') || rawHost.startsWith('127.0.0.1');
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
    return `${proto}://${rawHost}`;
  }

  return getCanonicalOrigin();
}

export async function GET(req: NextRequest) {
  const origin = resolveManifestOrigin(req);

  const manifestPayload = {
    id: '/?source=pwa',
    name: 'ExamDash — Books, Mock Exams & Study Library',
    short_name: 'ExamDash',
    description:
      'Discover curated ebooks, quizbooks, and full-length mock exam packs with instant syllabus previews and unified study library access.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    background_color: '#F5F5F5',
    theme_color: '#0F172A',
    handle_links: 'preferred',
    launch_handler: {
      client_mode: ['navigate-existing', 'auto'],
    },
    prefer_related_applications: false,
    related_applications: [
      {
        platform: 'webapp',
        url: `${origin}/manifest.webmanifest`,
        id: `${origin}/?source=pwa`,
      },
    ],
    icons: [
      {
        src: '/pwa-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };

  return new NextResponse(JSON.stringify(manifestPayload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
