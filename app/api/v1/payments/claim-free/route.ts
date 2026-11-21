import { NextRequest, NextResponse } from 'next/server';
import { verifyBearerIdToken } from '../../../../../server/firebase/verify-auth';
import {
  getCatalogItemsByRefs,
  type CatalogItemRef,
} from '../../../../../server/repositories/catalog-repository';
import { commitVerifiedPurchasesToFirestore } from '../../../../../server/payments/purchase-persistence';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };
const ITEM_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

interface ClaimFreeBody {
  items?: Array<{
    collectionName?: string;
    id?: string;
  }>;
}

/**
 * Server-Verified Free Resource Claim Endpoint (`POST /api/v1/payments/claim-free`)
 * Verifies on the server that EVERY requested book or exam pack has authoritative `buyPrice === 0`
 * before writing completed entitlements to `/users/{uid}/purchases`.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const decoded = await verifyBearerIdToken(authHeader);
  if (!decoded || !decoded.uid) {
    return NextResponse.json(
      { error: 'Please sign in with Google to claim free study resources.' },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }
  if (decoded.email_verified !== true) {
    return NextResponse.json(
      { error: 'A verified email address is required to save items to your Library.' },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  const rawBearerToken =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';

  let body: ClaimFreeBody = {};
  try {
    body = (await req.json()) as ClaimFreeBody;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request payload.' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50) {
    return NextResponse.json(
      { error: 'Provide between 1 and 50 free items to claim.' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const refs: CatalogItemRef[] = [];
  for (const rawItem of body.items) {
    const col =
      rawItem?.collectionName === 'books'
        ? 'books'
        : rawItem?.collectionName === 'ExamPackDocument'
        ? 'ExamPackDocument'
        : null;
    const id = typeof rawItem?.id === 'string' ? rawItem.id.trim() : '';
    if (!col || !ITEM_ID_REGEX.test(id)) {
      return NextResponse.json(
        { error: 'Invalid catalog item reference.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    refs.push({ collectionName: col, id });
  }

  try {
    const authoritativeItems = await getCatalogItemsByRefs(refs);
    if (authoritativeItems.length === 0) {
      return NextResponse.json(
        { error: 'Requested free resource was not found.' },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    const hasPaidItem = authoritativeItems.some((item) => item.buyPrice > 0);
    if (hasPaidItem) {
      return NextResponse.json(
        {
          error:
            'Paid items cannot be claimed for free. Complete payment via Razorpay checkout.',
        },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    const purchases = await commitVerifiedPurchasesToFirestore({
      userId: decoded.uid,
      userDisplayName: typeof decoded.name === 'string' ? decoded.name : null,
      userEmail: typeof decoded.email === 'string' ? decoded.email : null,
      userPhotoUrl: typeof decoded.picture === 'string' ? decoded.picture : null,
      bearerIdToken: rawBearerToken,
      items: authoritativeItems,
    });

    return NextResponse.json(
      { claimed: true, purchases },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to claim free resource.',
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
