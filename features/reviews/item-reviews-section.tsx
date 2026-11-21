'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Pencil, Star, Trash2 } from 'lucide-react';
import { apiUrl } from '../../lib/platform/api-base';
import { isCapacitorNative } from '../../lib/platform/capacitor-bridge';
import { makeCompositeKey } from '../../lib/registry/content-type-registry';
import {
  REVIEW_COMMENT_MAX_LENGTH,
  REVIEW_COMMENT_MIN_LENGTH,
  REVIEW_TITLE_MAX_LENGTH,
  validateReviewSubmission,
} from '../../lib/reviews/validation';
import type {
  CollectionName,
  ItemReviewSummaryDTO,
} from '../../lib/types/catalog';
import { cn } from '../../lib/utils';
import { useAuth } from '../auth/auth-provider';
import { useToast } from '../toast/toast-context';

export interface ItemReviewsSectionProps {
  collectionName: CollectionName;
  itemId: string;
  itemTitle: string;
  initialSummary: ItemReviewSummaryDTO;
}

const STAR_VALUES = [1, 2, 3, 4, 5] as const;
const DISTRIBUTION_ORDER = [5, 4, 3, 2, 1] as const;

const RATING_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Needs improvement',
  2: 'Fair',
  3: 'Good',
  4: 'Very good',
  5: 'Excellent',
};

function formatReviewDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function StarRow({
  rating,
  sizeClass = 'w-4 h-4',
}: {
  rating: number;
  sizeClass?: string;
}) {
  const rounded = Math.round(rating);
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`Rated ${Number(rating.toFixed(1))} out of 5 stars`}
    >
      {STAR_VALUES.map((star) => {
        const filled = star <= rounded;
        return (
          <Star
            key={star}
            aria-hidden="true"
            className={cn(
              sizeClass,
              filled
                ? 'fill-amber-400 text-amber-500 dark:fill-amber-400 dark:text-amber-400'
                : 'fill-transparent text-[var(--border-strong)]'
            )}
          />
        );
      })}
    </span>
  );
}

