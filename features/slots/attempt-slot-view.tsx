'use client';

import React, { useState } from 'react';
import { ArrowLeft, Clock, HelpCircle, KeyRound, Play, Trophy } from 'lucide-react';
import type { PublicExamDTO } from '../../lib/types/catalog';
import { makeCompositeKey } from '../../lib/registry/content-type-registry';
import { createUuidV7 } from '../../lib/platform/capacitor-bridge';
import { MonogramThumbnail } from '../../components/ui/monogram-thumbnail';
import { useAuth } from '../auth/auth-provider';
import { useToast } from '../toast/toast-context';
import { cn } from '../../lib/utils';

export function AttemptSlotView({
  exam,
  initialSetId,
  initialMode,
}: {
  exam: PublicExamDTO;
  initialSetId?: string;
  initialMode: 'trial' | 'full';
}) {
  const { user, ownedCompositeKeys, getIdToken } = useAuth();
  const { showToast } = useToast();

  const isOwned =
    exam.buyPrice === 0 ||
    ownedCompositeKeys.has(makeCompositeKey('ExamPackDocument', exam.id));

  const [selectedSetId, setSelectedSetId] = useState<string>(
    initialSetId && exam.MocktestTitles.some((m) => m.id === initialSetId)
      ? initialSetId
      : exam.MocktestTitles[0]?.id || ''
  );
  const [signedExpiry, setSignedExpiry] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const selectedSet =
    exam.MocktestTitles.find((m) => m.id === selectedSetId) ||
    exam.MocktestTitles[0];

  const handleVerifySignedJson = async () => {
    if (!user) {
      showToast('Sign in with Google to verify full exam pack token.');
      return;
    }
    setVerifying(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/v1/library/unlock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': createUuidV7(),
        },
        body: JSON.stringify({
          collectionName: 'ExamPackDocument',
          urlSlug: exam.urlSlug,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { expiresAtIso: string };
        setSignedExpiry(data.expiresAtIso);
        showToast('Verified short-lived exam runner JSON grant.', 'success');
      } else {
        showToast('Purchase this exam pack to unlock full mock test JSON.', 'danger');
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="ed-container py-8 space-y-6">
      {/* Runner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3.5 min-w-0">
          <a
            href={`/exams/${exam.urlSlug}`}
            aria-label="Back to exam pack details"
            className="inline-flex items-center justify-center w-11 h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </a>
          <MonogramThumbnail
            title={exam.title}
            type={exam.type}
            collectionName="ExamPackDocument"
            size="sm"
            showBadge={false}
            className="w-12 h-12 hidden sm:flex"
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--text-muted)]">
              {initialMode === 'trial' || !isOwned
                ? 'Sample Trial Runner Slot'
                : 'Full Mock Exam Runner Slot'}{' '}
              · {exam.language}
            </p>
            <h1 className="text-lg sm:text-xl font-extrabold text-[var(--text-main)] truncate">
              {exam.title}
            </h1>
          </div>
        </div>

        {isOwned && user && (
          <button
            type="button"
            disabled={verifying}
            onClick={() => void handleVerifySignedJson()}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0"
          >
            <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {signedExpiry
                ? `Signed until ${new Date(signedExpiry).toLocaleTimeString()}`
                : verifying
                ? 'Verifying...'
                : 'Verify Signed JSON'}
            </span>
          </button>
        )}
      </div>

      {/* 2-Column Exam Runner Shell */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-start">
        {/* Left Set Selector */}
        <aside className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-2">
          <p className="px-2 py-1 text-xs font-semibold text-[var(--text-muted)]">
            Select Mock Set ({exam.MocktestTitles.length})
          </p>
          {exam.MocktestTitles.map((m) => {
            const active = m.id === selectedSet?.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedSetId(m.id)}
                className={cn(
                  'w-full text-left p-3 rounded-lg transition-colors',
                  active
                    ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-ink)]'
                    : 'hover:bg-[var(--bg-elevated)] text-[var(--text-main)]'
                )}
              >
                <p className="text-sm font-semibold line-clamp-2">{m.title}</p>
                <p
                  className={cn(
                    'mt-1 text-xs tabular-nums',
                    active ? 'opacity-80' : 'text-[var(--text-muted)]'
                  )}
                >
                  {m.duration} min · {m.totalQuestions} Qs · {m.totalMarks} Marks
                </p>
              </button>
            );
          })}
        </aside>

        {/* Right Phase-2 Exam Engine Slot */}
        <section className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 sm:p-8 space-y-6">
          {selectedSet ? (
            <>
              <div>
                <p className="text-xs font-mono text-[var(--text-muted)]">
                  Paper ID: {selectedSet.id}
                </p>
                <h2 className="mt-1 text-xl font-extrabold text-[var(--text-main)]">
                  {selectedSet.title}
                </h2>
              </div>

              <div className="grid grid-cols-3 gap-3 tabular-nums">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Duration</span>
                  </div>
                  <p className="mt-1 text-lg font-extrabold text-[var(--text-main)]">
                    {selectedSet.duration} min
                  </p>
                </div>

                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Questions</span>
                  </div>
                  <p className="mt-1 text-lg font-extrabold text-[var(--text-main)]">
                    {selectedSet.totalQuestions}
                  </p>
                </div>

                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Total Marks</span>
                  </div>
                  <p className="mt-1 text-lg font-extrabold text-[var(--text-main)]">
                    {selectedSet.totalMarks}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-6 space-y-3">
                <h3 className="text-sm font-bold text-[var(--text-main)]">
                  Phase-2 Mock-Test Engine Slot Ready
                </h3>
                <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                  This route container is wired to live Firestore syllabus metadata (`MocktestTitles`),{' '}
                  {exam.sampleJsonStoragePath
                    ? 'sample practice JSON availability,'
                    : 'exam pack parameters,'}{' '}
                  and short-lived signed delivery endpoints. Drop in the timed question palette, negative-marking calculator, and response sheet engine in Phase 2 without changing route contracts.
                </p>

                <div className="pt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      showToast(
                        `Ready to initialize "${selectedSet.title}" (${selectedSet.duration}m timer).`,
                        'success'
                      )
                    }
                    className="inline-flex items-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    <Play className="w-4 h-4" aria-hidden="true" />
                    <span>Initialize Test Workspace</span>
                  </button>

                  {!isOwned && (
                    <a
                      href={`/exams/${exam.urlSlug}`}
                      className="inline-flex items-center justify-center min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
                    >
                      Unlock Full Pack
                    </a>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              No mock sets configured in this exam pack yet.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
