import { revalidatePath, revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { validateReviewSubmission } from '../../../../lib/reviews/validation';
import { submitIndexNowBatch } from '../../../../lib/seo/indexnow';
import type { CollectionName } from '../../../../lib/types/catalog';
import { verifyBearerIdToken } from '../../../../server/firebase/verify-auth';
import {
  deleteUserItemReview,
  getItemReviewsSummary,
  upsertUserItemReview,
} from '../../../../server/repositories/review-repository';

function revalidateReviewRoutes(
  collectionName: CollectionName,
  itemId: string,
  urlSlug?: string
) {
  const hubPath = collectionName === 'books' ? '/books' : '/exams';
  const detailPath = urlSlug ? `${hubPath}/${urlSlug}` : null;
  try {
    revalidateTag('reviews');
    revalidateTag(`reviews:${collectionName}:${itemId}`);
    revalidateTag('catalog');
    if (urlSlug) {
      revalidateTag(
        collectionName === 'books' ? `book:${urlSlug}` : `exam:${urlSlug}`
      );
    }
    revalidatePath('/');
    revalidatePath(hubPath);
    if (detailPath) {
      revalidatePath(detailPath);
    }
  } catch {
    // Revalidation errors must never block the review response
  }

  if (detailPath) {
    void submitIndexNowBatch([detailPath]).catch(() => undefined);
  }
}

function parseCollectionParam(raw: unknown): CollectionName | null {
  if (raw === 'books' || raw === 'ExamPackDocument') {
    return raw;
  }
  return null;
}

function extractRawBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  return token || null;
}

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const collectionName = parseCollectionParam(searchParams.get('collection'));
  const itemId = (searchParams.get('itemId') || '').trim();

  if (!collectionName || !itemId || itemId.length > 64) {
    return NextResponse.json(
      { error: 'Valid collection and itemId query parameters are required.' },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  const summary = await getItemReviewsSummary(collectionName, itemId);
  return NextResponse.json(
    { summary },
    { status: 200, headers: PRIVATE_NO_STORE_HEADERS }
  );
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const bearerIdToken = extractRawBearerToken(authHeader);
  const decoded = await verifyBearerIdToken(authHeader);

  if (!decoded || !bearerIdToken) {
    return NextResponse.json(
      { error: 'Please sign in to submit a rating and review.' },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  if (decoded.email_verified !== true) {
    return NextResponse.json(
      { error: 'A verified email account is required to post reviews.' },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request body.' },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  const collectionName = parseCollectionParam(body.collectionName);
  const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';

  if (!collectionName || !itemId || itemId.length > 64) {
    return NextResponse.json(
      { error: 'Valid collectionName and itemId are required.' },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  const validation = validateReviewSubmission({
    rating: body.rating,
    title: body.title,
    comment: body.comment,
  });

  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  const displayNameFromBody =
    typeof body.authorDisplayName === 'string' ? body.authorDisplayName : null;

  const result = await upsertUserItemReview({
    userId: decoded.uid,
    userDisplayName: decoded.name || displayNameFromBody,
    userEmail: decoded.email || null,
    userPhotoUrl: decoded.picture || null,
    bearerIdToken,
    collectionName,
    itemId,
    rating: validation.rating,
    title: validation.title,
    comment: validation.comment,
  });

  if (result.status === 'not_found') {
    return NextResponse.json(
      { error: result.error },
      { status: 404, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  if (result.status === 'error') {
    return NextResponse.json(
      { error: result.error },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  revalidateReviewRoutes(collectionName, itemId, result.urlSlug);

  return NextResponse.json(
    {
      reviewId: result.reviewId,
      summary: result.summary,
    },
    { status: 200, headers: PRIVATE_NO_STORE_HEADERS }
  );
}

export async function DELETE(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const bearerIdToken = extractRawBearerToken(authHeader);
  const decoded = await verifyBearerIdToken(authHeader);

  if (!decoded || !bearerIdToken) {
    return NextResponse.json(
      { error: 'Authentication required to delete your review.' },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  if (decoded.email_verified !== true) {
    return NextResponse.json(
      { error: 'A verified email account is required.' },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  const { searchParams } = new URL(req.url);
  const collectionName = parseCollectionParam(searchParams.get('collection'));
  const itemId = (searchParams.get('itemId') || '').trim();

  if (!collectionName || !itemId || itemId.length > 64) {
    return NextResponse.json(
      { error: 'Valid collection and itemId query parameters are required.' },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  const result = await deleteUserItemReview({
    userId: decoded.uid,
    bearerIdToken,
    collectionName,
    itemId,
  });

  if (result.status === 'error') {
    return NextResponse.json(
      { error: result.error },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  revalidateReviewRoutes(collectionName, itemId, result.urlSlug);

  return NextResponse.json(
    { summary: result.summary },
    { status: 200, headers: PRIVATE_NO_STORE_HEADERS }
  );
}
