import { NextRequest, NextResponse } from 'next/server';
import { verifyBearerIdToken } from '../../../../../server/firebase/verify-auth';
import { issueShortLivedAssetGrant } from '../../../../../server/repositories/catalog-repository';
import type { CollectionName } from '../../../../../lib/types/catalog';

/**
 * Authenticated Protected Asset Delivery Endpoint (/api/v1/library/unlock)
 * Verifies Firebase Bearer ID token and issues short-lived (<= 15m) signed asset URLs.
 */
export async function POST(req: NextRequest) {
  const decoded = await verifyBearerIdToken(req.headers.get('authorization'));
  if (!decoded || !decoded.uid) {
    return NextResponse.json(
      { error: 'Authentication required to unlock protected study assets.' },
      {
        status: 401,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }

  let body: { collectionName?: string; urlSlug?: string } = {};
  try {
    body = (await req.json()) as { collectionName?: string; urlSlug?: string };
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request payload.' },
      {
        status: 400,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }

  const collectionName: CollectionName | null =
    body.collectionName === 'books'
      ? 'books'
      : body.collectionName === 'ExamPackDocument'
      ? 'ExamPackDocument'
      : null;

  const urlSlug = (body.urlSlug || '').trim();
  if (!collectionName || !urlSlug) {
    return NextResponse.json(
      { error: 'Both collectionName and urlSlug are required.' },
      {
        status: 400,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }

  try {
    const grant = await issueShortLivedAssetGrant(
      collectionName,
      urlSlug,
      decoded.uid
    );
    if (!grant) {
      return NextResponse.json(
        { error: 'Requested catalog item was not found or is unpublished.' },
        {
          status: 404,
          headers: { 'Cache-Control': 'private, no-store' },
        }
      );
    }

    return NextResponse.json(grant, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to mint short-lived signed URL.',
      },
      {
        status: 500,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }
}
