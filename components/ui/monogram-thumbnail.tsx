import type { CollectionName } from '../../lib/types/catalog';
import {
  deriveMonogram,
  resolveContentTypeVisual,
  type ContentVisualKind,
} from '../../lib/registry/content-type-registry';
import { cn } from '../../lib/utils';

export interface MonogramThumbnailProps {
  title: string;
  type: string;
  collectionName: CollectionName;
  size?: 'xs' | 'sm' | 'list' | 'md' | 'lg';
  showBadge?: boolean;
  contentOffsetClass?: string;
  className?: string;
}

const KIND_CLASSES: Record<ContentVisualKind, string> = {
  ebook: 'bg-[var(--thumb-ebook)] text-[var(--thumb-ebook-ink)]',
  exam: 'bg-[var(--thumb-exam)] text-[var(--thumb-exam-ink)]',
  quizbook: 'bg-[var(--thumb-quizbook)] text-[var(--thumb-quizbook-ink)]',
};

const BADGE_CLASSES: Record<ContentVisualKind, string> = {
  ebook:
    'bg-black/10 text-[var(--thumb-ebook-ink)] dark:bg-white/10',
  exam:
    'bg-black/10 text-[var(--thumb-exam-ink)] dark:bg-white/10',
  quizbook:
    'bg-black/10 text-[var(--thumb-quizbook-ink)] dark:bg-white/10',
};

const SIZE_CLASSES: Record<
  'xs' | 'sm' | 'list' | 'md' | 'lg',
  { box: string; monogram: string; badge?: string }
> = {
  xs: {
    box: 'w-12 h-12 shrink-0',
    monogram: 'text-sm font-extrabold tracking-tight',
  },
  sm: {
    box: 'w-16 h-16 shrink-0',
    monogram: 'text-lg font-extrabold tracking-tight',
  },
  list: {
    box: 'w-24 h-24 sm:w-28 sm:h-28 shrink-0',
    monogram: 'text-2xl sm:text-3xl font-extrabold tracking-tight',
    badge:
      'top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase leading-none',
  },
  md: {
    box: 'w-full aspect-square',
    monogram: 'text-3xl sm:text-4xl font-extrabold tracking-tight',
    badge:
      'top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase leading-tight',
  },
  lg: {
    box: 'w-full aspect-square max-w-[260px]',
    monogram: 'text-3xl sm:text-5xl font-extrabold tracking-tight',
    badge:
      'top-2 right-2 px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold tracking-wider uppercase leading-tight',
  },
};

/**
 * Pure CSS/SVG 1:1 MonogramThumbnail (Zero Raster Media, Matte Desaturated Surface)
 */
export function MonogramThumbnail({
  title,
  type,
  collectionName,
  size = 'list',
  showBadge = true,
  contentOffsetClass,
  className,
}: MonogramThumbnailProps) {
  const visual = resolveContentTypeVisual(type, collectionName);
  const monogram = deriveMonogram(title);
  const sizing = SIZE_CLASSES[size];

  return (
    <div
      role="img"
      aria-label={`${title} (${visual.badgeLabel})`}
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-[var(--radius-thumb)] select-none chrome-no-select border border-[var(--border-subtle)]',
        KIND_CLASSES[visual.kind],
        sizing.box,
        className
      )}
    >
      <span className={cn('leading-none', sizing.monogram, contentOffsetClass)}>
        {monogram}
      </span>

      {showBadge && sizing.badge && (
        <span className={cn('absolute', sizing.badge, BADGE_CLASSES[visual.kind])}>
          {visual.badgeLabel}
        </span>
      )}
    </div>
  );
}
