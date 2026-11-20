import type { Metadata } from 'next';
import Link from 'next/link';
import React from 'react';

export const metadata: Metadata = {
  title: '404 — Resource Not Found',
  robots: {
    index: false,
    follow: true,
  },
};

export default function NotFound() {
  return (
    <div className="ed-container py-20">
      <div className="max-w-lg mx-auto text-center rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8">
        <p className="font-mono text-xs font-semibold text-[var(--text-muted)]">
          HTTP 404
        </p>
        <h1 className="mt-2 text-2xl font-extrabold text-[var(--text-main)]">
          Requested resource was not found
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          The book or exam pack slug may have changed, been unpublished, or does not exist in the live catalog.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Explore Home
          </Link>
          <Link
            href="/books"
            className="inline-flex items-center justify-center min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            Browse Books
          </Link>
          <Link
            href="/exams"
            className="inline-flex items-center justify-center min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            Browse Exams
          </Link>
        </div>
      </div>
    </div>
  );
}
