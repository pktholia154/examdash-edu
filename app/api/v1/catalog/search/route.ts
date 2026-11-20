import { NextRequest, NextResponse } from 'next/server';
import { searchCatalog } from '../../../../../server/repositories/catalog-repository';

/**
 * Live Cross-Collection Catalog Search (/api/v1/catalog/search)
 * Queries live Firestore `books` and `ExamPackDocument` and strips all full*StoragePath fields.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').slice(0, 120);

  try {
    const results = await searchCatalog(q);
    return NextResponse.json(results, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
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
