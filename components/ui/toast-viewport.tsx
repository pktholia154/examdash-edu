'use client';

import { CheckCircle2, Info, AlertCircle, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ToastItem {
  id: string;
  message: string;
  tone?: 'neutral' | 'success' | 'danger';
}

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      data-nosnippet=""
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-20 md:bottom-6 left-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] pointer-events-none"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cn(
            'pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-3 shadow-md bg-[var(--bg-surface)] text-[var(--text-main)] border-[var(--border-strong)]'
          )}
        >
          {toast.tone === 'success' && (
            <CheckCircle2
              className="w-4 h-4 text-[var(--status-success)] shrink-0"
              aria-hidden="true"
            />
          )}
          {toast.tone === 'danger' && (
            <AlertCircle
              className="w-4 h-4 text-[var(--status-danger)] shrink-0"
              aria-hidden="true"
            />
          )}
          {(!toast.tone || toast.tone === 'neutral') && (
            <Info
              className="w-4 h-4 text-[var(--text-muted)] shrink-0"
              aria-hidden="true"
            />
          )}
          <span className="text-sm font-medium flex-1">{toast.message}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
