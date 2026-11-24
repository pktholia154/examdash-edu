import { NextRequest, NextResponse } from 'next/server';
import { verifyBearerIdToken } from '../../../../../../server/firebase/verify-auth';
import {
  getCatalogItemsByRefs,
  verifyCallerPurchaseRecord,
  type CatalogItemRef,
} from '../../../../../../server/repositories/catalog-repository';
import {
  computeItemsDigest,
  createRazorpayOrder,
  RazorpayApiError,
  RazorpayConfigError,
  signOrderContextToken,
} from '../../../../../../server/payments/razorpay';
import {
  isValidValidityMonthsForCollection,
  resolveValiditySelection,
} from '../../../../../../lib/validity/pricing';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };
const ITEM_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

interface CreateOrderBody {
  items?: Array<{
    collectionName?: string;
    id?: string;
    validityMonths?: number;
  }>;
}

/**
 * Production Razorpay Order Creation Endpoint (`POST /api/v1/payments/razorpay/order`)
 * - Verifies Firebase Auth Bearer token & verified email.
 * - Resolves authoritative catalog prices & currencies from Firestore (never trusts client amounts).
 * - Creates a real Razorpay Order with auto-capture and cryptographic item digest binding.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const decoded = await verifyBearerIdToken(authHeader);
  if (!decoded || !decoded.uid) {
    return NextResponse.json(
      { error: 'Please sign in with Google before proceeding to payment.' },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }
  if (decoded.email_verified !== true) {
    return NextResponse.json(
      { error: 'A verified email address is required to complete purchases.' },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  const rawBearerToken =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';

  let body: CreateOrderBody = {};
  try {
    body = (await req.json()) as CreateOrderBody;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request payload.' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50) {
    return NextResponse.json(
      { error: 'Provide between 1 and 50 catalog items to checkout.' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const refs: CatalogItemRef[] = [];
  const requestedValidityByKey = new Map<string, number>();
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
        { error: 'One or more catalog item references are invalid.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    if (
      rawItem?.validityMonths !== undefined &&
      !isValidValidityMonthsForCollection(col, rawItem.validityMonths)
    ) {
      return NextResponse.json(
        { error: 'One or more selected validity periods are invalid.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    if (typeof rawItem?.validityMonths === 'number') {
      requestedValidityByKey.set(`${col}:${id}`, rawItem.validityMonths);
    }
    refs.push({ collectionName: col, id });
  }

  try {
    const authoritativeItems = await getCatalogItemsByRefs(refs);
    if (authoritativeItems.length === 0) {
      return NextResponse.json(
        { error: 'Selected catalog items are no longer available for purchase.' },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    // Prevent double-charging items already present in the user's Purchased Library
    const ownedChecks = await Promise.all(
      authoritativeItems.map((item) =>
        verifyCallerPurchaseRecord(
          decoded.uid,
          item.collectionName,
          item.id,
          rawBearerToken
        )
      )
    );

    const unownedItems = authoritativeItems.filter((_, idx) => !ownedChecks[idx]);
    if (unownedItems.length === 0) {
      return NextResponse.json(
        {
          error: 'You already own all selected items in your Purchased Library.',
          alreadyOwned: true,
        },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }

    const currencies = new Set(
      unownedItems.map((i) => (i.currency || 'INR').toUpperCase())
    );
    if (currencies.size > 1) {
      return NextResponse.json(
        {
          error:
            'Mixed currencies in a single order are not supported. Checkout one currency at a time.',
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const currency = Array.from(currencies)[0] || 'INR';
    const pricedItems = unownedItems.map((item) => {
      const compositeKey = `${item.collectionName}:${item.id}`;
      const requestedMonths = requestedValidityByKey.get(compositeKey);
      const resolved = resolveValiditySelection(
        item.collectionName,
        item.buyPrice,
        requestedMonths
      );
      return { item, resolved };
    });

    const totalBuyPrice = pricedItems.reduce(
      (sum, entry) => sum + Math.max(0, entry.resolved.payablePrice),
      0
    );
    const amountSubunits = Math.round(totalBuyPrice * 100);

    if (amountSubunits <= 0) {
      return NextResponse.json(
        {
          error:
            'Selected items are free. Use Claim Free to add them directly to your Library.',
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    if (amountSubunits < 100) {
      return NextResponse.json(
        { error: 'Order total is below the minimum Razorpay transaction amount.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const itemsDigest = computeItemsDigest(
      pricedItems.map(({ item, resolved }) => ({
        collectionName: item.collectionName,
        id: item.id,
        buyPrice: resolved.payablePrice,
        currency,
        validityMonths: resolved.validityMonths,
      }))
    );

    const { order, keyId } = await createRazorpayOrder({
      amountSubunits,
      currency,
      userId: decoded.uid,
      itemsDigest,
      itemKeys: pricedItems.map(
        ({ item, resolved }) =>
          `${item.collectionName}:${item.id}:${resolved.validityMonths}m`
      ),
    });

    const orderToken = signOrderContextToken({
      orderId: order.id,
      userId: decoded.uid,
      currency: order.currency,
      amountSubunits: order.amount,
      items: pricedItems.map(({ item, resolved }) => ({
        collectionName: item.collectionName,
        id: item.id,
        validityMonths: resolved.validityMonths,
      })),
      expMs: Date.now() + 30 * 60 * 1000, // 30 minutes
    });

    const description =
      pricedItems.length === 1
        ? `${pricedItems[0].item.title} (${pricedItems[0].resolved.label})`.slice(0, 140)
        : `${pricedItems.length} ExamDash Study Resources`;

    return NextResponse.json(
      {
        keyId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        orderToken,
        description,
        itemCount: unownedItems.length,
        prefill: {
          name: typeof decoded.name === 'string' ? decoded.name : '',
          email: typeof decoded.email === 'string' ? decoded.email : '',
        },
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    if (error instanceof RazorpayConfigError) {
      return NextResponse.json(
        { error: error.message, code: 'RAZORPAY_NOT_CONFIGURED' },
        { status: 503, headers: NO_STORE_HEADERS }
      );
    }
    if (error instanceof RazorpayApiError) {
      const status = error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 502;
      return NextResponse.json(
        { error: error.message, code: error.gatewayCode || 'RAZORPAY_GATEWAY_ERROR' },
        { status, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to initialize Razorpay checkout order.',
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
