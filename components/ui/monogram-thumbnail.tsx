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
  ebook: 'ed-thumb-ebook',
  exam: 'ed-thumb-exam',
  quizbook: 'ed-thumb-quizbook',
};

const BADGE_CLASSES: Record<ContentVisualKind, string> = {
  ebook:
    'bg-white/75 text-[var(--thumb-ebook-ink)] border border-[var(--thumb-ebook-accent)]/20 dark:bg-black/35 dark:border-white/15',
  exam:
    'bg-white/75 text-[var(--thumb-exam-ink)] border border-[var(--thumb-exam-accent)]/20 dark:bg-black/35 dark:border-white/15',
  quizbook:
    'bg-white/75 text-[var(--thumb-quizbook-ink)] border border-[var(--thumb-quizbook-accent)]/20 dark:bg-black/35 dark:border-white/15',
};

const ACCENT_STRIP_CLASSES: Record<ContentVisualKind, string> = {
  ebook: 'bg-[var(--thumb-ebook-accent)]',
  exam: 'bg-[var(--thumb-exam-accent)]',
  quizbook: 'bg-[var(--thumb-quizbook-accent)]',
};

const SIZE_CLASSES: Record<
  'xs' | 'sm' | 'list' | 'md' | 'lg',
  { box: string; monogram: string; badge?: string }
> = {
  xs: {
    box: 'w-12 h-12 shrink-0',
    monogram: 'text-sm font-extrabold tracking-[-0.03em]',
  },
  sm: {
    box: 'w-16 h-16 shrink-0',
    monogram: 'text-lg font-extrabold tracking-[-0.03em]',
  },
  list: {
    box: 'w-24 h-24 sm:w-28 sm:h-28 shrink-0',
    monogram: 'text-2xl sm:text-3xl font-extrabold tracking-[-0.04em]',
    badge:
      'top-1.5 right-1.5 px-1.5 py-0.5 rounded-[5px] text-[9px] font-bold tracking-wider leading-none',
  },
  md: {
    box: 'w-full aspect-square',
    monogram: 'text-3xl sm:text-4xl font-extrabold tracking-[-0.04em]',
    badge:
      'top-2 right-2 px-1.5 py-0.5 rounded-[5px] text-[9px] font-bold tracking-wider leading-tight',
  },
  lg: {
    box: 'w-full aspect-square max-w-[260px]',
    monogram: 'text-3xl sm:text-5xl font-extrabold tracking-[-0.04em]',
    badge:
      'top-2.5 right-2.5 px-2 py-0.5 rounded-[5px] text-[9px] sm:text-[10px] font-bold tracking-wider leading-tight',
  },
};

/**
 * Pure CSS 1:1 MonogramThumbnail with Editorial Publishing Craftsmanship
 * (Tactile gradient surface, domain binding/sheet motifs, crisp legible monogram)
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
  const isCompact = size === 'xs' || size === 'sm';
  const isLarge = size === 'md' || size === 'lg';

  return (
    <div
      role="img"
      aria-label={`${title} (${visual.badgeLabel})`}
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-[var(--radius-thumb)] select-none chrome-no-select border',
        KIND_CLASSES[visual.kind],
        sizing.box,
        className
      )}
    >
      {/* Domain-distinct subtle publishing motif (book spine / exam header bar / quizbook index tab) */}
      {visual.kind === 'ebook' && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 start-0 border-e border-black/10 dark:border-white/10',
            isCompact ? 'w-[4px]' : isLarge ? 'w-[9px]' : 'w-[6px]',
            'bg-[var(--thumb-ebook-accent)]/25'
          )}
        />
      )}

      {visual.kind === 'exam' && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0',
            isCompact ? 'h-[2.5px]' : isLarge ? 'h-[4px]' : 'h-[3px]',
            ACCENT_STRIP_CLASSES.exam,
            'opacity-80'
          )}
        />
      )}

      {visual.kind === 'quizbook' && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 start-0',
            isCompact ? 'w-[3px]' : isLarge ? 'w-[5px]' : 'w-[4px]',
            ACCENT_STRIP_CLASSES.quizbook,
            'opacity-70'
          )}
        />
      )}

      {/* Subtle framed edition hairline on larger detail thumbnails */}
      {isLarge && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-1.5 rounded-[5px] border border-current opacity-[0.12]"
        />
      )}

      <span
        className={cn(
          'relative z-[1] leading-none drop-shadow-[0_1px_0_rgba(255,255,255,0.35)] dark:drop-shadow-none',
          visual.kind === 'ebook' && !isCompact && 'ps-1',
          sizing.monogram,
          contentOffsetClass
        )}
      >
        {monogram}
      </span>

      {showBadge && sizing.badge && (
        <span
          className={cn(
            'absolute z-[1] backdrop-blur-[2px]',
            sizing.badge,
            BADGE_CLASSES[visual.kind]
          )}
        >
          {visual.badgeLabel}
        </span>
      )}
    </div>
  );
}
