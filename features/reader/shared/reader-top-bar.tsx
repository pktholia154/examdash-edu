'use client';

import React from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface ReaderTopBarProps {
  title: string;
  activeFormat: 'pdf' | 'markdown';
  canSwitchFormat: boolean;
  onFormatChange?: (next: 'pdf' | 'markdown') => void;
  onClose?: () => void;
  closeHref?: string;
  isModalOverlay?: boolean;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

/**
 * Minimal Top Bar (Bar 1) shared by both full-screen and same-DOM overlay PDF/Markdown viewers.
 * Strictly contains: Title, PDF/eMobi toggle (when both formats exist), optional Desktop Maximize, and Close (X) button.
 */
export function ReaderTopBar({
  title,
  activeFormat,
  canSwitchFormat,
  onFormatChange,
  onClose,
  closeHref,
  isModalOverlay = false,
  isMaximized = false,
  onToggleMaximize,
}: ReaderTopBarProps) {
  return (
    <div
      data-nosnippet=""
      className="flex items-center justify-between gap-2 w-full px-3 sm:px-4 py-1.5 border-b border-[var(--reader-border,var(--border-subtle))] bg-[var(--reader-bg,var(--bg-surface))] text-[var(--reader-ink,var(--text-main))] shrink-0"
      style={
        isModalOverlay
          ? undefined
          : {
              paddingTop: 'calc(0.375rem + var(--safe-area-inset-top))',
            }
      }
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
                'inline-flex items-center justify-center h-8 sm:h-9 px-2.5 sm:px-3 rounded text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap shrink-0',
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
                'inline-flex items-center justify-center h-8 sm:h-9 px-2.5 sm:px-3 rounded text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap shrink-0',
                activeFormat === 'markdown'
                  ? 'bg-[var(--reader-accent,var(--brand-primary))] text-[var(--reader-accent-ink,var(--brand-primary-ink))]'
                  : 'text-[var(--reader-muted,var(--text-muted))] hover:text-[var(--reader-ink,var(--text-main))]'
              )}
            >
              eMobi
            </button>
          </div>
        )}

        {onToggleMaximize && (
          <button
            type="button"
            onClick={onToggleMaximize}
            aria-label={
              isMaximized ? 'Restore modal size' : 'Expand viewer to full width'
            }
            title={isMaximized ? 'Restore size' : 'Expand'}
            className="hidden md:inline-flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-md border border-[var(--reader-border,var(--border-subtle))] bg-[var(--reader-surface,var(--bg-elevated))] text-[var(--reader-ink,var(--text-main))] hover:bg-[var(--reader-elevated,var(--bg-elevated))] transition-colors shrink-0"
          >
            {isMaximized ? (
              <Minimize2 className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
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
