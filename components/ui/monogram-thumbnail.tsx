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
  size?: 'sm' | 'md' | 'lg';
  showBadge?: boolean;
  className?: string;
}

const KIND_CLASSES: Record<ContentVisualKind, string> = {
  ebook: 'bg-[var(--thumb-ebook)] text-[var(--thumb-ebook-ink)]',
  exam: 'bg-[var(--thumb-exam)] text-[var(--thumb-exam-ink)]',
  quizbook: 'bg-[var(--thumb-quizbook)] text-[var(--thumb-quizbook-ink)]',
};

const BADGE_CLASSES: Record<ContentVisualKind, string> = {
  ebook: 'bg-slate-950/12 text-slate-950',
  exam: 'bg-slate-950/12 text-slate-950',
  quizbook: 'bg-white/18 text-white',
};

const SIZE_CLASSES: Record<'sm' | 'md' | 'lg', { box: string; monogram: string }> = {
  sm: {
    box: 'w-16 h-16 shrink-0',
    monogram: 'text-lg font-extrabold tracking-tight',
  },
  md: {
    box: 'w-full aspect-square',
    monogram: 'text-4xl sm:text-5xl font-extrabold tracking-tight',
  },
  lg: {
    box: 'w-full aspect-square max-w-[260px]',
    monogram: 'text-5xl sm:text-6xl font-extrabold tracking-tight',
  },
};

/**
 * Pure CSS/SVG 1:1 MonogramThumbnail (Zero Raster Media)
 * Renders bold 2-letter uppercase monogram + subtle corner type label.
 */
export function MonogramThumbnail({
  title,
  type,
  collectionName,
  size = 'md',
  showBadge = true,
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
        'relative flex items-center justify-center overflow-hidden rounded-[var(--radius-thumb)] select-none chrome-no-select border border-black/5 dark:border-white/10',
        KIND_CLASSES[visual.kind],
        sizing.box,
        className
      )}
    >
      <span className={cn('leading-none', sizing.monogram)}>{monogram}</span>

      {showBadge && size !== 'sm' && (
        <span
          className={cn(
            'absolute top-2.5 right-2.5 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase leading-tight',
            BADGE_CLASSES[visual.kind]
          )}
        >
          {visual.badgeLabel}
        </span>
      )}
    </div>
  );
}
