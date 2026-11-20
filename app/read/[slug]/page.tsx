import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import React from 'react';
import { getBookBySlug } from '../../../server/repositories/catalog-repository';
import { ReaderSlotView } from '../../../features/slots/reader-slot-view';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Book Reader Workspace',
  robots: {
    index: false,
    follow: false,
  },
};

async function fetchSampleMarkdownSafe(url: string): Promise<string> {
  if (!url || !url.startsWith('https://')) return '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 300 },
    });
    if (!res.ok) return '';
    const text = await res.text();
    return text.slice(0, 40000);
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

export default async function ReadBookSlotPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ mode?: string; format?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const lookup = await getBookBySlug(slug);
  if (lookup.status !== 'ok') {
    notFound();
  }

  const book = lookup.data;
  const initialMode = sp.mode === 'sample' ? 'sample' : 'full';
  const initialFormat =
    sp.format === 'pdf'
      ? 'pdf'
      : book.sampleMarkdownUrl || !book.samplePdfUrl
      ? 'markdown'
      : 'pdf';

  const sampleMarkdownPreview = book.sampleMarkdownUrl
    ? await fetchSampleMarkdownSafe(book.sampleMarkdownUrl)
    : '';

  return (
    <ReaderSlotView
      book={book}
      initialMode={initialMode}
      initialFormat={initialFormat}
      sampleMarkdownPreview={sampleMarkdownPreview}
    />
  );
}
