import { ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6 max-md:mb-3">
      <ol className="flex flex-wrap items-center gap-1.5 max-md:gap-1 text-sm max-md:text-xs text-[var(--text-muted)] min-w-0">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li
              key={`${item.label}-${idx}`}
              className="inline-flex items-center gap-1.5 max-md:gap-1 min-w-0"
            >
              {idx > 0 && (
                <ChevronRight
                  className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0"
                  aria-hidden="true"
                />
              )}
              {item.href && !isLast ? (
                <a
                  href={item.href}
                  className="max-md:min-h-[44px] max-md:inline-flex max-md:items-center hover:text-[var(--text-main)] hover:underline underline-offset-4 transition-colors whitespace-nowrap"
                >
                  {item.label}
                </a>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className="font-medium text-[var(--text-main)] truncate max-w-[260px] max-md:max-w-[185px] sm:max-w-[420px]"
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
