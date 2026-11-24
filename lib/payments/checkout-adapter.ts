'use client';

/**
 * Platform-Isolated CheckoutAdapter (Pillar 9 & Module 5)
 * - Web (`!isCapacitorNative()`): Lazy-loads Razorpay Web Checkout SDK strictly on Buy Now / Checkout click
 * - Capacitor Native (`isCapacitorNative()`): Routes through Native StoreKit 2 (iOS) / Play Billing (Android)
 * - Free (`buyPrice === 0`): Claims directly via `/api/v1/payments/claim-free`
 */
import type { AppAuthUser } from '../auth/auth-adapter';
import { apiUrl } from '../platform/api-base';
import {
  createUuidV7,
  getCapacitorPlatform,
  isCapacitorNative,
} from '../platform/capacitor-bridge';
import type { CollectionName, UserPurchaseRecord } from '../types/catalog';

export interface CheckoutItemRef {
  collectionName: CollectionName;
  id: string;
  validityMonths?: number;
}

export type CheckoutOutcome =
  | { status: 'completed'; purchases: UserPurchaseRecord[]; alreadyOwned?: boolean }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

interface NativeBillingPlugin {
  purchaseProduct?: (opts: {
    productIdentifier: string;
    productType?: string;
  }) => Promise<{
    transactionId?: string;
    receipt?: string;
    purchaseToken?: string;
  }>;
}

function getNativeBillingPlugin(): NativeBillingPlugin | undefined {
  if (typeof window === 'undefined') return undefined;
  const win = window as unknown as {
    Capacitor?: {
      Plugins?: {
        NativePurchases?: NativeBillingPlugin;
      };
    };
  };
  return win.Capacitor?.Plugins?.NativePurchases;
}

interface RazorpayOrderApiResponse {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  orderToken: string;
  description: string;
  itemCount: number;
  prefill?: {
    name?: string;
    email?: string;
  };
}

interface VerifyPaymentApiResponse {
  verified: boolean;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  purchases: UserPurchaseRecord[];
}

