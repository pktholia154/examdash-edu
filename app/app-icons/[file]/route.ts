import { NextRequest, NextResponse } from 'next/server';
import {
  isSupportedAppIconKey,
  loadAppIconBuffer,
} from '../../../server/pwa/icon-assets';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ file: string }> }
) {
  const { file } = await context.params;
  const normalized = decodeURIComponent(file || '').trim();

  if (!isSupportedAppIconKey(normalized)) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=60',
        'X-Robots-Tag': 'noindex',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  try {
    const pngBuffer = await loadAppIconBuffer(normalized);
    const bodyBytes = new Uint8Array(pngBuffer);

    return new NextResponse(bodyBytes, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(bodyBytes.byteLength),
        'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse('Icon asset unavailable', {
      status: 500,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
}
