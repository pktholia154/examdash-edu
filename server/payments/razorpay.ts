import crypto from 'node:crypto';
import https from 'node:https';
import type { CollectionName } from '../../lib/types/catalog';
import { getCanonicalOrigin } from '../../lib/seo/schema';

export class RazorpayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RazorpayConfigError';
  }
}

export class RazorpayApiError extends Error {
  public readonly statusCode: number;
  public readonly gatewayCode?: string;

  constructor(message: string, statusCode: number, gatewayCode?: string) {
    super(message);
    this.name = 'RazorpayApiError';
    this.statusCode = statusCode;
    this.gatewayCode = gatewayCode;
  }
}

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
}

const KEY_ID_REGEX = /^rzp_(live|test)_[a-zA-Z0-9]+$/;

/**
 * Strictly reads Razorpay API credentials from server-only environment variables.
 * Never falls back to mock or test credentials.
 */
export function getRazorpayCredentials(): RazorpayCredentials {
  // Bracket lookup prevents Next.js build-time inlining of NEXT_PUBLIC_* on server routes
  const runtimeEnv = process.env as Record<string, string | undefined>;
  const keyId = (
    runtimeEnv['RAZORPAY_KEY_ID'] ||
    runtimeEnv['NEXT_PUBLIC_RAZORPAY_KEY_ID'] ||
    ''
  ).trim();
  const keySecret = (runtimeEnv['RAZORPAY_KEY_SECRET'] || '').trim();

  if (
    !keyId ||
    !keySecret ||
    keyId.includes('MY_RAZORPAY') ||
    keySecret.includes('MY_RAZORPAY')
  ) {
    throw new RazorpayConfigError(
      'Razorpay live credentials are not configured. Set RAZORPAY_KEY_ID (or NEXT_PUBLIC_RAZORPAY_KEY_ID) and RAZORPAY_KEY_SECRET in server environment secrets.'
    );
  }

  if (!KEY_ID_REGEX.test(keyId)) {
    throw new RazorpayConfigError(
      'Invalid RAZORPAY_KEY_ID format. Expected a valid Razorpay key starting with rzp_live_.'
    );
  }

  return { keyId, keySecret };
}

export interface RazorpayOrderResponse {
  id: string;
  entity: 'order';
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: 'created' | 'attempted' | 'paid';
  attempts: number;
  notes: Record<string, string>;
  created_at: number;
}

export interface RazorpayPaymentResponse {
  id: string;
  entity: 'payment';
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  order_id: string;
  method?: string;
  captured: boolean;
  email?: string;
  contact?: string;
  error_code?: string | null;
  error_description?: string | null;
}