export function ItemReviewsSection({
  collectionName,
  itemId,
  itemTitle,
  initialSummary,
}: ItemReviewsSectionProps) {
  const { user, isSigningIn, ownedCompositeKeys, signInWithGoogle, getIdToken } =
    useAuth();
  const { showToast } = useToast();

  const [summary, setSummary] = useState<ItemReviewSummaryDTO>(initialSummary);
  const [selectedStarFilter, setSelectedStarFilter] = useState<
    1 | 2 | 3 | 4 | 5 | null
  >(null);

  const [ratingInput, setRatingInput] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [titleInput, setTitleInput] = useState<string>('');
  const [commentInput, setCommentInput] = useState<string>('');
  const [isComposerOpen, setIsComposerOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const compositeKey = makeCompositeKey(collectionName, itemId);
  const isOwnedByCurrentUser = ownedCompositeKeys.has(compositeKey);

  // On Capacitor Native static shell only, refresh live reviews once on mount when online
  useEffect(() => {
    if (!isCapacitorNative()) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    let cancelled = false;
    const refreshNativeReviews = async () => {
      try {
        const res = await fetch(
          `${apiUrl('/api/v1/reviews')}?collection=${encodeURIComponent(
            collectionName
          )}&itemId=${encodeURIComponent(itemId)}`,
          { cache: 'no-store' }
        );
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as { summary?: ItemReviewSummaryDTO };
        if (payload.summary && !cancelled) {
          setSummary(payload.summary);
        }
      } catch {
        // Offline or transient network error — retain initialSummary
      }
    };

    void refreshNativeReviews();
    return () => {
      cancelled = true;
    };
  }, [collectionName, itemId]);

  const myExistingReview = useMemo(() => {
    if (!user) return null;
    return summary.reviews.find((r) => r.userId === user.uid) || null;
  }, [summary.reviews, user]);

  const filteredReviews = useMemo(() => {
    if (!selectedStarFilter) return summary.reviews;
    return summary.reviews.filter((r) => r.rating === selectedStarFilter);
  }, [selectedStarFilter, summary.reviews]);

  const openEditForExisting = () => {
    if (!myExistingReview) return;
    setRatingInput(myExistingReview.rating);
    setTitleInput(myExistingReview.title || '');
    setCommentInput(myExistingReview.comment);
    setFormError(null);
    setConfirmDelete(false);
    setIsComposerOpen(true);
  };

  const openNewComposer = () => {
    if (myExistingReview) {
      openEditForExisting();
      return;
    }
    setFormError(null);
    setIsComposerOpen(true);
  };

  const handleSubmitReview = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);

    const validation = validateReviewSubmission({
      rating: ratingInput,
      title: titleInput,
      comment: commentInput,
    });

    if (!validation.ok) {
      setFormError(validation.error);
      return;
    }

    let activeUser = user;
    if (!activeUser) {
      activeUser = await signInWithGoogle();
      if (!activeUser) {
        setFormError('Sign-in is required to publish your review.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const token = (await activeUser.getIdToken().catch(() => null)) || (await getIdToken());
      if (!token) {
        setFormError('Your session expired. Please sign in again.');
        return;
      }

      const res = await fetch(apiUrl('/api/v1/reviews'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          collectionName,
          itemId,
          rating: validation.rating,
          ...(validation.title ? { title: validation.title } : {}),
          comment: validation.comment,
          authorDisplayName: activeUser.displayName || undefined,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        summary?: ItemReviewSummaryDTO;
        error?: string;
      };

      if (!res.ok || !payload.summary) {
        setFormError(
          payload.error || 'Could not publish your review right now. Please try again.'
        );
        return;
      }

      setSummary(payload.summary);
      setSelectedStarFilter(null);
      setIsComposerOpen(false);
      showToast(
        myExistingReview
          ? 'Your review has been updated.'
          : 'Thank you — your review is now live.',
        'success'
      );
    } catch {
      setFormError('Network connection interrupted while saving your review.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteOwnReview = async () => {
    if (!user) return;
    setIsDeleting(true);
    setFormError(null);

    try {
      const token = await getIdToken();
      if (!token) {
        setFormError('Please sign in again before deleting your review.');
        return;
      }

      const res = await fetch(
        `${apiUrl('/api/v1/reviews')}?collection=${encodeURIComponent(
          collectionName
        )}&itemId=${encodeURIComponent(itemId)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const payload = (await res.json().catch(() => ({}))) as {
        summary?: ItemReviewSummaryDTO;
        error?: string;
      };

      if (!res.ok || !payload.summary) {
        setFormError(payload.error || 'Unable to delete review right now.');
        return;
      }

      setSummary(payload.summary);
      setRatingInput(0);
      setTitleInput('');
      setCommentInput('');
      setConfirmDelete(false);
      setIsComposerOpen(false);
      showToast('Your review was deleted.', 'neutral');
    } catch {
      setFormError('Network connection interrupted while deleting your review.');
    } finally {
      setIsDeleting(false);
    }
  };

  const displayStarCount = hoverRating || ratingInput;
  const trimmedCommentLen = commentInput.trim().length;

  return (
    <section
      id="learner-reviews"
      aria-labelledby="learner-reviews-heading"
      className="mt-10 pt-8 border-t border-[var(--border-subtle)] scroll-mt-24"
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2
            id="learner-reviews-heading"
            className="text-lg font-bold text-[var(--text-main)]"
          >
            Ratings &amp; Learner Reviews
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Authentic reviews from signed-in learners for {itemTitle}.
          </p>
        </div>

        {!isComposerOpen && (
          <button
            type="button"
            onClick={openNewComposer}
            className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            {myExistingReview ? (
              <>
                <Pencil className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Edit Your Review</span>
              </>
            ) : (
              <span>Write a Review</span>
            )}
          </button>
        )}
      </div>

      {/* Aggregate Breakdown + Review List Grid */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-8 items-start">
        {/* Left Column: Rating Summary & Star Distribution */}
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          {summary.reviewCount > 0 ? (
            <>
              <div className="flex items-baseline gap-3 tabular-nums">
                <span className="text-4xl font-extrabold tracking-tight text-[var(--text-main)]">
                  {summary.averageRating.toFixed(1)}
                </span>
                <span className="text-xs text-[var(--text-muted)]">out of 5</span>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <StarRow rating={summary.averageRating} sizeClass="w-4 h-4" />
                <span className="text-xs text-[var(--text-muted)] tabular-nums">
                  {summary.reviewCount}{' '}
                  {summary.reviewCount === 1 ? 'review' : 'reviews'}
                </span>
              </div>

              {/* Interactive 5..1 Star Filter Bars */}
              <div
                className="mt-5 space-y-1.5"
                role="group"
                aria-label="Filter reviews by star rating"
              >
                {DISTRIBUTION_ORDER.map((star) => {
                  const count = summary.distribution[star];
                  const pct =
                    summary.reviewCount > 0
                      ? Math.round((count / summary.reviewCount) * 100)
                      : 0;
                  const isSelected = selectedStarFilter === star;

                  return (
                    <button
                      key={star}
                      type="button"
                      disabled={count === 0 && !isSelected}
                      aria-pressed={isSelected}
                      onClick={() =>
                        setSelectedStarFilter((prev) =>
                          prev === star ? null : star
                        )
                      }
                      className={cn(
                        'w-full flex items-center gap-2.5 min-h-[36px] px-2 rounded-md text-xs transition-colors tabular-nums',
                        isSelected
                          ? 'bg-[var(--bg-elevated)] font-semibold text-[var(--text-main)]'
                          : count > 0
                          ? 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)]/60'
                          : 'text-[var(--text-muted)]/60 cursor-default'
                      )}
                    >
                      <span className="w-8 text-left shrink-0">{star} star</span>
                      <span className="flex-1 h-2 rounded-sm bg-[var(--bg-elevated)] overflow-hidden">
                        <span
                          className="block h-full bg-amber-400 transition-transform duration-150 origin-left"
                          style={{ transform: `scaleX(${pct / 100})` }}
                        />
                      </span>
                      <span className="w-8 text-right shrink-0">{count}</span>
                    </button>
                  );
                })}
              </div>

              {selectedStarFilter !== null && (
                <button
                  type="button"
                  onClick={() => setSelectedStarFilter(null)}
                  className="mt-3 text-xs font-semibold text-[var(--text-main)] underline underline-offset-4 hover:opacity-80"
                >
                  Show all {summary.reviewCount} reviews
                </button>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-bold text-[var(--text-main)]">
                No ratings yet
              </p>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                ExamDash displays only genuine learner submissions. Share your
                experience after reading the sample or studying the full edition.
              </p>
            </div>
          )}

          {/* Signed-in user's own review status controls */}
          {myExistingReview && !isComposerOpen && (
            <div className="mt-5 pt-4 border-t border-[var(--border-subtle)] space-y-2.5">
              <p className="text-xs text-[var(--text-muted)]">
                You rated this resource{' '}
                <strong className="font-semibold text-[var(--text-main)] tabular-nums">
                  {myExistingReview.rating}/5
                </strong>
                .
              </p>
              {!confirmDelete ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={openEditForExisting}
                    className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3 rounded-lg border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3 rounded-lg border border-[var(--border-subtle)] text-xs font-semibold text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)] transition-colors whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Delete</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--text-main)]">
                    Delete your published review permanently?
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => void handleDeleteOwnReview()}
                      className="min-h-[48px] px-3 rounded-lg bg-[var(--status-danger)] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
                    >
                      {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                    </button>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => setConfirmDelete(false)}
                      className="min-h-[48px] px-3 rounded-lg border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Interactive Composer + Published Reviews Feed */}
        <div className="min-w-0 space-y-6">
          {isComposerOpen && (
            <form
              onSubmit={(e) => void handleSubmitReview(e)}
              noValidate
              className="rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 sm:p-6 space-y-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-main)]">
                    {myExistingReview ? 'Edit Your Review' : 'Write a Review'}
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {user
                      ? `Posting publicly as ${
                          user.displayName || user.email?.split('@')[0] || 'ExamDash Learner'
                        }${isOwnedByCurrentUser ? ' · Verified Purchase eligible' : ''}`
                      : 'Select a star rating and write your feedback. You will sign in when publishing.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsComposerOpen(false);
                    setFormError(null);
                  }}
                  className="min-h-[48px] px-3 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
              </div>

              {/* Accessible 48x48px Star Selector */}
              <div>
                <span
                  id="star-selector-label"
                  className="block text-xs font-semibold text-[var(--text-main)]"
                >
                  Overall Rating *
                </span>
                <div
                  role="radiogroup"
                  aria-labelledby="star-selector-label"
                  onMouseLeave={() => setHoverRating(0)}
                  className="mt-1.5 flex flex-wrap items-center gap-1"
                >
                  {STAR_VALUES.map((star) => {
                    const active = star <= displayStarCount;
                    const checked = ratingInput === star;
                    return (
                      <button
                        key={star}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        aria-label={`Rate ${star} out of 5 stars`}
                        onMouseEnter={() => setHoverRating(star)}
                        onClick={() => {
                          setRatingInput(star);
                          setFormError(null);
                        }}
                        className="inline-flex items-center justify-center min-h-[48px] min-w-[48px] rounded-lg border border-transparent hover:bg-[var(--bg-elevated)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] transition-colors"
                      >
                        <Star
                          aria-hidden="true"
                          className={cn(
                            'w-6 h-6 transition-transform',
                            active
                              ? 'fill-amber-400 text-amber-500 dark:fill-amber-400 dark:text-amber-400 scale-105'
                              : 'fill-transparent text-[var(--border-strong)]'
                          )}
                        />
                      </button>
                    );
                  })}

                  {displayStarCount >= 1 && displayStarCount <= 5 && (
                    <span className="ml-2 text-xs font-medium text-[var(--text-muted)]">
                      {RATING_LABELS[displayStarCount as 1 | 2 | 3 | 4 | 5]}
                    </span>
                  )}
                </div>
              </div>

              {/* Optional Headline (>= 16px text-base to prevent mobile WebView auto-zoom) */}
              <div>
                <label
                  htmlFor="review-headline-input"
                  className="block text-xs font-semibold text-[var(--text-main)]"
                >
                  Review Headline{' '}
                  <span className="font-normal text-[var(--text-muted)]">
                    (optional)
                  </span>
                </label>
                <input
                  id="review-headline-input"
                  type="text"
                  maxLength={REVIEW_TITLE_MAX_LENGTH}
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  placeholder="Summarize what stood out about syllabus depth or question quality"
                  className="mt-1.5 w-full min-h-[48px] px-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-base text-[var(--text-main)] placeholder:text-[var(--text-muted)]/70 focus:outline-none focus:border-[var(--brand-primary)]"
                />
              </div>

              {/* Detailed Comment (>= 16px text-base) */}
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <label
                    htmlFor="review-comment-input"
                    className="block text-xs font-semibold text-[var(--text-main)]"
                  >
                    Detailed Review *
                  </label>
                  <span className="text-xs text-[var(--text-muted)] tabular-nums">
                    {trimmedCommentLen} / {REVIEW_COMMENT_MAX_LENGTH}
                  </span>
                </div>
                <textarea
                  id="review-comment-input"
                  rows={4}
                  maxLength={REVIEW_COMMENT_MAX_LENGTH}
                  value={commentInput}
                  onChange={(e) => {
                    setCommentInput(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder={`Share specific observations about chapter clarity, exam relevance, or explanation depth (minimum ${REVIEW_COMMENT_MIN_LENGTH} characters).`}
                  className="mt-1.5 w-full p-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-base text-[var(--text-main)] placeholder:text-[var(--text-muted)]/70 focus:outline-none focus:border-[var(--brand-primary)] leading-relaxed"
                />
              </div>

              {formError && (
                <p
                  role="alert"
                  className="text-xs font-semibold text-[var(--status-danger)]"
                >
                  {formError}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting || isSigningIn}
                  className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
                >
                  {isSubmitting
                    ? 'Saving Review...'
                    : !user
                    ? 'Sign In & Publish Review'
                    : myExistingReview
                    ? 'Update Review'
                    : 'Publish Review'}
                </button>
              </div>
            </form>
          )}

          {/* Published Reviews List (Zero-Pill Clean Editorial List) */}
          {summary.reviewCount === 0 ? (
            !isComposerOpen && (
              <div className="py-6 text-sm text-[var(--text-muted)]">
                <p>
                  There are no learner reviews for{' '}
                  <strong className="font-semibold text-[var(--text-main)]">
                    {itemTitle}
                  </strong>{' '}
                  yet.
                </p>
                <button
                  type="button"
                  onClick={openNewComposer}
                  className="mt-3 inline-flex items-center justify-center min-h-[48px] px-4 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                  Be the First to Review
                </button>
              </div>
            )
          ) : filteredReviews.length === 0 ? (
            <p className="py-4 text-sm text-[var(--text-muted)]">
              No {selectedStarFilter}-star reviews found.
            </p>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {filteredReviews.map((review) => {
                const isEdited =
                  review.updatedAtIso &&
                  review.createdAtIso &&
                  Math.abs(
                    new Date(review.updatedAtIso).getTime() -
                      new Date(review.createdAtIso).getTime()
                  ) > 5000;

                return (
                  <article
                    key={review.reviewId}
                    className="py-5 first:pt-0 last:pb-0 space-y-2"
                  >
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <StarRow rating={review.rating} sizeClass="w-3.5 h-3.5" />
                      {review.title && (
                        <h3 className="text-sm font-bold text-[var(--text-main)]">
                          {review.title}
                        </h3>
                      )}
                    </div>

                    {/* Clean Unboxed Metadata Line (Zero-Pill Discipline) */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-muted)] tabular-nums">
                      <span className="font-semibold text-[var(--text-main)]">
                        {review.authorName}
                      </span>
                      {review.verifiedPurchase && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 font-medium text-[var(--status-success)]">
                            <CheckCircle2
                              className="w-3.5 h-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            <span>Verified Purchase</span>
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <time dateTime={review.createdAtIso}>
                        {formatReviewDate(review.createdAtIso)}
                      </time>
                      {isEdited && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Edited</span>
                        </>
                      )}
                    </div>

                    <p className="text-sm leading-relaxed text-[var(--text-main)] whitespace-pre-line">
                      {review.comment}
                    </p>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
