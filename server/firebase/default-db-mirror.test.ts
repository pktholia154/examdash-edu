import { describe, expect, it } from 'bun:test';
import {
  buildFirebaseStorageHeaders,
  computeDefaultDbEntitlementProof,
} from './default-db-mirror';

describe('default-db-mirror helpers', () => {
  it('generates verifiable base64url payload + hmac signature matching (default) entitlementProof format', () => {
    const proof = computeDefaultDbEntitlementProof({
      uid: 'wynWtZDeRhNogOi8fT5re7tAwJl1',
      itemId: 'B2',
      contentType: 'books',
      orderId: 'order_test123',
      paymentId: 'pay_test456',
    });

    const parts = proof.split('.');
    expect(parts.length).toBe(2);
    const decoded = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8')
    ) as Record<string, unknown>;

    expect(decoded.uid).toBe('wynWtZDeRhNogOi8fT5re7tAwJl1');
    expect(decoded.itemId).toBe('B2');
    expect(decoded.contentType).toBe('books');
    expect(decoded.orderId).toBe('order_test123');
    expect(decoded.paymentId).toBe('pay_test456');
    expect(typeof decoded.issuedAt).toBe('number');
    expect(parts[1].length).toBeGreaterThan(20);
  });

  it('attaches Firebase Storage SDK headers and omits Authorization when URL already has token param', () => {
    const withAuth = buildFirebaseStorageHeaders(
      'sample-id-token',
      { Accept: '*/*' },
      {
        omitAuthIfTokenParamPresent: true,
        targetUrl:
          'https://firebasestorage.googleapis.com/v0/b/examdash-ed.firebasestorage.app/o/public%2Fpdfs%2FB2_full.pdf?alt=media',
      }
    );
    expect(withAuth.Authorization).toBe('Firebase sample-id-token');
    expect(withAuth['X-Firebase-Storage-Version']).toBe('webjs/13.4.0');
    expect(withAuth['X-Firebase-GMPID']).toBeTruthy();

    const withDownloadToken = buildFirebaseStorageHeaders(
      'sample-id-token',
      { Accept: '*/*' },
      {
        omitAuthIfTokenParamPresent: true,
        targetUrl:
          'https://firebasestorage.googleapis.com/v0/b/examdash-ed.firebasestorage.app/o/public%2Fpdfs%2FB2_full.pdf?alt=media&token=abc-123',
      }
    );
    expect(withDownloadToken.Authorization).toBeUndefined();
    expect(withDownloadToken['X-Firebase-Storage-Version']).toBe('webjs/13.4.0');
  });
});