function callRazorpayApi<T>(
  method: 'GET' | 'POST',
  apiPath: string,
  credentials: RazorpayCredentials,
  body?: Record<string, unknown>
): Promise<T> {
  const authToken = Buffer.from(
    `${credentials.keyId}:${credentials.keySecret}`,
    'utf8'
  ).toString('base64');

  const payload = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.razorpay.com',
        port: 443,
        path: apiPath,
        method,
        headers: {
          Authorization: `Basic ${authToken}`,
          Accept: 'application/json',
          'User-Agent': 'ExamDash-Production/1.0 (+https://exam-dash.com)',
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
        timeout: 12000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode || 502;
          let parsed: Record<string, unknown> = {};
          try {
            parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
          } catch {
            // Non-JSON response body
          }

          if (status < 200 || status >= 300) {
            const errObj = parsed.error as
              | { description?: string; code?: string }
              | undefined;
            const message =
              errObj?.description ||
              `Razorpay gateway returned HTTP ${status}`;
            reject(new RazorpayApiError(message, status, errObj?.code));
            return;
          }

          resolve(parsed as unknown as T);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(
        new RazorpayApiError('Razorpay API request timed out.', 504)
      );
    });
    req.on('error', (err) => {
      reject(
        new RazorpayApiError(
          err.message || 'Unable to reach Razorpay API.',
          502
        )
      );
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

export interface OrderItemDigestInput {
  collectionName: CollectionName;
  id: string;
  buyPrice: number;
  currency: string;
  validityMonths?: number;
}

/**
 * Deterministic SHA-256 digest anchoring the exact catalog items, selected validity periods,
 * and authoritative prices stored in Razorpay order notes to prevent post-order tampering.
 */
export function computeItemsDigest(items: OrderItemDigestInput[]): string {
  const canonical = items
    .map((i) => {
      const base = `${i.collectionName}:${i.id}:${Math.round(i.buyPrice * 100)}:${i.currency.toUpperCase()}`;
      return typeof i.validityMonths === 'number'
        ? `${base}:v${i.validityMonths}`
        : base;
    })
    .sort()
    .join('|');

  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export async function createRazorpayOrder(params: {
  amountSubunits: number;
  currency: string;
  userId: string;
  itemsDigest: string;
  itemKeys: string[];
}): Promise<{ order: RazorpayOrderResponse; keyId: string }> {
  const creds = getRazorpayCredentials();
  const receiptRand = crypto.randomBytes(4).toString('hex');
  const receipt = `ed_${Date.now().toString(36)}_${receiptRand}`.slice(0, 40);
  const website = getCanonicalOrigin();

  // Razorpay notes values are max 256 chars each
  const compactItems = params.itemKeys.join(',').slice(0, 250);

  const order = await callRazorpayApi<RazorpayOrderResponse>(
    'POST',
    '/v1/orders',
    creds,
    {
      amount: params.amountSubunits,
      currency: params.currency.toUpperCase(),
      receipt,
      payment_capture: 1,
      notes: {
        userId: params.userId.slice(0, 128),
        website,
        itemCount: String(params.itemKeys.length),
        itemsDigest: params.itemsDigest,
        items: compactItems,
      },
    }
  );

  return { order, keyId: creds.keyId };
}

export async function fetchRazorpayOrder(
  orderId: string
): Promise<RazorpayOrderResponse> {
  const creds = getRazorpayCredentials();
  return callRazorpayApi<RazorpayOrderResponse>(
    'GET',
    `/v1/orders/${encodeURIComponent(orderId)}`,
    creds
  );
}

export async function fetchRazorpayPayment(
  paymentId: string
): Promise<RazorpayPaymentResponse> {
  const creds = getRazorpayCredentials();
  return callRazorpayApi<RazorpayPaymentResponse>(
    'GET',
    `/v1/payments/${encodeURIComponent(paymentId)}`,
    creds
  );
}

export async function captureRazorpayPayment(
  paymentId: string,
  amountSubunits: number,
  currency: string
): Promise<RazorpayPaymentResponse> {
  const creds = getRazorpayCredentials();
  return callRazorpayApi<RazorpayPaymentResponse>(
    'POST',
    `/v1/payments/${encodeURIComponent(paymentId)}/capture`,
    creds,
    {
      amount: amountSubunits,
      currency: currency.toUpperCase(),
    }
  );
}

/**
 * Verifies Razorpay Checkout signature: HMAC-SHA256(order_id + "|" + payment_id, key_secret)
 * using constant-time comparison.
 */
export function verifyRazorpaySignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const creds = getRazorpayCredentials();
  if (!params.orderId || !params.paymentId || !params.signature) {
    return false;
  }

  const expectedHex = crypto
    .createHmac('sha256', creds.keySecret)
    .update(`${params.orderId}|${params.paymentId}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedHex, 'utf8');
  const providedBuf = Buffer.from(params.signature.trim(), 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}

export interface SignedOrderContextPayload {
  orderId: string;
  userId: string;
  currency: string;
  amountSubunits: number;
  items: Array<{
    collectionName: CollectionName;
    id: string;
    validityMonths?: number;
  }>;
  expMs: number;
}

/**
 * Signs an order context payload using RAZORPAY_KEY_SECRET so verify requests cannot alter
 * the item manifest associated with a Razorpay order.
 */
export function signOrderContextToken(
  payload: SignedOrderContextPayload
): string {
  const creds = getRazorpayCredentials();
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url'
  );
  const sig = crypto
    .createHmac('sha256', creds.keySecret)
    .update(`ed_order_ctx:${encoded}`)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyOrderContextToken(
  token: string
): SignedOrderContextPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) return null;

  const creds = getRazorpayCredentials();
  const expectedSig = crypto
    .createHmac('sha256', creds.keySecret)
    .update(`ed_order_ctx:${encoded}`)
    .digest('base64url');

  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  const providedBuf = Buffer.from(providedSig, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) return null;

  try {
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as SignedOrderContextPayload;
    if (
      !parsed ||
      typeof parsed.orderId !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.currency !== 'string' ||
      typeof parsed.amountSubunits !== 'number' ||
      typeof parsed.expMs !== 'number' ||
      !Array.isArray(parsed.items)
    ) {
      return null;
    }
    if (Date.now() > parsed.expMs) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
