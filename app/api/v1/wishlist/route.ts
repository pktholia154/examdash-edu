import { NextRequest, NextResponse } from 'next/server';
import { makeFirestoreSafeCartKey } from '../../../../lib/registry/content-type-registry';
import type { CollectionName } from '../../../../lib/types/catalog';
import { verifyBearerIdToken } from '../../../../server/firebase/verify-auth';
import {
  addWishlistItemToFirestore,
  listUserWishlistFromFirestore,
  removeWishlistItemFromFirestore,
} from '../../../../server/repositories/wishlist-repository';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

function isValidCollection(val: unknown): val is CollectionName {
  return val === 'books' || val === 'ExamPackDocument';
}

function getRawBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  return token || null;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = getRawBearerToken(authHeader);
  const verified = await verifyBearerIdToken(authHeader);
  if (!verified || !token) {
    return NextResponse.json(
      { error: 'Authentication required to load wishlist.' },
      { status: 401, headers: PRIVATE_HEADERS }
    );
  }

  try {
    const items = await listUserWishlistFromFirestore(verified.uid, token);
    return NextResponse.json({ items }, { status: 200, headers: PRIVATE_HEADERS });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Unable to load wishlist items.',
      },
      { status: 500, headers: PRIVATE_HEADERS }
    );
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = getRawBearerToken(authHeader);
  const verified = await verifyBearerIdToken(authHeader);
  if (!verified || !token) {
    return NextResponse.json(
      { error: 'Authentication required to save wishlist items.' },
      { status: 401, headers: PRIVATE_HEADERS }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request body.' },
      { status: 400, headers: PRIVATE_HEADERS }
    );
  }

  if (
    !isValidCollection(body.collectionName) ||
    typeof body.id !== 'string' ||
    !body.id.trim() ||
    typeof body.urlSlug !== 'string' ||
    !body.urlSlug.trim() ||
    typeof body.title !== 'string' ||
    !body.title.trim()
  ) {
    return NextResponse.json(
      { error: 'Missing required catalog item fields.' },
      { status: 400, headers: PRIVATE_HEADERS }
    );
  }

  try {
    const saved = await addWishlistItemToFirestore({
      userId: verified.uid,
      emailVerified: Boolean(verified.email_verified),
      userDisplayName: typeof verified.name === 'string' ? verified.name : undefined,
      userEmail: typeof verified.email === 'string' ? verified.email : undefined,
      userPhotoUrl:
        typeof verified.picture === 'string' ? verified.picture : undefined,
      bearerIdToken: token,
      item: {
        id: body.id.trim(),
        collectionName: body.collectionName,
        urlSlug: body.urlSlug.trim(),
        title: body.title.trim(),
        authorName:
          typeof body.authorName === 'string' ? body.authorName : undefined,
        language: typeof body.language === 'string' ? body.language : undefined,
        type: typeof body.type === 'string' ? body.type : undefined,
        currency: typeof body.currency === 'string' ? body.currency : 'INR',
        listPrice: Number(body.listPrice) || 0,
        buyPrice: Number(body.buyPrice) || 0,
        totalMocktest:
          typeof body.totalMocktest === 'number'
            ? body.totalMocktest
            : undefined,
      },
    });

    return NextResponse.json(
      { item: saved },
      { status: 200, headers: PRIVATE_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Unable to save wishlist item.',
      },
      { status: 500, headers: PRIVATE_HEADERS }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = getRawBearerToken(authHeader);
  const verified = await verifyBearerIdToken(authHeader);
  if (!verified || !token) {
    return NextResponse.json(
      { error: 'Authentication required to remove wishlist items.' },
      { status: 401, headers: PRIVATE_HEADERS }
    );
  }

  const wishlistKeyParam = req.nextUrl.searchParams.get('wishlistKey');
  const collectionParam = req.nextUrl.searchParams.get('collection');
  const itemIdParam = req.nextUrl.searchParams.get('itemId');

  const resolvedKey =
    wishlistKeyParam?.trim() ||
    (isValidCollection(collectionParam) && itemIdParam?.trim()
      ? makeFirestoreSafeCartKey(collectionParam, itemIdParam.trim())
      : '');

  if (!resolvedKey) {
    return NextResponse.json(
      { error: 'wishlistKey or collection + itemId is required.' },
      { status: 400, headers: PRIVATE_HEADERS }
    );
  }

  try {
    await removeWishlistItemFromFirestore({
      userId: verified.uid,
      emailVerified: Boolean(verified.email_verified),
      bearerIdToken: token,
      wishlistKey: resolvedKey,
    });
    return NextResponse.json(
      { deleted: true, wishlistKey: resolvedKey },
      { status: 200, headers: PRIVATE_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unable to remove wishlist item.',
      },
      { status: 500, headers: PRIVATE_HEADERS }
    );
  }
}