export async function claimFreeThroughCheckoutAdapter(params: {
  refs: CheckoutItemRef[];
  token: string;
}): Promise<CheckoutOutcome> {
  try {
    const res = await fetch(apiUrl('/api/v1/payments/claim-free'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.token}`,
        'Idempotency-Key': createUuidV7(),
      },
      body: JSON.stringify({ items: params.refs }),
    });

    const payload = (await res.json().catch(() => ({}))) as {
      purchases?: UserPurchaseRecord[];
      error?: string;
    };

    if (!res.ok || !Array.isArray(payload.purchases)) {
      return {
        status: 'error',
        message: payload.error || 'Could not claim free resource. Please try again.',
      };
    }

    return { status: 'completed', purchases: payload.purchases };
  } catch {
    return {
      status: 'error',
      message: 'Network error while claiming free resource.',
    };
  }
}

export async function purchasePaidThroughCheckoutAdapter(params: {
  refs: CheckoutItemRef[];
  user: AppAuthUser;
  initialToken: string;
}): Promise<CheckoutOutcome> {
  // 1. Capacitor Native Branch -> StoreKit 2 (iOS) / Google Play Billing (Android)
  if (isCapacitorNative()) {
    const nativeBilling = getNativeBillingPlugin();
    if (!nativeBilling?.purchaseProduct) {
      return {
        status: 'error',
        message:
          'Native In-App Purchases are unavailable in this build. Please update the app from the store.',
      };
    }

    const validitySuffix =
      typeof params.refs[0].validityMonths === 'number'
        ? `_v${params.refs[0].validityMonths}m`
        : '';
    const primarySku = `ed_${params.refs[0].collectionName.toLowerCase()}_${params.refs[0].id}${validitySuffix}`
      .replace(/[^a-zA-Z0-9._]/g, '_')
      .slice(0, 100);

    try {
      const tx = await nativeBilling.purchaseProduct({
        productIdentifier: primarySku,
        productType: 'NON_CONSUMABLE',
      });

      const receiptToken = tx?.receipt || tx?.purchaseToken || '';
      const transactionId = tx?.transactionId || '';
      if (!receiptToken || !transactionId) {
        return { status: 'cancelled' };
      }

      const freshToken = await params.user.getIdToken();
      const verifyRes = await fetch(apiUrl('/api/v1/payments/native/verify'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${freshToken}`,
          'Idempotency-Key': createUuidV7(),
        },
        body: JSON.stringify({
          platform: getCapacitorPlatform() === 'ios' ? 'ios' : 'android',
          receiptToken,
          transactionId,
          items: params.refs,
        }),
      });

      const verifyData = (await verifyRes.json().catch(() => ({}))) as {
        verified?: boolean;
        purchases?: UserPurchaseRecord[];
        error?: string;
      };

      if (!verifyRes.ok || !verifyData.verified || !Array.isArray(verifyData.purchases)) {
        return {
          status: 'error',
          message:
            verifyData.error || 'Unable to verify native store receipt on server.',
        };
      }

      return { status: 'completed', purchases: verifyData.purchases };
    } catch {
      return { status: 'cancelled' };
    }
  }

  // 2. Web Branch -> Server Order + Dynamically Imported Razorpay Checkout SDK
  try {
    const orderRes = await fetch(apiUrl('/api/v1/payments/razorpay/order'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.initialToken}`,
        'Idempotency-Key': createUuidV7(),
      },
      body: JSON.stringify({ items: params.refs }),
    });

    const orderData = (await orderRes.json().catch(() => ({}))) as Partial<
      RazorpayOrderApiResponse
    > & { error?: string; alreadyOwned?: boolean };

    if (!orderRes.ok) {
      if (orderRes.status === 409 && orderData.alreadyOwned) {
        return { status: 'completed', purchases: [], alreadyOwned: true };
      }
      return {
        status: 'error',
        message:
          orderData.error || 'Unable to start Razorpay checkout. Please try again.',
      };
    }

    if (
      !orderData.keyId ||
      !orderData.orderId ||
      !orderData.amount ||
      !orderData.currency ||
      !orderData.orderToken
    ) {
      return {
        status: 'error',
        message: 'Incomplete order response from payment server.',
      };
    }

    const { openRazorpayCheckoutModal } = await import('./razorpay-client');
    const modalOutcome = await openRazorpayCheckoutModal({
      key: orderData.keyId,
      amount: orderData.amount,
      currency: orderData.currency,
      name: 'ExamDash',
      description: orderData.description || 'ExamDash Study Resources',
      image: 'https://exam-dash.com/pwa-192x192.png',
      order_id: orderData.orderId,
      prefill: {
        name: orderData.prefill?.name || params.user.displayName || '',
        email: orderData.prefill?.email || params.user.email || '',
      },
      notes: {
        website: 'https://exam-dash.com',
      },
      theme: {
        color: '#0F172A',
      },
    });

    if (modalOutcome.status === 'dismissed') {
      return { status: 'cancelled' };
    }

    if (modalOutcome.status === 'failed') {
      return { status: 'error', message: modalOutcome.message };
    }

    const freshToken = await params.user.getIdToken();
    const verifyRes = await fetch(apiUrl('/api/v1/payments/razorpay/verify'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${freshToken}`,
        'Idempotency-Key': createUuidV7(),
      },
      body: JSON.stringify({
        razorpay_order_id: modalOutcome.payload.razorpay_order_id,
        razorpay_payment_id: modalOutcome.payload.razorpay_payment_id,
        razorpay_signature: modalOutcome.payload.razorpay_signature,
        orderToken: orderData.orderToken,
      }),
    });

    const verifyData = (await verifyRes.json().catch(() => ({}))) as Partial<
      VerifyPaymentApiResponse
    > & { error?: string };

    if (!verifyRes.ok || !verifyData.verified || !Array.isArray(verifyData.purchases)) {
      return {
        status: 'error',
        message:
          verifyData.error ||
          `Payment verification failed. Save payment ID ${modalOutcome.payload.razorpay_payment_id} and contact support.`,
      };
    }

    return { status: 'completed', purchases: verifyData.purchases };
  } catch (err) {
    return {
      status: 'error',
      message:
        err instanceof Error
          ? err.message
          : 'Unable to complete checkout. Please try again.',
    };
  }
}
