import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  computeItemsDigest,
  getRazorpayCredentials,
  RazorpayConfigError,
  signOrderContextToken,
  verifyOrderContextToken,
  verifyRazorpaySignature,
} from './razorpay';

test('getRazorpayCredentials throws RazorpayConfigError when credentials are absent', () => {
  const prevId = process.env.RAZORPAY_KEY_ID;
  const prevPublicId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const prevSecret = process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;

  try {
    assert.throws(() => getRazorpayCredentials(), RazorpayConfigError);
  } finally {
    if (prevId !== undefined) process.env.RAZORPAY_KEY_ID = prevId;
    if (prevPublicId !== undefined) process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = prevPublicId;
    if (prevSecret !== undefined) process.env.RAZORPAY_KEY_SECRET = prevSecret;
  }
});

test('getRazorpayCredentials supports NEXT_PUBLIC_RAZORPAY_KEY_ID runtime fallback and prefers RAZORPAY_KEY_ID', () => {
  const prevId = process.env.RAZORPAY_KEY_ID;
  const prevPublicId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const prevSecret = process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_KEY_ID;
  process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = 'rzp_live_CloudRunFallback123';
  process.env.RAZORPAY_KEY_SECRET = 'live_secret_value_for_unit_test_only';

  try {
    const fallbackCreds = getRazorpayCredentials();
    assert.equal(fallbackCreds.keyId, 'rzp_live_CloudRunFallback123');
    assert.equal(fallbackCreds.keySecret, 'live_secret_value_for_unit_test_only');

    process.env.RAZORPAY_KEY_ID = 'rzp_live_PrimaryServerKey456';
    const primaryCreds = getRazorpayCredentials();
    assert.equal(primaryCreds.keyId, 'rzp_live_PrimaryServerKey456');
  } finally {
    if (prevId !== undefined) process.env.RAZORPAY_KEY_ID = prevId;
    else delete process.env.RAZORPAY_KEY_ID;
    if (prevPublicId !== undefined) process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = prevPublicId;
    else delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    if (prevSecret !== undefined) process.env.RAZORPAY_KEY_SECRET = prevSecret;
    else delete process.env.RAZORPAY_KEY_SECRET;
  }
});

test('verifyRazorpaySignature validates authentic HMAC-SHA256 signatures and rejects tampered values', () => {
  const prevId = process.env.RAZORPAY_KEY_ID;
  const prevSecret = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_ID = 'rzp_live_TestKey12345';
  process.env.RAZORPAY_KEY_SECRET = 'live_secret_value_for_unit_test_only';

  try {
    const orderId = 'order_N9xA8bC7dE6fG5';
    const paymentId = 'pay_N9xA8bC7dE6fG9';
    const validSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    assert.equal(
      verifyRazorpaySignature({ orderId, paymentId, signature: validSig }),
      true
    );
    assert.equal(
      verifyRazorpaySignature({
        orderId,
        paymentId,
        signature: `${validSig.slice(0, -1)}0` === validSig ? `${validSig.slice(0, -1)}1` : `${validSig.slice(0, -1)}0`,
      }),
      false
    );
    assert.equal(
      verifyRazorpaySignature({
        orderId: 'order_TamperedOrder1',
        paymentId,
        signature: validSig,
      }),
      false
    );
  } finally {
    if (prevId !== undefined) process.env.RAZORPAY_KEY_ID = prevId;
    else delete process.env.RAZORPAY_KEY_ID;
    if (prevSecret !== undefined) process.env.RAZORPAY_KEY_SECRET = prevSecret;
    else delete process.env.RAZORPAY_KEY_SECRET;
  }
});

test('signOrderContextToken & verifyOrderContextToken detect tampering and expiry', () => {
  const prevId = process.env.RAZORPAY_KEY_ID;
  const prevSecret = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_ID = 'rzp_live_TestKey12345';
  process.env.RAZORPAY_KEY_SECRET = 'live_secret_value_for_unit_test_only';

  try {
    const token = signOrderContextToken({
      orderId: 'order_ABC123456789',
      userId: 'uid_learner_1',
      currency: 'INR',
      amountSubunits: 49900,
      items: [
        { collectionName: 'books', id: 'book_1' },
        { collectionName: 'ExamPackDocument', id: 'exam_1' },
      ],
      expMs: Date.now() + 60_000,
    });

    const verified = verifyOrderContextToken(token);
    assert.ok(verified);
    assert.equal(verified.orderId, 'order_ABC123456789');
    assert.equal(verified.items.length, 2);

    // Tampered token must fail
    const [bodyPart, sigPart] = token.split('.');
    const tamperedBody = Buffer.from(
      JSON.stringify({ ...verified, userId: 'uid_attacker' }),
      'utf8'
    ).toString('base64url');
    assert.equal(verifyOrderContextToken(`${tamperedBody}.${sigPart}`), null);

    // Expired token must fail
    const expiredToken = signOrderContextToken({
      ...verified,
      expMs: Date.now() - 1000,
    });
    assert.equal(verifyOrderContextToken(expiredToken), null);
    assert.ok(bodyPart.length > 0);
  } finally {
    if (prevId !== undefined) process.env.RAZORPAY_KEY_ID = prevId;
    else delete process.env.RAZORPAY_KEY_ID;
    if (prevSecret !== undefined) process.env.RAZORPAY_KEY_SECRET = prevSecret;
    else delete process.env.RAZORPAY_KEY_SECRET;
  }
});

test('computeItemsDigest is order-independent and price-sensitive', () => {
  const d1 = computeItemsDigest([
    { collectionName: 'books', id: 'b1', buyPrice: 199, currency: 'INR' },
    { collectionName: 'ExamPackDocument', id: 'e1', buyPrice: 499, currency: 'INR' },
  ]);
  const d2 = computeItemsDigest([
    { collectionName: 'ExamPackDocument', id: 'e1', buyPrice: 499, currency: 'INR' },
    { collectionName: 'books', id: 'b1', buyPrice: 199, currency: 'INR' },
  ]);
  const d3 = computeItemsDigest([
    { collectionName: 'books', id: 'b1', buyPrice: 198, currency: 'INR' },
    { collectionName: 'ExamPackDocument', id: 'e1', buyPrice: 499, currency: 'INR' },
  ]);

  assert.equal(d1, d2);
  assert.notEqual(d1, d3);
});
