import { NextRequest, NextResponse } from 'next/server';
import { verifyBearerIdToken } from '../../../../server/firebase/verify-auth';
import {
  deleteUserProfileFromFirestore,
  listUserPurchasesFromFirestore,
  syncUserProfileInFirestore,
} from '../../../../server/payments/purchase-persistence';

/**
 * One-Shot Authenticated Library Entitlements Endpoint (`GET /api/v1/library`)
 * Replaces client-side Firestore `onSnapshot` (`Listen/channel`) listeners so zero
 * `firestore.googleapis.com` XHRs ever execute in Web or Capacitor browsers.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const decoded = await verifyBearerIdToken(authHeader);

  if (!decoded?.uid || !authHeader) {
    return NextResponse.json(
      { error: 'Unauthorized', purchases: [] },
      {
        status: 401,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }

  const rawBearerToken = authHeader.slice('Bearer '.length).trim();
  const shouldSyncProfile = req.nextUrl.searchParams.get('syncProfile') === '1';

  try {
    if (shouldSyncProfile) {
      await syncUserProfileInFirestore({
        userId: decoded.uid,
        emailVerified: Boolean(decoded.email_verified),
        displayName: decoded.name ?? null,
        email: decoded.email ?? null,
        photoURL: decoded.picture ?? null,
        bearerIdToken: rawBearerToken,
      });
    }

    const purchases = await listUserPurchasesFromFirestore(
      decoded.uid,
      rawBearerToken
    );

    return NextResponse.json(
      { purchases },
      {
        status: 200,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to fetch library entitlements',
        purchases: [],
      },
      {
        status: 500,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }
}

/**
 * Self-Serve Account Profile Cleanup (`DELETE /api/v1/library`)
 * Removes `/users/{uid}/private/contact` and `/users/{uid}` prior to Firebase Auth `deleteUser()`.
 */
export async function DELETE(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const decoded = await verifyBearerIdToken(authHeader);

  if (!decoded?.uid || !authHeader) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      {
        status: 401,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }

  const rawBearerToken = authHeader.slice('Bearer '.length).trim();
  await deleteUserProfileFromFirestore(decoded.uid, rawBearerToken);

  return NextResponse.json(
    { deleted: true },
    {
      status: 200,
      headers: { 'Cache-Control': 'private, no-store' },
    }
  );
}
