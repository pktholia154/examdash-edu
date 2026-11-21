export type CollectionName = 'books' | 'ExamPackDocument';

export type ViewMode = 'grid' | 'list';

export type SortOption =
  | 'publishAt_desc'
  | 'publishAt_asc'
  | 'price_asc'
  | 'price_desc';

export interface MocktestTitleItem {
  id: string;
  title: string;
  duration: number;
  totalQuestions: number;
  totalMarks: number;
}

/**
 * Public Book DTO — Strictly whitelisted server projection.
 * NEVER includes fullPdfStoragePath or fullMarkdownStoragePath.
 */
export interface PublicBookDTO {
  id: string;
  collectionName: 'books';
  title: string;
  urlSlug: string;
  seoDescription: string;
  fullDescription: string;
  type: string;
  language: string;
  publisher: string;
  authorName: string;
  tags: string[];
  currency: string;
  listPrice: number;
  buyPrice: number;
  publishAtIso: string;
  updatedAtIso: string;
  createdAtIso: string;
  samplePdfUrl: string;
  sampleMarkdownUrl: string;
  hasFullPdf: boolean;
  hasFullMarkdown: boolean;
}

/**
 * Public ExamPack DTO — Strictly whitelisted server projection.
 * NEVER includes fullJsonStoragePath.
 */
export interface PublicExamDTO {
  id: string;
  collectionName: 'ExamPackDocument';
  title: string;
  urlSlug: string;
  seoDescription: string;
  fullDescription: string;
  type: string;
  language: string;
  publisher: string;
  authorName: string;
  tags: string[];
  currency: string;
  listPrice: number;
  buyPrice: number;
  publishAtIso: string;
  updatedAtIso: string;
  createdAtIso: string;
  totalMocktest: number;
  MocktestTitles: MocktestTitleItem[];
  sampleJsonStoragePath: string;
  hasFullJson: boolean;
}

export type CatalogItemDTO = PublicBookDTO | PublicExamDTO;

export interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

export interface ItemReviewDTO {
  reviewId: string;
  targetKey: string;
  collectionName: CollectionName;
  itemId: string;
  urlSlug: string;
  userId: string;
  authorName: string;
  rating: 1 | 2 | 3 | 4 | 5;
  title?: string;
  comment: string;
  verifiedPurchase: boolean;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface ItemReviewSummaryDTO {
  targetKey: string;
  collectionName: CollectionName;
  itemId: string;
  reviewCount: number;
  averageRating: number;
  distribution: RatingDistribution;
  reviews: ItemReviewDTO[];
}

export interface ReviewAggregateBadge {
  averageRating: number;
  reviewCount: number;
}

/**
 * Slim card projection for catalog grids/lists so client islands never serialize
 * `fullDescription`, `seoDescription`, or `MocktestTitles` into `self.__next_f`.
 */
export interface CatalogCardDTO {
  id: string;
  collectionName: CollectionName;
  title: string;
  urlSlug: string;
  type: string;
  language: string;
  authorName: string;
  tags: string[];
  currency: string;
  listPrice: number;
  buyPrice: number;
  publishAtIso: string;
  totalMocktest?: number;
  averageRating?: number;
  reviewCount?: number;
}

export function toCatalogCardDTO(
  item: CatalogItemDTO,
  reviewBadge?: ReviewAggregateBadge
): CatalogCardDTO {
  const hasRealReviews =
    Boolean(reviewBadge) &&
    typeof reviewBadge?.reviewCount === 'number' &&
    reviewBadge.reviewCount > 0 &&
    typeof reviewBadge?.averageRating === 'number' &&
    reviewBadge.averageRating >= 1;

  return {
    id: item.id,
    collectionName: item.collectionName,
    title: item.title,
    urlSlug: item.urlSlug,
    type: item.type,
    language: item.language,
    authorName: item.authorName,
    tags: item.tags,
    currency: item.currency,
    listPrice: item.listPrice,
    buyPrice: item.buyPrice,
    publishAtIso: item.publishAtIso,
    ...(item.collectionName === 'ExamPackDocument'
      ? { totalMocktest: item.totalMocktest }
      : {}),
    ...(hasRealReviews && reviewBadge
      ? {
          averageRating: Number(reviewBadge.averageRating.toFixed(2)),
          reviewCount: reviewBadge.reviewCount,
        }
      : {}),
  };
}

export interface CartItem {
  compositeKey: string; // `${collectionName}:${id}`
  firestoreKey: string; // `${collectionName}__${id}`
  id: string;
  collectionName: CollectionName;
  urlSlug: string;
  title: string;
  authorName: string;
  language: string;
  type: string;
  currency: string;
  listPrice: number;
  buyPrice: number;
}

export interface UserPurchaseRecord {
  purchaseId: string;
  userId: string;
  itemId: string;
  collectionName: CollectionName;
  urlSlug: string;
  title: string;
  type: string;
  authorName: string;
  language: string;
  currency: string;
  listPrice: number;
  paidPrice: number;
  totalMocktest?: number;
  paymentProvider?: 'razorpay' | 'free' | 'apple_iap' | 'google_play';
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  status: 'completed';
  createdAtIso: string;
}
