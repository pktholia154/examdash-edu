'use client';

import React from 'react';
import { AlertTriangle, Inbox, RotateCcw } from 'lucide-react';

export interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-12">
      <div className="w-11 h-11 rounded-lg bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-muted)] mb-4">
        <Inbox className="w-5 h-5" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-[var(--text-main)]">{title}</h3>
      <p className="mt-1.5 text-sm text-[var(--text-muted)] max-w-md">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex items-center justify-center min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
        >
          {actionLabel}
        </button>
      )}
      {actionLabel && actionHref && !onAction && (
        <a
          href={actionHref}
          className="mt-5 inline-flex items-center justify-center min-h-[48px] px-5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
        >
          {actionLabel}
        </a>
      )}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Unable to load resources',
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center text-center rounded-[var(--radius-card)] border border-[var(--status-danger)]/30 bg-[var(--status-danger-bg)] px-6 py-10"
    >
      <AlertTriangle
        className="w-6 h-6 text-[var(--status-danger)] mb-3"
        aria-hidden="true"
      />
      <h3 className="text-base font-semibold text-[var(--text-main)]">{title}</h3>
      <p className="mt-1.5 text-sm text-[var(--text-muted)] max-w-lg break-words">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 min-h-[48px] px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ClientErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const raw = error instanceof Error ? error.message : String(error);
    let readable = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: string; operationType?: string; path?: string };
      if (parsed && parsed.error) {
        readable = `${parsed.error}${parsed.path ? ` (${parsed.operationType ?? 'op'} on ${parsed.path})` : ''}`;
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, errorMessage: readable };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="ed-container py-10">
          <ErrorState
            title="Something interrupted this view"
            message={this.state.errorMessage}
            onRetry={() => this.setState({ hasError: false, errorMessage: '' })}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
