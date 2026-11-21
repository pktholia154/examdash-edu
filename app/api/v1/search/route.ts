import { NextRequest, NextResponse } from 'next/server';
import { toCatalogCardDTO } from '../../../../lib/types/catalog';
import { searchCatalog } from '../../../../server/repositories/catalog-repository';

/**
 * Decoupled ⌘K Search Endpoint (`GET /api/v1/search?q=...`)
 * Invoked exclusively when the search modal opens — zero client Firestore SDK usage.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').slice(0, 120);

  try {
    const results = await searchCatalog(q);
    return NextResponse.json(
      {
        books: results.books.map(toCatalogCardDTO),
        exams: results.exams.map(toCatalogCardDTO),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to search live catalog',
        books: [],
        exams: [],
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    );
  }
}
