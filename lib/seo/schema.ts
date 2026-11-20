import type { PublicBookDTO, PublicExamDTO } from '../types/catalog';

export function getCanonicalOrigin(): string {
  const envUrl = process.env.APP_URL;
  if (envUrl && envUrl.startsWith('http') && !envUrl.includes('MY_APP_URL')) {
    return envUrl.replace(/\/+$/, '');
  }
  return 'https://examdash.app';
}

/**
 * Escapes `<` as `\u003c` to guarantee safe inline JSON-LD inside `<head>` or `<main>` without premature script closure.
 */
export function serializeSafeJsonLd(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

export function buildSiteGraphJsonLd() {
  const origin = getCanonicalOrigin();
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: 'ExamDash',
        alternateName: 'ExamDash (ed)',
        url: origin,
        logo: `${origin}/pwa-512x512.png`,
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        url: origin,
        name: 'ExamDash',
        description:
          'Curated ebooks, question banks, and full-length mock exam packs with syllabus previews and unified study library access.',
        publisher: { '@id': `${origin}/#organization` },
      },
    ],
  };
}

export function buildBookDetailJsonLd(book: PublicBookDTO) {
  const origin = getCanonicalOrigin();
  const pageUrl = `${origin}/books/${book.urlSlug}`;
  const isFree = book.buyPrice === 0;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: 'ExamDash',
        url: origin,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
          { '@type': 'ListItem', position: 2, name: 'Books', item: `${origin}/books` },
          { '@type': 'ListItem', position: 3, name: book.title, item: pageUrl },
        ],
      },
      {
        '@type': 'Book',
        '@id': `${pageUrl}#book`,
        name: book.title,
        description: book.seoDescription || book.fullDescription.slice(0, 220),
        url: pageUrl,
        inLanguage: book.language || 'en',
        author: {
          '@type': 'Person',
          name: book.authorName || 'ExamDash Editorial',
        },
        publisher: {
          '@type': 'Organization',
          name: book.publisher || 'ExamDash',
        },
        datePublished: book.publishAtIso,
        dateModified: book.updatedAtIso,
        isAccessibleForFree: isFree,
        ...(!isFree
          ? {
              hasPart: {
                '@type': 'WebPageElement',
                isAccessibleForFree: false,
                cssSelector: '.gated-asset-boundary',
              },
            }
          : {}),
        offers: {
          '@type': 'Offer',
          url: pageUrl,
          priceCurrency: book.currency || 'INR',
          price: String(book.buyPrice),
          availability: 'https://schema.org/InStock',
        },
      },
    ],
  };
}

export function buildExamDetailJsonLd(exam: PublicExamDTO) {
  const origin = getCanonicalOrigin();
  const pageUrl = `${origin}/exams/${exam.urlSlug}`;
  const isFree = exam.buyPrice === 0;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: 'ExamDash',
        url: origin,
      },
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
        name: exam.title,
        description: exam.seoDescription || exam.fullDescription.slice(0, 220),
        url: pageUrl,
        brand: {
          '@type': 'Organization',
          name: exam.publisher || 'ExamDash',
        },
        category: exam.type || 'Mock Exam Series',
        isAccessibleForFree: isFree,
        ...(!isFree
          ? {
              hasPart: {
                '@type': 'WebPageElement',
                isAccessibleForFree: false,
                cssSelector: '.gated-asset-boundary',
              },
            }
          : {}),
        offers: {
          '@type': 'Offer',
          url: pageUrl,
          priceCurrency: exam.currency || 'INR',
          price: String(exam.buyPrice),
          availability: 'https://schema.org/InStock',
        },
      },
    ],
  };
}
