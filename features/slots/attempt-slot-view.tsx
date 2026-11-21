'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import type { PublicExamDTO } from '../../lib/types/catalog';

const LazyExamRunnerShell = dynamic(
  () =>
    import('../exam/exam-runner-shell').then((m) => m.ExamRunnerShell),
  {
    ssr: false,
    loading: () => (
      <div className="ed-container py-10 space-y-5">
        <div className="h-14 w-80 rounded-lg ed-skeleton" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 h-96 rounded-[var(--radius-card)] ed-skeleton" />
          <div className="lg:col-span-4 h-96 rounded-[var(--radius-card)] ed-skeleton" />
        </div>
      </div>
    ),
  }
);

export function AttemptSlotView({
  exam,
  initialSetId,
  initialMode,
  initialSource = 'online',
  autostart = false,
}: {
  exam: PublicExamDTO;
  initialSetId?: string;
  initialMode: 'trial' | 'full';
  initialSource?: 'online' | 'offline';
  autostart?: boolean;
}) {
  return (
    <LazyExamRunnerShell
      exam={exam}
      initialSetId={initialSetId}
      initialMode={initialMode}
      initialSource={initialSource}
      autostart={autostart}
    />
  );
}
