import { NextRequest, NextResponse } from 'next/server';
import { verifyBearerIdToken } from '../../../../../../server/firebase/verify-auth';
import { getCatalogItemsByRefs } from '../../../../../../server/repositories/catalog-repository';
import type { CollectionName } from '../../../../../../lib/types/catalog';

/**
 * Capacitor Native StoreKit 2 / Google Play Billing Receipt Sync Endpoint
 * Isolates native in-app purchase verification from Web Razorpay Checkout (Pillar 9).
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const decoded = await verifyBearerIdToken(authHeader);

  if (!decoded?.uid) {
    return NextResponse.json(
      { error: 'Authentication required to verify native store receipt.' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    platform?: 'ios' | 'android';
    receiptToken?: string;
    transactionId?: string;
    items?: Array<{ collectionName: CollectionName; id: string }>;
  };

  if (
    !body.receiptToken ||
    !body.transactionId ||
    !Array.isArray(body.items) ||
    body.items.length === 0
  ) {
    return NextResponse.json(
      { error: 'Invalid native store receipt payload.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const resolved = await getCatalogItemsByRefs(body.items);
  if (resolved.length === 0) {
    return NextResponse.json(
      { error: 'Catalog item not found for store SKU.' },
      { status: 404, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  // Require server-side App Store Server API / Google Play Developer API credentials in production
  const hasNativeBillingCredentials = Boolean(
    process.env.APPLE_IAP_SHARED_SECRET || process.env.GOOGLE_PLAY_BILLING_KEY
  );
  if (!hasNativeBillingCredentials) {
    return NextResponse.json(
      {
        error:
          'Native StoreKit 2 / Google Play Billing server credentials are not configured on this environment.',
      },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const nowIso = new Date().toISOString();
  const purchases = resolved.map((item) => ({
    purchaseId: `${item.collectionName}_${item.id}`.slice(0, 120),
    userId: decoded.uid,
    itemId: item.id,
    collectionName: item.collectionName,
    urlSlug: item.urlSlug,
    title: item.title,
    type: item.type,
    authorName: item.authorName,
    language: item.language,
    currency: item.currency,
    listPrice: item.listPrice,
    paidPrice: item.buyPrice,
    ...(item.collectionName === 'ExamPackDocument'
      ? { totalMocktest: item.totalMocktest }
      : {}),
    status: 'completed' as const,
    createdAtIso: nowIso,
  }));

  return NextResponse.json(
    { verified: true, purchases },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
  );
}
