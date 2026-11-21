import type {
  CollectionName,
  ItemReviewDTO,
  ItemReviewSummaryDTO,
  RatingDistribution,
  ReviewAggregateBadge,
} from '../types/catalog';

// Synchronized verbatim with firebase-blueprint.json#/entities/ItemReview
export const REVIEW_ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;
export const REVIEW_SLUG_PATTERN = /^[a-z0-9\-]+$/;
export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;
export const REVIEW_TITLE_MAX_LENGTH = 120;
export const REVIEW_COMMENT_MIN_LENGTH = 10;
export const REVIEW_COMMENT_MAX_LENGTH = 2000;
export const REVIEW_AUTHOR_MAX_LENGTH = 80;
export const REVIEW_ITEM_ID_MAX_LENGTH = 64;

export function sanitizeReviewItemId(rawItemId: string): string {
  return (rawItemId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, REVIEW_ITEM_ID_MAX_LENGTH);
}

export function buildReviewTargetKey(
  collectionName: CollectionName,
  rawItemId: string
): string {
  const safeId = sanitizeReviewItemId(rawItemId);
  return `${collectionName}_${safeId}`;
}

export function buildDeterministicReviewId(
  collectionName: CollectionName,
  rawItemId: string,
  userId: string
): string {
  const safeId = sanitizeReviewItemId(rawItemId);
  const safeUid = (userId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${collectionName}_${safeId}_${safeUid}`.slice(0, 128);
}

export function sanitizeReviewAuthorName(
  displayName?: string | null,
  fallback: string = 'ExamDash Learner'
): string {
  const cleaned = (displayName || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, REVIEW_AUTHOR_MAX_LENGTH);
  return cleaned.length >= 1 ? cleaned : fallback;
}

export type ValidatedReviewSubmission =
  | {
      ok: true;
      rating: 1 | 2 | 3 | 4 | 5;
      title?: string;
      comment: string;
    }
  | {
      ok: false;
      error: string;
    };

export function validateReviewSubmission(input: {
  rating: unknown;
  title?: unknown;
  comment: unknown;
}): ValidatedReviewSubmission {
  const numericRating =
    typeof input.rating === 'number' ? input.rating : Number(input.rating);

  if (
    !Number.isInteger(numericRating) ||
    numericRating < REVIEW_RATING_MIN ||
    numericRating > REVIEW_RATING_MAX
  ) {
    return {
      ok: false,
      error: 'Please select a star rating from 1 to 5.',
    };
  }

  let normalizedTitle: string | undefined;
  if (input.title !== undefined && input.title !== null) {
    if (typeof input.title !== 'string') {
      return { ok: false, error: 'Review headline must be text.' };
    }
    const trimmedTitle = input.title.replace(/\s+/g, ' ').trim();
    if (trimmedTitle.length > REVIEW_TITLE_MAX_LENGTH) {
      return {
        ok: false,
        error: `Review headline must be ${REVIEW_TITLE_MAX_LENGTH} characters or fewer.`,
      };
    }
    if (trimmedTitle.length > 0) {
      normalizedTitle = trimmedTitle;
    }
  }

  if (typeof input.comment !== 'string') {
    return { ok: false, error: 'Please write your review comment.' };
  }

  const normalizedComment = input.comment.replace(/\r\n/g, '\n').trim();
  if (normalizedComment.length < REVIEW_COMMENT_MIN_LENGTH) {
    return {
      ok: false,
      error: `Review comment must be at least ${REVIEW_COMMENT_MIN_LENGTH} characters.`,
    };
  }

  if (normalizedComment.length > REVIEW_COMMENT_MAX_LENGTH) {
    return {
      ok: false,
      error: `Review comment must be ${REVIEW_COMMENT_MAX_LENGTH} characters or fewer.`,
    };
  }

  return {
    ok: true,
    rating: numericRating as 1 | 2 | 3 | 4 | 5,
    ...(normalizedTitle ? { title: normalizedTitle } : {}),
    comment: normalizedComment,
  };
}

export function createEmptyReviewSummary(
  collectionName: CollectionName,
  rawItemId: string
): ItemReviewSummaryDTO {
  return {
    targetKey: buildReviewTargetKey(collectionName, rawItemId),
    collectionName,
    itemId: sanitizeReviewItemId(rawItemId),
    reviewCount: 0,
    averageRating: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    reviews: [],
  };
}

export function computeItemReviewSummary(
  collectionName: CollectionName,
  rawItemId: string,
  reviews: ItemReviewDTO[]
): ItemReviewSummaryDTO {
  const safeItemId = sanitizeReviewItemId(rawItemId);
  const targetKey = `${collectionName}_${safeItemId}`;
  const distribution: RatingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  const validReviews = (Array.isArray(reviews) ? reviews : []).filter(
    (r) =>
      Number.isInteger(r.rating) &&
      r.rating >= REVIEW_RATING_MIN &&
      r.rating <= REVIEW_RATING_MAX &&
      typeof r.comment === 'string' &&
      r.comment.trim().length > 0
  );

  if (validReviews.length === 0) {
    return createEmptyReviewSummary(collectionName, safeItemId);
  }

  let ratingSum = 0;
  for (const r of validReviews) {
    distribution[r.rating] += 1;
    ratingSum += r.rating;
  }

  const sorted = [...validReviews].sort((a, b) => {
    const aTime = new Date(a.updatedAtIso || a.createdAtIso).getTime() || 0;
    const bTime = new Date(b.updatedAtIso || b.createdAtIso).getTime() || 0;
    return bTime - aTime;
  });

  const averageRating = Number((ratingSum / validReviews.length).toFixed(2));

  return {
    targetKey,
    collectionName,
    itemId: safeItemId,
    reviewCount: validReviews.length,
    averageRating,
    distribution,
    reviews: sorted,
  };
}

export function computeReviewAggregateMap(
  reviews: Array<{ targetKey: string; rating: number }>
): Map<string, ReviewAggregateBadge> {
  const buckets = new Map<string, { sum: number; count: number }>();

  for (const row of reviews) {
    if (
      !row.targetKey ||
      !Number.isInteger(row.rating) ||
      row.rating < REVIEW_RATING_MIN ||
      row.rating > REVIEW_RATING_MAX
    ) {
      continue;
    }
    const prev = buckets.get(row.targetKey) || { sum: 0, count: 0 };
    prev.sum += row.rating;
    prev.count += 1;
    buckets.set(row.targetKey, prev);
  }

  const out = new Map<string, ReviewAggregateBadge>();
  for (const [key, val] of buckets.entries()) {
    if (val.count > 0) {
      out.set(key, {
        averageRating: Number((val.sum / val.count).toFixed(2)),
        reviewCount: val.count,
      });
    }
  }
  return out;
}
