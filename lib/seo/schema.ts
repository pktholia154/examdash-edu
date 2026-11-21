import { BUSINESS_INFO } from '../legal/business-info';
import type { PublicBookDTO, PublicExamDTO } from '../types/catalog';

export function getCanonicalOrigin(): string {
  const explicitOrigin = process.env.CANONICAL_ORIGIN?.trim();
  if (
    explicitOrigin &&
    explicitOrigin.startsWith('https://') &&
    !explicitOrigin.includes('.run.app') &&
    !explicitOrigin.includes('localhost')
  ) {
    return explicitOrigin.replace(/\/+$/, '');
  }
  return 'https://exam-dash.com';
}

/**
 * Escapes `<` as `\u003c` to guarantee safe inline JSON-LD inside `<head>` or `<main>` without premature script closure.
 */
export function serializeSafeJsonLd(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

/**
 * Builds versioned crawlable 1:1 (`sq` 1200x1200) and 16:9 (`og` 1200x675) PNG URLs
 * for OpenGraph, Twitter Cards, Schema.org Product/Book `image`, and Image Sitemaps.
 */
export function buildThumbUrls(
  collection: 'books' | 'exams',
  urlSlug: string,
  updatedAtIso: string
): { sqPngUrl: string; ogPngUrl: string } {
  const origin = getCanonicalOrigin();
  const parsedMs = new Date(updatedAtIso).getTime();
  const versionMillis = Number.isFinite(parsedMs) && parsedMs > 0 ? parsedMs : 1;
  const encodedSlug = encodeURIComponent(urlSlug);

  return {
    sqPngUrl: `${origin}/thumbs/sq/${collection}/${encodedSlug}.png?v=${versionMillis}`,
    ogPngUrl: `${origin}/thumbs/og/${collection}/${encodedSlug}.png?v=${versionMillis}`,
  };
}

function formatSchemaPrice(buyPrice: number): string {
  const safe = Number.isFinite(buyPrice) && buyPrice >= 0 ? buyPrice : 0;
  return safe.toFixed(2);
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
        logo: `${origin}/pwa-512x512.png`,
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

export function buildBookDetailJsonLd(book: PublicBookDTO) {
  const origin = getCanonicalOrigin();
  const pageUrl = `${origin}/books/${book.urlSlug}`;
  const { sqPngUrl, ogPngUrl } = buildThumbUrls(
    'books',
    book.urlSlug,
    book.updatedAtIso
  );

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
        description:
          book.seoDescription ||
          book.fullDescription.slice(0, 220) ||
          `${book.title} digital edition by ${book.authorName}.`,
        url: pageUrl,
        image: [sqPngUrl, ogPngUrl],
        brand: {
          '@id': `${origin}/#organization`,
        },
        inLanguage: book.language || 'en',
        bookFormat: 'https://schema.org/EBook',
        author: {
          '@type': 'Person',
          name: book.authorName || 'ExamDash Editorial',
        },
        publisher: {
          '@id': `${origin}/#organization`,
        },
        datePublished: book.publishAtIso,
        dateModified: book.updatedAtIso,
        offers: buildDigitalProductOffer({
          origin,
          pageUrl,
          buyPrice: book.buyPrice,
          currency: book.currency,
        }),
      },
    ],
  };
}

export function buildExamDetailJsonLd(exam: PublicExamDTO) {
  const origin = getCanonicalOrigin();
  const pageUrl = `${origin}/exams/${exam.urlSlug}`;
  const { sqPngUrl, ogPngUrl } = buildThumbUrls(
    'exams',
    exam.urlSlug,
    exam.updatedAtIso
  );

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
        description:
          exam.seoDescription ||
          exam.fullDescription.slice(0, 220) ||
          `${exam.title} mock exam pack (${exam.totalMocktest} tests).`,
        url: pageUrl,
        image: [sqPngUrl, ogPngUrl],
        brand: {
          '@id': `${origin}/#organization`,
        },
        category: exam.type || 'Mock Exam Series',
        offers: buildDigitalProductOffer({
          origin,
          pageUrl,
          buyPrice: exam.buyPrice,
          currency: exam.currency,
        }),
      },
    ],
  };
}
