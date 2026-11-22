import type { Metadata } from 'next';
import React from 'react';
import { FullSearchPage } from '../../features/search/full-search-page';
import { toCatalogCardDTO } from '../../lib/types/catalog';
import {
  getLiveBooks,
  getLiveExams,
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
  const [{ q }, books, exams, reviewAggregates] = await Promise.all([
    searchParams,
    getLiveBooks(),
    getLiveExams(),
    getPublishedReviewAggregates(),
  ]);

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
