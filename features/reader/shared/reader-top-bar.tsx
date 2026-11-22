'use client';

import React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface ReaderTopBarProps {
  title: string;
  activeFormat: 'pdf' | 'markdown';
  canSwitchFormat: boolean;
  onFormatChange?: (next: 'pdf' | 'markdown') => void;
  onClose?: () => void;
  closeHref?: string;
}

/**
 * Minimal Top Bar (Bar 1) shared by both full-screen PDF and Markdown viewers.
 * Strictly contains: Title, PDF/Markdown toggle (when both formats exist), and Close (X) button.
 */
export function ReaderTopBar({
  title,
  activeFormat,
  canSwitchFormat,
  onFormatChange,
  onClose,
  closeHref,
}: ReaderTopBarProps) {
  return (
    <div
      data-nosnippet=""
      className="flex items-center justify-between gap-2 w-full px-2.5 sm:px-4 py-1.5 border-b border-[var(--reader-border,var(--border-subtle))] bg-[var(--reader-bg,var(--bg-surface))] text-[var(--reader-ink,var(--text-main))] shrink-0"
      style={{
        paddingTop: 'calc(0.375rem + var(--safe-area-inset-top))',
      }}
    >
      <h2 className="text-xs sm:text-sm font-bold truncate flex-1 min-w-0 leading-tight">
        {title}
      </h2>

      <div className="flex items-center gap-1.5 shrink-0">
        {canSwitchFormat && onFormatChange && (
          <div
            role="group"
            aria-label="Reading format"
            className="inline-flex items-center rounded-md border border-[var(--reader-border,var(--border-subtle))] bg-[var(--reader-surface,var(--bg-elevated))] p-0.5"
          >
            <button
              type="button"
              aria-pressed={activeFormat === 'pdf'}
              onClick={() => onFormatChange('pdf')}
              className={cn(
                'inline-flex items-center justify-center h-8 sm:h-9 px-2.5 sm:px-3 rounded text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap',
                activeFormat === 'pdf'
                  ? 'bg-[var(--reader-accent,var(--brand-primary))] text-[var(--reader-accent-ink,var(--brand-primary-ink))]'
                  : 'text-[var(--reader-muted,var(--text-muted))] hover:text-[var(--reader-ink,var(--text-main))]'
              )}
            >
              PDF
            </button>
            <button
              type="button"
              aria-pressed={activeFormat === 'markdown'}
              onClick={() => onFormatChange('markdown')}
              className={cn(
                'inline-flex items-center justify-center h-8 sm:h-9 px-2 sm:px-3 rounded text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap',
                activeFormat === 'markdown'
                  ? 'bg-[var(--reader-accent,var(--brand-primary))] text-[var(--reader-accent-ink,var(--brand-primary-ink))]'
                  : 'text-[var(--reader-muted,var(--text-muted))] hover:text-[var(--reader-ink,var(--text-main))]'
              )}
            >
              Markdown
            </button>
          </div>
        )}

        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reader"
            className="inline-flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-md border border-[var(--reader-border,var(--border-subtle))] bg-[var(--reader-surface,var(--bg-elevated))] text-[var(--reader-ink,var(--text-main))] hover:bg-[var(--reader-elevated,var(--bg-elevated))] transition-colors shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        ) : closeHref ? (
          <a
            href={closeHref}
            aria-label="Close reader"
            className="inline-flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-md border border-[var(--reader-border,var(--border-subtle))] bg-[var(--reader-surface,var(--bg-elevated))] text-[var(--reader-ink,var(--text-main))] hover:bg-[var(--reader-elevated,var(--bg-elevated))] transition-colors shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </div>
  );
}
