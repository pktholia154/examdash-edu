import { BUSINESS_INFO } from '../legal/business-info';
import { getDefaultCatalogPricing } from '../validity/pricing';
import type {
  ImageMetaDTO,
  ItemReviewSummaryDTO,
  PublicBookDTO,
  PublicExamDTO,
} from '../types/catalog';

export const PRODUCTION_CANONICAL_ORIGIN = 'https://exam-dash.com';

export function getCanonicalOrigin(): string {
  return PRODUCTION_CANONICAL_ORIGIN;
}

/**
 * Extracts the primary client-facing hostname from `x-forwarded-host` or `host`,
 * safely taking the first hop in comma-separated proxy headers and stripping `:port` or trailing dots.
 */
export function extractRequestHostname(rawForwardedOrHost: string): string {
  const firstHop = (rawForwardedOrHost || '')
    .toLowerCase()
    .split(',')[0]
    ?.trim() || '';
  return firstHop.replace(/:\d+$/, '').replace(/\.+$/, '');
}

/**
 * Returns true strictly when `host` belongs to default Firebase Hosting or Cloud Run domains
 * (`.web.app`, `.firebaseapp.com`, or `.run.app`), leaving `exam-dash.com` untouched.
 */
export function isDefaultFirebaseOrCloudRunHost(rawHost: string): boolean {
  const host = extractRequestHostname(rawHost);
  if (!host) return false;
  return (
    host.endsWith('.web.app') ||
    host.endsWith('.firebaseapp.com') ||
    host.endsWith('.run.app')
  );
}

export function buildSiteOgUrl(): string {
  return `${getCanonicalOrigin()}/app-icons/icon-512.png?v=ef0c6c39`;
}

export function buildCanonicalAlternates(
  pathWithOptionalQuery: string,
  options?: { includeRssFeed?: boolean }
) {
  const origin = getCanonicalOrigin();
  const cleanRel =
    !pathWithOptionalQuery || pathWithOptionalQuery === '/'
      ? ''
      : pathWithOptionalQuery.startsWith('/')
      ? pathWithOptionalQuery
      : `/${pathWithOptionalQuery}`;
  const fullUrl = `${origin}${cleanRel}`;

  return {
    canonical: fullUrl,
    languages: {
      'en-IN': fullUrl,
      en: fullUrl,
      'x-default': fullUrl,
    },
    ...(options?.includeRssFeed
      ? {
          types: {
            'application/rss+xml': `${origin}/feed.xml`,
          },
        }
      : {}),
  };
}

export const FACET_FILTER_PARAM_NAMES = new Set([
  'sort',
  'filter',
  'q',
  'query',
  'tag',
  'tags',
  'type',
  'category',
  'lang',
  'language',
  'price',
  'level',
]);

/**
 * Detects non-canonical filter, sort, or search query parameters on public pages
 * so both metadata and middleware emit `noindex, follow` while preserving canonical links.
 */
