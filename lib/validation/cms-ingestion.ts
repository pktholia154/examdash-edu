import { z } from 'zod';
import {
  parseImageMeta,
  sanitizePaidDescription,
  sanitizePaidTags,
  sanitizePaidTitle,
} from '../../server/dto/mapper';
import type { ImageMetaDTO, MocktestTitleItem } from '../types/catalog';

/**
 * Strict URL-safe lowercase slug pattern for GSC-compliant canonical paths (`/books/<slug>`, `/exams/<slug>`).
 */
export const CANONICAL_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const CanonicalSlugSchema = z
  .string()
  .trim()
  .min(2, 'Slug must be at least 2 characters.')
  .max(160, 'Slug must not exceed 160 characters.')
  .regex(
    CANONICAL_SLUG_REGEX,
    'Slug must contain only lowercase alphanumeric characters and single hyphens.'
  );

/**
 * Crash-proof slug normalizer for CMS / offline-AI ingestion or legacy Firestore records.
 */
export function normalizeSafeCatalogSlug(raw: unknown, fallbackId: string): string {
  const candidate = typeof raw === 'string' ? raw.trim() : '';
  if (candidate && CANONICAL_SLUG_REGEX.test(candidate) && candidate.length <= 160) {
    return candidate;
  }

  const cleaned = (candidate || fallbackId || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160)
    .replace(/-+$/g, '');

  return cleaned.length >= 2 ? cleaned : `item-${cleaned || 'catalog'}`;
}

const NonNegativeFiniteNumber = z
  .union([z.number(), z.string()])
  .transform((val, ctx) => {
    const num = typeof val === 'number' ? val : Number(String(val).trim());
    if (!Number.isFinite(num) || num < 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Expected a non-negative finite number.',
      });
      return z.NEVER;
    }
    return num;
  });

const SafeHttpsOrStoragePathSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (val) => {
      if (!val) return true;
      if (val.startsWith('gs://') || (val.startsWith('/') && !val.startsWith('//'))) {
        return true;
      }
      if (/^https:\/\//i.test(val)) {
        try {
          const parsed = new URL(val);
          return parsed.protocol === 'https:';
        } catch {
          return false;
        }
      }
      return !/^[a-z][a-z0-9+.-]*:/i.test(val);
    },
    { message: 'Asset URL/path must use https://, gs://, or a clean storage object path.' }
  );

export const CmsMocktestTitleSchema = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(240),
  duration: NonNegativeFiniteNumber,
  totalQuestions: NonNegativeFiniteNumber,
  totalMarks: NonNegativeFiniteNumber,
});

const CmsImageMetaInputSchema = z
  .union([
    z.array(z.string().max(500)).max(20),
    z.object({
      alt: z.string().trim().max(300).optional(),
      slug: z.string().trim().max(200).optional(),
      title: z.string().trim().max(300).optional(),
      caption: z.string().trim().max(500).optional(),
      description: z.string().trim().max(500).optional(),
      filename: z.string().trim().max(240).optional(),
      keywords: z.union([z.string().max(500), z.array(z.string().max(80)).max(30)]).optional(),
    }),
  ])
  .optional();

export const CmsBookIngestionSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    title: z.string().trim().min(3).max(240),
    urlSlug: CanonicalSlugSchema,
    seoDescription: z.string().trim().max(320).default(''),
    fullDescription: z.string().trim().max(120_000).default(''),
    type: z.string().trim().min(1).max(80).default('Ebook'),
    language: z.string().trim().min(1).max(60).default('English'),
    publisher: z.string().trim().min(1).max(120).default('ExamDash'),
    authorName: z.string().trim().min(1).max(120).default('ExamDash Editorial'),
    tags: z.array(z.string().trim().min(1).max(60)).max(25).default([]),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code.')
      .default('INR'),
    buyPrice: NonNegativeFiniteNumber,
    listPrice: NonNegativeFiniteNumber.optional(),
    isPublished: z.boolean().default(false),
    isDeleted: z.boolean().default(false),
    imageUrl: SafeHttpsOrStoragePathSchema.optional(),
    bookCover: SafeHttpsOrStoragePathSchema.optional(),
    imageMeta: CmsImageMetaInputSchema,
    bookChapters: z
      .array(
        z.union([
          z.string().trim().min(1).max(280),
          z.object({ title: z.string().trim().min(1).max(280) }),
        ])
      )
      .max(250)
      .default([]),
    samplePdfUrl: SafeHttpsOrStoragePathSchema.optional(),
    sampleMarkdownUrl: SafeHttpsOrStoragePathSchema.optional(),
    fullPdfStoragePath: SafeHttpsOrStoragePathSchema.optional(),
    fullMarkdownStoragePath: SafeHttpsOrStoragePathSchema.optional(),
  })
  .transform((doc) => {
    const effectiveListPrice = Math.max(doc.buyPrice, doc.listPrice ?? doc.buyPrice);
    const hasSample = Boolean(doc.samplePdfUrl || doc.sampleMarkdownUrl);
    const normalizedChapters = doc.bookChapters.map((ch) =>
      typeof ch === 'string' ? ch.trim() : ch.title.trim()
    );
    const parsedMeta: ImageMetaDTO | undefined = parseImageMeta(doc.imageMeta);

    return {
      ...doc,
      title: sanitizePaidTitle(doc.title, doc.buyPrice, 'Untitled Book'),
      tags: sanitizePaidTags(doc.tags, doc.buyPrice),
      seoDescription: sanitizePaidDescription(doc.seoDescription, doc.buyPrice, hasSample),
      listPrice: effectiveListPrice,
      bookChapters: normalizedChapters,
      imageMeta: parsedMeta,
    };
  });

