import { NextRequest, NextResponse } from 'next/server';
import {
  getLiveBooksPage,
  getLiveExamsPage,
} from '../../../../../server/repositories/catalog-repository';
import { getPublishedReviewAggregates } from '../../../../../server/repositories/review-repository';
import { buildReviewTargetKey } from '../../../../../lib/reviews/validation';
import {
  toCatalogCardDTO,
  type CollectionName,
} from '../../../../../lib/types/catalog';

const ALLOWED_COLLECTIONS = new Set<CollectionName>([
  'books',
  'ExamPackDocument',
]);

/**
 * Paginated Public Catalog List Endpoint (/api/v1/catalog/items)
 * Strictly validates collection allowlist and bounded limit/offset parameters,
 * querying Firestore with limit+offset and returning whitelisted CatalogCardDTO items.
 */
export async function GET(req: NextRequest) {
  const rawCollection = (req.nextUrl.searchParams.get('collection') || '').trim();
  if (!ALLOWED_COLLECTIONS.has(rawCollection as CollectionName)) {
    return NextResponse.json(
      { error: 'Invalid collection parameter.', items: [], hasMore: false, nextOffset: 0 },
      {
        status: 400,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }

  const collection = rawCollection as CollectionName;
  const rawLimit = req.nextUrl.searchParams.get('limit');
  const rawOffset = req.nextUrl.searchParams.get('offset');

  if (
    (rawLimit !== null && !/^\d+$/.test(rawLimit)) ||
    (rawOffset !== null && !/^\d+$/.test(rawOffset))
  ) {
    return NextResponse.json(
      { error: 'Invalid pagination parameters.', items: [], hasMore: false, nextOffset: 0 },
      {
        status: 400,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }

  const parsedLimit = rawLimit !== null ? Number.parseInt(rawLimit, 10) : 10;
  const parsedOffset = rawOffset !== null ? Number.parseInt(rawOffset, 10) : 0;

  if (
    !Number.isFinite(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > 24 ||
    !Number.isFinite(parsedOffset) ||
    parsedOffset < 0 ||
    parsedOffset > 5000
  ) {
    return NextResponse.json(
      { error: 'Invalid pagination bounds.', items: [], hasMore: false, nextOffset: 0 },
      {
        status: 400,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }

  try {
    const [page, reviewAggregates] = await Promise.all([
      collection === 'books'
        ? getLiveBooksPage({ limit: parsedLimit, offset: parsedOffset })
        : getLiveExamsPage({ limit: parsedLimit, offset: parsedOffset }),
      getPublishedReviewAggregates(),
    ]);

    const items = page.items.map((item) =>
      toCatalogCardDTO(
        item,
        reviewAggregates.get(buildReviewTargetKey(collection, item.id))
      )
    );

    return NextResponse.json(
      {
        items,
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=300',
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        error: 'Unable to load additional catalog items right now.',
        items: [],
        hasMore: false,
        nextOffset: parsedOffset,
      },
      {
        status: 500,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }
}