export function hasFacetFilterParams(
  params:
    | URLSearchParams
    | Record<string, string | string[] | undefined>
    | null
    | undefined
): boolean {
  if (!params) return false;
  if (params instanceof URLSearchParams) {
    for (const key of params.keys()) {
      if (FACET_FILTER_PARAM_NAMES.has(key.trim().toLowerCase())) {
        return true;
      }
    }
    return false;
  }
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined) continue;
    if (FACET_FILTER_PARAM_NAMES.has(key.trim().toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Escapes `<` as `\u003c` to guarantee safe inline JSON-LD inside `<head>` or `<main>` without premature script closure.
 */
export function serializeSafeJsonLd(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

/**
 * Builds a Schema.org `ImageObject` enriched with Firestore `imageUrl` and `imageMeta`
 * fields (`title`, `caption`, `alt`, `description`, `keywords`) for rich image SEO.
 * Falls back to the canonical static brand icon when an item has no cover image yet.
 */
export function buildItemCoverSchemaImage(params: {
  pageUrl: string;
  title: string;
  fallbackDescription: string;
  imageUrl?: string;
  imageMeta?: ImageMetaDTO;
}): Record<string, unknown> | string {
  const cleanUrl = (params.imageUrl || '').trim();
  if (!cleanUrl) {
    return buildSiteOgUrl();
  }

  const meta = params.imageMeta;
  const caption = meta?.caption || meta?.alt || params.title;
  const description = meta?.description || params.fallbackDescription;
  const name = meta?.title || params.title;

  return {
    '@type': 'ImageObject',
    '@id': `${params.pageUrl}#cover-image`,
    url: cleanUrl,
    contentUrl: cleanUrl,
    encodingFormat: 'image/png',
    representativeOfPage: true,
    name,
    caption,
    ...(description ? { description } : {}),
    ...(meta?.keywords ? { keywords: meta.keywords } : {}),
  };
}

function formatSchemaPrice(buyPrice: number): string {
  const safe = Number.isFinite(buyPrice) && buyPrice >= 0 ? buyPrice : 0;
  return safe.toFixed(2);
}

export function normalizeSchemaLanguageTag(rawLanguage?: string): string {
  const cleaned = (rawLanguage || '').trim();
  if (!cleaned) return 'en';
  const lower = cleaned.toLowerCase();
  if (lower === 'english' || lower === 'eng') return 'en';
  if (lower === 'hindi' || lower === 'hin') return 'hi';
  if (
    lower === 'bilingual' ||
    lower === 'hinglish' ||
    (lower.includes('english') && lower.includes('hindi'))
  ) {
    return 'en-IN';
  }
  if (/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(cleaned)) {
    return cleaned;
  }
  return 'en';
}

function buildDigitalProductOffer(params: {
  origin: string;
  pageUrl: string;
  buyPrice: number;
  currency: string;
}) {
  const currency = /^[A-Z]{3}$/.test((params.currency || '').toUpperCase())
    ? params.currency.toUpperCase()
    : 'INR';

  return {
    '@type': 'Offer',
    url: params.pageUrl,
    priceCurrency: currency,
    price: formatSchemaPrice(params.buyPrice),
    availability: 'https://schema.org/InStock',
    itemCondition: 'https://schema.org/NewCondition',
    seller: {
      '@id': `${params.origin}/#organization`,
    },
    shippingDetails: {
      '@type': 'OfferShippingDetails',
      shippingRate: {
        '@type': 'MonetaryAmount',
        value: '0.00',
        currency,
      },
      shippingDestination: {
        '@type': 'DefinedRegion',
        addressCountry: 'IN',
      },
      deliveryTime: {
        '@type': 'ShippingDeliveryTime',
        handlingTime: {
          '@type': 'QuantitativeValue',
          minValue: 0,
          maxValue: 0,
          unitCode: 'DAY',
        },
        transitTime: {
          '@type': 'QuantitativeValue',
          minValue: 0,
          maxValue: 0,
          unitCode: 'DAY',
        },
      },
    },
    hasMerchantReturnPolicy: {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'IN',
      returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
      merchantReturnLink: `${params.origin}/refund-cancellation-policy`,
    },
  };
}

export function buildSiteGraphJsonLd() {
  const origin = getCanonicalOrigin();
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: BUSINESS_INFO.brandName,
        legalName: BUSINESS_INFO.legalName,
        alternateName: ['ExamDash', 'ExamDash (ed)', 'Exam Kart'],
        url: origin,
        email: BUSINESS_INFO.supportEmail,
        logo: `${origin}/app-icons/icon-512.png?v=ef0c6c39`,
        address: {
          '@type': 'PostalAddress',
          streetAddress: BUSINESS_INFO.addressParts.streetAddress,
          addressLocality: BUSINESS_INFO.addressParts.addressLocality,
          addressRegion: BUSINESS_INFO.addressParts.addressRegion,
          postalCode: BUSINESS_INFO.addressParts.postalCode,
          addressCountry: BUSINESS_INFO.addressParts.addressCountry,
        },
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          email: BUSINESS_INFO.supportEmail,
          availableLanguage: ['English', 'Hindi'],
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        url: origin,
        name: `${BUSINESS_INFO.brandName} — ExamDash`,
        description:
          'Curated ebooks, question banks, and full-length mock exam packs with syllabus previews and unified study library access.',
        publisher: { '@id': `${origin}/#organization` },
      },
    ],
  };
}