export const CmsExamPackIngestionSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    title: z.string().trim().min(3).max(240),
    urlSlug: CanonicalSlugSchema,
    seoDescription: z.string().trim().max(320).default(''),
    fullDescription: z.string().trim().max(120_000).default(''),
    type: z.string().trim().min(1).max(80).default('Exam'),
    language: z.string().trim().min(1).max(60).default('English'),
    publisher: z.string().trim().min(1).max(120).default('ExamDash'),
    authorName: z.string().trim().min(1).max(120).default('ExamDash Faculty'),
    tags: z.array(z.string().trim().min(1).max(60)).max(25).default([]),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code.')
      .default('INR'),
    buyPrice: NonNegativeFiniteNumber,
    listPrice: NonNegativeFiniteNumber.optional(),
    isPublished: z.boolean().default(false),
    isDeleted: z.boolean().default(false),
    imageUrl: SafeHttpsOrStoragePathSchema.optional(),
    imageMeta: CmsImageMetaInputSchema,
    totalMocktest: NonNegativeFiniteNumber.default(0),
    MocktestTitles: z.array(CmsMocktestTitleSchema).max(500).default([]),
    sampleJsonStoragePath: SafeHttpsOrStoragePathSchema.optional(),
    fullJsonStoragePath: SafeHttpsOrStoragePathSchema.optional(),
  })
  .transform((doc) => {
    const effectiveListPrice = Math.max(doc.buyPrice, doc.listPrice ?? doc.buyPrice);
    const hasSample = Boolean(doc.sampleJsonStoragePath);
    const parsedMeta: ImageMetaDTO | undefined = parseImageMeta(doc.imageMeta);
    const syllabus: MocktestTitleItem[] = doc.MocktestTitles;

    return {
      ...doc,
      title: sanitizePaidTitle(doc.title, doc.buyPrice, 'Untitled Exam Pack'),
      tags: sanitizePaidTags(doc.tags, doc.buyPrice),
      seoDescription: sanitizePaidDescription(doc.seoDescription, doc.buyPrice, hasSample),
      listPrice: effectiveListPrice,
      totalMocktest: Math.max(doc.totalMocktest, syllabus.length),
      MocktestTitles: syllabus,
      imageMeta: parsedMeta,
    };
  });

/**
 * Structural Zod schema for ExamSet[] JSON packs ingested from offline authoring / CMS pipelines.
 */
export const CmsExamQuestionSchema = z.object({
  id: z.string().trim().min(1),
  type: z.string().trim().min(1).optional(),
  prompt: z.string().optional(),
  explanation: z.string().nullable().optional(),
  contextIds: z.array(z.string()).optional(),
  marks: z
    .object({
      correct: z.number(),
      incorrect: z.number().optional(),
      unattempted: z.number().optional(),
    })
    .optional(),
  options: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        text: z.string().optional(),
        visuals: z.array(z.record(z.string(), z.unknown())).optional(),
      })
    )
    .optional(),
  visuals: z.array(z.record(z.string(), z.unknown())).optional(),
  explanationVisuals: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const CmsExamSectionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  totalQuestions: z.number().int().nonnegative(),
  duration: z.number().positive().optional(),
  maxAttempts: z.number().int().positive().nullable().optional(),
  contexts: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        title: z.string().nullable().optional(),
        text: z.string().nullable().optional(),
        visuals: z.array(z.record(z.string(), z.unknown())).optional(),
      })
    )
    .optional(),
  questions: z.array(CmsExamQuestionSchema),
});

export const CmsExamSetSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  duration: z.number().positive(),
  totalQuestions: z.number().int().nonnegative(),
  totalMarks: z.number().nonnegative(),
  sectionalTiming: z.boolean().optional(),
  sections: z.array(CmsExamSectionSchema).min(1),
});

export const CmsExamSetArraySchema = z.array(CmsExamSetSchema).min(1);

/**
 * Zod schema for authenticated CMS / publishing webhooks (`/api/v1/seo/publish` & `/api/v1/seo/indexnow`).
 */
export const PublishWebhookItemSchema = z.object({
  collectionName: z.enum(['books', 'ExamPackDocument', 'exams']),
  urlSlug: z.string().trim().min(1).max(160),
  itemId: z.string().trim().max(120).optional(),
  action: z.enum(['publish', 'update', 'delete']).default('publish'),
});

export const PublishWebhookPayloadSchema = z.object({
  urls: z.array(z.unknown()).max(10_000).optional(),
  items: z.array(PublishWebhookItemSchema).max(1_000).optional(),
  invalidateOnly: z.boolean().default(false),
  prewarm: z.boolean().default(true),
});

export type ValidatedPublishWebhookPayload = z.infer<typeof PublishWebhookPayloadSchema>;

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

export function validateCmsBookIngestion(raw: unknown) {
  const parsed = CmsBookIngestionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: formatZodIssues(parsed.error),
    };
  }
  return {
    ok: true as const,
    data: parsed.data,
  };
}

export function validateCmsExamPackIngestion(raw: unknown) {
  const parsed = CmsExamPackIngestionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: formatZodIssues(parsed.error),
    };
  }
  return {
    ok: true as const,
    data: parsed.data,
  };
}
