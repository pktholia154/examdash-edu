import type { Metadata } from 'next';
import React from 'react';
import {
  PurchasedLibraryView,
  type PurchasedBookCatalogMeta,
  type PurchasedExamCatalogMeta,
} from '../../features/library/purchased-library-view';
import {
  getLiveBooks,
  getLiveExams,
} from '../../server/repositories/catalog-repository';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Purchased Library',
  description:
    'Access your purchased ExamDash ebooks, question banks, and mock exam packs online or from your offline study vault.',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function PurchasedPage() {
  const [books, exams] = await Promise.all([
    getLiveBooks().catch(() => []),
    getLiveExams().catch(() => []),
  ]);

  const booksMeta: PurchasedBookCatalogMeta[] = books.map((b) => ({
    id: b.id,
    urlSlug: b.urlSlug,
    hasFullPdf: b.hasFullPdf,
    hasFullMarkdown: b.hasFullMarkdown,
    updatedAtMs: new Date(b.updatedAtIso).getTime() || 0,
  }));

  const examsMeta: PurchasedExamCatalogMeta[] = exams.map((e) => ({
    id: e.id,
    urlSlug: e.urlSlug,
    totalMocktest: e.totalMocktest,
    hasFullJson: e.hasFullJson,
    updatedAtMs: new Date(e.updatedAtIso).getTime() || 0,
    mocktestTitles: e.MocktestTitles,
  }));

  return (
    <PurchasedLibraryView booksMeta={booksMeta} examsMeta={examsMeta} />
  );
}