export function buildLegalPageJsonLd(input: {
  title: string;
  description: string;
  path: string;
  pageType?: 'WebPage' | 'ContactPage';
}) {
  const origin = getCanonicalOrigin();
  const normalizedPath = input.path.startsWith('/') ? input.path : `/${input.path}`;
  const pageUrl = `${origin}${normalizedPath}`;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
          { '@type': 'ListItem', position: 2, name: input.title, item: pageUrl },
        ],
      },
      {
        '@type': input.pageType || 'WebPage',
        '@id': `${pageUrl}#webpage`,
        url: pageUrl,
        name: `${input.title} — ${BUSINESS_INFO.brandName}`,
        description: input.description,
        dateModified: BUSINESS_INFO.effectiveDateIso,
        inLanguage: 'en-IN',
        isPartOf: { '@id': `${origin}/#website` },
        publisher: { '@id': `${origin}/#organization` },
      },
    ],
  };
}

function normalizeSchemaReviewDate(iso: string): string | undefined {
  if (!iso || typeof iso !== 'string') return undefined;
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() < 2020) {
    return undefined;
  }
  return parsed.toISOString().slice(0, 10);
}

function buildVerifiedReviewSchemaProps(
  reviewSummary: ItemReviewSummaryDTO | undefined,
  pageUrl: string
) {
  if (
    !reviewSummary ||
    !Number.isInteger(reviewSummary.reviewCount) ||
    reviewSummary.reviewCount <= 0 ||
    !Number.isFinite(reviewSummary.averageRating) ||
    reviewSummary.averageRating < 1 ||
    reviewSummary.averageRating > 5 ||
    !Array.isArray(reviewSummary.reviews) ||
    reviewSummary.reviews.length === 0
  ) {
    return {};
  }

  const validSchemaReviews = reviewSummary.reviews
    .filter(
      (r) =>
        Number.isInteger(r.rating) &&
        r.rating >= 1 &&
        r.rating <= 5 &&
        typeof r.comment === 'string' &&
        r.comment.trim().length > 0 &&
        typeof r.authorName === 'string' &&
        r.authorName.trim().length > 0
    )
    .slice(0, 10)
    .map((r) => {
      const datePublished = normalizeSchemaReviewDate(r.createdAtIso);
      const cleanTitle =
        typeof r.title === 'string' && r.title.trim().length > 0
          ? r.title.trim()
          : undefined;
      return {
        '@type': 'Review',
        '@id': `${pageUrl}#review-${encodeURIComponent(r.reviewId)}`,
        author: {
          '@type': 'Person',
          name: r.authorName.trim(),
        },
        ...(datePublished ? { datePublished } : {}),
        ...(cleanTitle ? { name: cleanTitle } : {}),
        reviewBody: r.comment.trim(),
        reviewRating: {
          '@type': 'Rating',
          ratingValue: r.rating,
          bestRating: 5,
          worstRating: 1,
        },
      };
    });

  if (validSchemaReviews.length === 0) {
    return {};
  }

  const clampedAvg = Math.min(5, Math.max(1, reviewSummary.averageRating));

  return {
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: Number(clampedAvg.toFixed(2)),
      ratingCount: reviewSummary.reviewCount,
      reviewCount: reviewSummary.reviewCount,
      bestRating: 5,
      worstRating: 1,
    },
    review: validSchemaReviews,
  };
}

export function buildBookDetailJsonLd(
  book: PublicBookDTO,
  reviewSummary?: ItemReviewSummaryDTO
) {
  const origin = getCanonicalOrigin();
  const pageUrl = `${origin}/books/${encodeURIComponent(book.urlSlug)}`;
  const description =
    book.seoDescription ||
    book.fullDescription.slice(0, 220) ||
    `${book.title} digital edition by ${book.authorName}.`;
  const coverImage = buildItemCoverSchemaImage({
    pageUrl,
    title: book.title,
    fallbackDescription: description,
    imageUrl: book.imageUrl,
    imageMeta: book.imageMeta,
  });

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
          { '@type': 'ListItem', position: 2, name: 'Books', item: `${origin}/books` },
          { '@type': 'ListItem', position: 3, name: book.title, item: pageUrl },
        ],
      },
      {
        '@type': ['Product', 'Book'],
        '@id': `${pageUrl}#product`,
        sku: book.id,
        name: book.title,
        description,
        url: pageUrl,
        image: coverImage,
        brand: {
          '@type': 'Brand',
          name: 'ExamDash',
        },
        inLanguage: normalizeSchemaLanguageTag(book.language),
        bookFormat: 'https://schema.org/EBook',
        author: {
          '@type': 'Person',
          name: book.authorName || 'ExamDash Editorial',
        },
        publisher: {
          '@type': 'Organization',
          '@id': `${origin}/#organization`,
          name: BUSINESS_INFO.brandName,
        },
        datePublished: book.publishAtIso,
        dateModified: book.updatedAtIso,
        offers: buildDigitalProductOffer({
          origin,
          pageUrl,
          buyPrice: getDefaultCatalogPricing('books', book.buyPrice).discountedPrice,
          currency: book.currency,
        }),
        ...buildVerifiedReviewSchemaProps(reviewSummary, pageUrl),
      },
    ],
  };
}

