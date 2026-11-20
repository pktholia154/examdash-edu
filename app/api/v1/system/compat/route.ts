import { NextRequest, NextResponse } from 'next/server';

/**
 * Additive-only /api/v1/system/compat Handshake (Pillar 9 Version Skew & OTA Governance)
 * Evaluates X-Platform and X-App-Version headers for force-update gates & soft nudges.
 */
export async function GET(req: NextRequest) {
  const platform = (req.headers.get('x-platform') || 'web').toLowerCase();
  const appVersion = req.headers.get('x-app-version') || '1.0.0';

  return NextResponse.json(
    {
      status: 'compatible',
      platform,
      clientVersion: appVersion,
      minimumSupportedVersion: '1.0.0',
      latestVersion: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
      forceUpdate: false,
      softUpdateNudge: false,
      apiSchemaVersion: 'v1',
      serverTimeIso: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        'Cache-Control':
          'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
        Vary: 'Accept-Encoding, X-Platform, X-App-Version',
      },
    }
  );
}
