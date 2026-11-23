import type { Metadata } from 'next';
import React from 'react';
import { FullSearchPage } from '../../features/search/full-search-page';
import { buildReviewTargetKey } from '../../lib/reviews/validation';
import { toCatalogCardDTO } from '../../lib/types/catalog';
import {
  getLiveBooksPage,
  getLiveExamsPage,
} from '../../server/repositories/catalog-repository';
import { getPublishedReviewAggregates } from '../../server/repositories/review-repository';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search Catalog',
  description:
    'Search ExamDash books, question banks, and full-length mock exam series.',
  robots: {
    index: false,
    follow: true,
  },
};

export default async function SearchRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ q }, booksPage, examsPage] = await Promise.all([
    searchParams,
    getLiveBooksPage({ limit: 48, offset: 0 }).catch(() => ({
      items: [],
      hasMore: false,
      nextOffset: 0,
    })),
    getLiveExamsPage({ limit: 48, offset: 0 }).catch(() => ({
      items: [],
      hasMore: false,
      nextOffset: 0,
    })),
  ]);

  const books = booksPage.items;
  const exams = examsPage.items;

  const targetKeys = [
    ...books.map((b) => buildReviewTargetKey('books', b.id)),
    ...exams.map((e) => buildReviewTargetKey('ExamPackDocument', e.id)),
  ];
  const reviewAggregates = await getPublishedReviewAggregates(targetKeys);

  const allItems = [
    ...books.map((b) =>
      toCatalogCardDTO(b, reviewAggregates.get(`books_${b.id}`))
    ),
    ...exams.map((e) =>
      toCatalogCardDTO(e, reviewAggregates.get(`ExamPackDocument_${e.id}`))
    ),
  ];

  return (
    <FullSearchPage
      initialItems={allItems}
      initialQuery={typeof q === 'string' ? q : ''}
    />
  );
}
