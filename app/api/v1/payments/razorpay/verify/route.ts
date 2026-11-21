import { NextRequest, NextResponse } from 'next/server';
import { verifyBearerIdToken } from '../../../../../../server/firebase/verify-auth';
import { getCatalogItemsByRefs } from '../../../../../../server/repositories/catalog-repository';
import {
  captureRazorpayPayment,
  computeItemsDigest,
  fetchRazorpayOrder,
  fetchRazorpayPayment,
  RazorpayApiError,
  RazorpayConfigError,
  verifyOrderContextToken,
  verifyRazorpaySignature,
} from '../../../../../../server/payments/razorpay';
import { commitVerifiedPurchasesToFirestore } from '../../../../../../server/payments/purchase-persistence';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };
const ORDER_ID_REGEX = /^order_[a-zA-Z0-9]{6,58}$/;
const PAYMENT_ID_REGEX = /^pay_[a-zA-Z0-9]{6,58}$/;
const SIGNATURE_HEX_REGEX = /^[a-fA-F0-9]{64}$/;

interface VerifyPaymentBody {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
  orderToken?: string;
}

/**
 * Production Razorpay Payment Verification & Library Entitlement Endpoint
 * (`POST /api/v1/payments/razorpay/verify`)
 *
 * Performs multi-layer server-side verification without webhooks:
 * 1. Verifies Firebase Bearer ID token & verified email.
 * 2. Verifies HMAC-SHA256 Razorpay Checkout signature (constant-time).
 * 3. Verifies signed order context token (userId, orderId, expiry).
 * 4. Calls Razorpay Orders & Payments REST APIs directly to confirm payment status,
 *    auto-captures if authorized, and cross-checks amount, currency, userId, and item digest.
 * 5. Atomically persists all purchased Books & Exam Packs to `/users/{uid}/purchases`
 *    and clears purchased items from `/users/{uid}/cart`.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const decoded = await verifyBearerIdToken(authHeader);
  if (!decoded || !decoded.uid) {
    return NextResponse.json(
      { error: 'Authentication required to verify payment.' },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }
  if (decoded.email_verified !== true) {
    return NextResponse.json(
      { error: 'A verified email address is required to unlock purchases.' },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  const rawBearerToken =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';

  let body: VerifyPaymentBody = {};
  try {
    body = (await req.json()) as VerifyPaymentBody;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON verification payload.' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const orderId = (body.razorpay_order_id || '').trim();
  const paymentId = (body.razorpay_payment_id || '').trim();
  const signature = (body.razorpay_signature || '').trim();
  const orderToken = (body.orderToken || '').trim();

  if (
    !ORDER_ID_REGEX.test(orderId) ||
    !PAYMENT_ID_REGEX.test(paymentId) ||
    !SIGNATURE_HEX_REGEX.test(signature) ||
    !orderToken
  ) {
    return NextResponse.json(
      { error: 'Incomplete or malformed Razorpay payment verification parameters.' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    // Layer 1: Cryptographic HMAC-SHA256 signature verification
    const signatureValid = verifyRazorpaySignature({
      orderId,
      paymentId,
      signature,
    });
    if (!signatureValid) {
      return NextResponse.json(
        { error: 'Razorpay payment signature verification failed.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    // Layer 2: Signed order context verification
    const orderContext = verifyOrderContextToken(orderToken);
    if (
      !orderContext ||
      orderContext.orderId !== orderId ||
      orderContext.userId !== decoded.uid
    ) {
      return NextResponse.json(
        { error: 'Payment session token does not match the signed-in user or order.' },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    // Layer 3: Authoritative server-to-server Razorpay API verification
    const [order, fetchedPayment] = await Promise.all([
      fetchRazorpayOrder(orderId),
      fetchRazorpayPayment(paymentId),
    ]);

    let payment = fetchedPayment;

    if (payment.order_id !== order.id) {
      return NextResponse.json(
        { error: 'Payment does not belong to this Razorpay order.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    if (order.notes?.userId !== decoded.uid) {
      return NextResponse.json(
        { error: 'Razorpay order ownership mismatch.' },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    if (
      payment.amount !== order.amount ||
      payment.currency.toUpperCase() !== order.currency.toUpperCase()
    ) {
      return NextResponse.json(
        { error: 'Payment amount or currency mismatch with order.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    // Ensure production capture if Razorpay returned authorized state
    if (payment.status === 'authorized') {
      payment = await captureRazorpayPayment(
        payment.id,
        order.amount,
        order.currency
      );
    }

    if (payment.status !== 'captured') {
      return NextResponse.json(
        {
          error: `Payment was not captured (status: ${payment.status}). Please retry or contact support with payment ID ${payment.id}.`,
        },
        { status: 402, headers: NO_STORE_HEADERS }
      );
    }

    // Layer 4: Re-verify authoritative catalog items & tamper-proof digest stored in Razorpay order notes
    const authoritativeItems = await getCatalogItemsByRefs(orderContext.items);
    if (authoritativeItems.length !== orderContext.items.length) {
      return NextResponse.json(
        { error: 'Catalog item resolution failed during purchase fulfillment.' },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }

    const currency = order.currency.toUpperCase();
    const recomputedDigest = computeItemsDigest(
      authoritativeItems.map((item) => ({
        collectionName: item.collectionName,
        id: item.id,
        buyPrice: item.buyPrice,
        currency,
      }))
    );

    const expectedSubunits = Math.round(
      authoritativeItems.reduce((acc, item) => acc + Math.max(0, item.buyPrice), 0) *
        100
    );

    if (
      order.notes?.itemsDigest !== recomputedDigest ||
      expectedSubunits !== order.amount
    ) {
      return NextResponse.json(
        {
          error:
            'Order manifest integrity check failed. Please contact support with your payment ID.',
        },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }

    // Layer 5: Atomically commit all purchased Books & Exam Packs to Firestore `/users/{uid}/purchases`
    const purchases = await commitVerifiedPurchasesToFirestore({
      userId: decoded.uid,
      userDisplayName: typeof decoded.name === 'string' ? decoded.name : null,
      userEmail: typeof decoded.email === 'string' ? decoded.email : null,
      userPhotoUrl: typeof decoded.picture === 'string' ? decoded.picture : null,
      bearerIdToken: rawBearerToken,
      items: authoritativeItems,
      razorpayOrderId: order.id,
      razorpayPaymentId: payment.id,
    });

    return NextResponse.json(
      {
        verified: true,
        razorpayOrderId: order.id,
        razorpayPaymentId: payment.id,
        purchases,
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
      const status =
        error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 502;
      return NextResponse.json(
        { error: error.message, code: error.gatewayCode || 'RAZORPAY_VERIFY_ERROR' },
        { status, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to verify payment and unlock library resources.',
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
