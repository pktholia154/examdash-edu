'use client';

import { LayoutGrid, List } from 'lucide-react';
import type { ViewMode } from '../../lib/types/catalog';
import { cn } from '../../lib/utils';

export interface ViewToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  labelPrefix?: string;
}

export function ViewToggle({
  value,
  onChange,
  labelPrefix = 'Catalog',
}: ViewToggleProps) {
  return (
    <div
      role="group"
      aria-label={`${labelPrefix} view mode`}
      className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shrink-0"
    >
      <button
        type="button"
        aria-label={`${labelPrefix} Grid view`}
        aria-pressed={value === 'grid'}
        onClick={() => onChange('grid')}
        className={cn(
          'inline-flex items-center gap-1.5 min-h-[40px] min-w-[44px] px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0',
          value === 'grid'
            ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
            : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
        )}
      >
        <LayoutGrid className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Grid</span>
      </button>

      <button
        type="button"
        aria-label={`${labelPrefix} List view`}
        aria-pressed={value === 'list'}
        onClick={() => onChange('list')}
        className={cn(
          'inline-flex items-center gap-1.5 min-h-[40px] min-w-[44px] px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0',
          value === 'list'
            ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
            : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
        )}
      >
        <List className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">List</span>
      </button>
    </div>
  );
}
