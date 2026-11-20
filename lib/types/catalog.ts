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
  status: 'completed';
  createdAtIso: string;
}
