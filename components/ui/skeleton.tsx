import { cn } from '../../lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('ed-skeleton rounded-md', className)}
    />
  );
}

export function CatalogGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="ed-catalog-grid" aria-busy="true" aria-label="Loading catalog items">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="flex flex-col rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 gap-3"
        >
          <Skeleton className="w-full aspect-square rounded-[var(--radius-thumb)]" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-4 w-1/2" />
          <div className="mt-auto pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-12 w-28 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CatalogListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading list items">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="flex items-center gap-4 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
        >
          <Skeleton className="w-16 h-16 rounded-[var(--radius-thumb)] shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-4 w-2/5" />
          </div>
          <Skeleton className="h-12 w-28 rounded-lg shrink-0" />
        </div>
      ))}
    </div>
  );
}