export function buildExamDetailJsonLd(
  exam: PublicExamDTO,
  reviewSummary?: ItemReviewSummaryDTO
) {
  const origin = getCanonicalOrigin();
  const pageUrl = `${origin}/exams/${encodeURIComponent(exam.urlSlug)}`;
  const description =
    exam.seoDescription ||
    exam.fullDescription.slice(0, 220) ||
    `${exam.title} mock exam pack (${exam.totalMocktest} tests).`;
  const coverImage = buildItemCoverSchemaImage({
    pageUrl,
    title: exam.title,
    fallbackDescription: description,
    imageUrl: exam.imageUrl,
    imageMeta: exam.imageMeta,
  });

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
          { '@type': 'ListItem', position: 2, name: 'Exams', item: `${origin}/exams` },
          { '@type': 'ListItem', position: 3, name: exam.title, item: pageUrl },
        ],
      },
      {
        '@type': 'Product',
        '@id': `${pageUrl}#product`,
        sku: exam.id,
        name: exam.title,
        description,
        url: pageUrl,
        image: coverImage,
        brand: {
          '@type': 'Brand',
          name: 'ExamDash',
        },
        inLanguage: normalizeSchemaLanguageTag(exam.language),
        category: exam.type || 'Mock Exam Series',
        releaseDate: exam.publishAtIso,
        offers: buildDigitalProductOffer({
          origin,
          pageUrl,
          buyPrice: getDefaultCatalogPricing('ExamPackDocument', exam.buyPrice).discountedPrice,
          currency: exam.currency,
        }),
        ...buildVerifiedReviewSchemaProps(reviewSummary, pageUrl),
      },
    ],
  };
}

export function buildCollectionHubJsonLd(params: {
  collection: 'books' | 'exams';
  title: string;
  description: string;
  pageNum: number;
  items: Array<{
    title: string;
    urlSlug: string;
    updatedAtIso?: string;
  }>;
}) {
  const origin = getCanonicalOrigin();
  const basePath = params.collection === 'books' ? '/books' : '/exams';
  const baseLabel = params.collection === 'books' ? 'Books' : 'Exams';
  const pageUrl =
    params.pageNum > 1
      ? `${origin}${basePath}?page=${params.pageNum}`
      : `${origin}${basePath}`;

  const latestItemIso = params.items
    .map((i) => i.updatedAtIso || '')
    .filter(Boolean)
    .sort()
    .pop();

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
          ...(params.pageNum > 1
            ? [
                {
                  '@type': 'ListItem',
                  position: 2,
                  name: baseLabel,
                  item: `${origin}${basePath}`,
                },
                {
                  '@type': 'ListItem',
                  position: 3,
                  name: `Page ${params.pageNum}`,
                  item: pageUrl,
                },
              ]
            : [
                {
                  '@type': 'ListItem',
                  position: 2,
                  name: baseLabel,
                  item: pageUrl,
                },
              ]),
        ],
      },
      {
        '@type': 'CollectionPage',
        '@id': `${pageUrl}#collection`,
        url: pageUrl,
        name: params.title,
        description: params.description,
        inLanguage: 'en-IN',
        isPartOf: { '@id': `${origin}/#website` },
        publisher: { '@id': `${origin}/#organization` },
        ...(latestItemIso ? { dateModified: latestItemIso } : {}),
        ...(params.items.length > 0
          ? {
              mainEntity: {
                '@type': 'ItemList',
                numberOfItems: params.items.length,
                itemListOrder: 'https://schema.org/ItemListOrderDescending',
                itemListElement: params.items.map((item, idx) => ({
                  '@type': 'ListItem',
                  position: (params.pageNum - 1) * 20 + idx + 1,
                  name: item.title,
                  url: `${origin}${basePath}/${encodeURIComponent(item.urlSlug)}`,
                })),
              },
            }
          : {}),
      },
    ],
  };
}
