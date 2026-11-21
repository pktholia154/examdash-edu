import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import React from 'react';
import { getExamBySlug } from '../../../server/repositories/catalog-repository';
import { AttemptSlotView } from '../../../features/slots/attempt-slot-view';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mock Exam Workspace',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AttemptExamSlotPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    set?: string;
    mode?: string;
    autostart?: string;
    source?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const lookup = await getExamBySlug(slug);
  if (lookup.status !== 'ok') {
    notFound();
  }

  return (
    <AttemptSlotView
      exam={lookup.data}
      initialSetId={sp.set}
      initialMode={sp.mode === 'trial' ? 'trial' : 'full'}
      initialSource={sp.source === 'offline' ? 'offline' : 'online'}
      autostart={sp.autostart === '1'}
    />
  );
}
