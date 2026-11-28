import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MAX_EDITORIAL_MARKDOWN_CHARS = 120_000;

function normalizeHeadingComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Blocks unsafe protocols (`javascript:`, `vbscript:`, `data:`) in CMS/AI markdown links and images.
 */
export function sanitizeEditorialUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  if (
    trimmed.startsWith('#') ||
    (trimmed.startsWith('/') && !trimmed.startsWith('//'))
  ) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === 'https:' ||
      parsed.protocol === 'http:' ||
      parsed.protocol === 'mailto:'
    ) {
      return parsed.toString();
    }
    return '';
  } catch {
    return '';
  }
}

const GFM_DELIMITER_SEGMENT_RE =
  /\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|/;

/**
 * Repairs CMS markdown tables that were accidentally flattened onto a single line
 * (e.g. `| A | B | | :--- | :--- | | 1 | 2 |`) and guarantees a blank line before
 * pipe tables so GFM parses them deterministically.
 */
function normalizeMarkdownTables(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      output.push(line);
      continue;
    }

    if (inFence) {
      output.push(line);
      continue;
    }

    // Expand a single-line flattened GFM table: `| H1 | H2 | | :--- | :--- | | R1 | R2 |`
    if (
      trimmed.startsWith('|') &&
      trimmed.endsWith('|') &&
      GFM_DELIMITER_SEGMENT_RE.test(trimmed) &&
      /\|\s+\|/.test(trimmed)
    ) {
      const expandedRows = trimmed
        .split(/\|\s+\|/)
        .map((segment, idx, arr) => {
          const withLeading = idx === 0 ? segment : `|${segment}`;
          return idx === arr.length - 1 ? withLeading : `${withLeading}|`;
        });
      if (output.length > 0 && output[output.length - 1].trim() !== '') {
        output.push('');
      }
      output.push(...expandedRows);
      continue;
    }

    // Ensure a blank line separates a preceding paragraph from a standard GFM table header
    const nextTrimmed = lines[i + 1]?.trim() ?? '';
    const isTableHeaderStart =
      trimmed.includes('|') &&
      GFM_DELIMITER_SEGMENT_RE.test(
        nextTrimmed.startsWith('|') && nextTrimmed.endsWith('|')
          ? nextTrimmed
          : `|${nextTrimmed}|`
      );

    if (
      isTableHeaderStart &&
      output.length > 0 &&
      output[output.length - 1].trim() !== '' &&
      !output[output.length - 1].trim().startsWith('|')
    ) {
      output.push('');
    }

    output.push(line);
  }

  return output.join('\n');
}

function getCellAlignmentClass(style?: React.CSSProperties): string {
  if (style?.textAlign === 'center') return 'text-center';
  if (style?.textAlign === 'right' || style?.textAlign === 'end') {
    return 'text-end';
  }
  return 'text-start';
}

/**
 * Crash-proof preprocessor that caps input size, strips control characters, removes
 * any leading Markdown `#` / `##` heading that duplicates `heroTitle` so the page never
 * repeats the hero `<h1>` immediately inside the description body, and normalizes GFM tables.
 */
export function prepareEditorialMarkdown(
  rawMarkdown: string,
  heroTitle: string
): string {
  if (typeof rawMarkdown !== 'string') return '';
  try {
    const bounded = rawMarkdown
      .slice(0, MAX_EDITORIAL_MARKDOWN_CHARS)
      .replace(/\u0000/g, '')
      .trim();
    if (!bounded) return '';

    const lines = bounded.split(/\r?\n/);
    let firstContentIdx = 0;
    while (firstContentIdx < lines.length && !lines[firstContentIdx].trim()) {
      firstContentIdx++;
    }

    let body = bounded;
    if (firstContentIdx < lines.length) {
      const firstLine = lines[firstContentIdx].trim();
      const headingMatch = /^#{1,3}\s+(.+?)\s*#*$/.exec(firstLine);
      if (headingMatch && heroTitle) {
        const candidate = normalizeHeadingComparison(headingMatch[1]);
        const target = normalizeHeadingComparison(heroTitle);
        if (candidate && target && candidate === target) {
          body = lines
            .slice(firstContentIdx + 1)
            .join('\n')
            .trim();
        }
      }
    }

    return normalizeMarkdownTables(body);
  } catch {
    return rawMarkdown.slice(0, MAX_EDITORIAL_MARKDOWN_CHARS).trim();
  }
}

/**
 * Crash-proof Server-rendered Editorial Markdown block enforcing Single-`<h1>` Discipline:
 * enables GFM tables/strikethrough via `remark-gfm`, remaps `#` -> `<h2>`, `##` -> `<h3>`,
 * `###` -> `<h4>`, and sanitizes URLs.
 */
export function DescriptionMarkdown({
  markdown,
  heroTitle,
}: {
  markdown: string;
  heroTitle: string;
}) {
  const prepared = prepareEditorialMarkdown(markdown, heroTitle);
  if (!prepared) return null;

  return (
    <div className="markdown-body space-y-3">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={sanitizeEditorialUrl}
        components={{
          h1: ({ children }) => (
            <h2 className="text-base sm:text-lg font-bold text-[var(--text-main)] mt-5 mb-2">
              {children}
            </h2>
          ),
          h2: ({ children }) => (
            <h3 className="text-sm sm:text-base font-bold text-[var(--text-main)] mt-4 mb-1.5">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="text-sm font-semibold text-[var(--text-main)] mt-3 mb-1">
              {children}
            </h4>
          ),
          h4: ({ children }) => (
            <h5 className="text-sm font-semibold text-[var(--text-main)] mt-3 mb-1">
              {children}
            </h5>
          ),
          h5: ({ children }) => (
            <h6 className="text-xs font-semibold text-[var(--text-main)] mt-2 mb-1">
              {children}
            </h6>
          ),
          table: ({ children }) => (
            <div className="ed-markdown-table-wrap my-4 overflow-x-auto max-w-full rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
              <table className="w-full border-collapse text-start text-sm max-md:text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/55">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="transition-colors hover:bg-[var(--bg-elevated)]/40">
              {children}
            </tr>
          ),
          th: ({ children, style }) => (
            <th
              scope="col"
              className={`py-3 px-4 max-md:py-2.5 max-md:px-3 font-semibold text-xs sm:text-[13px] text-[var(--text-main)] align-bottom leading-snug ${getCellAlignmentClass(
                style
              )}`}
            >
              {children}
            </th>
          ),
          td: ({ children, style }) => (
            <td
              className={`py-3 px-4 max-md:py-2.5 max-md:px-3 text-sm max-md:text-xs text-[var(--text-main)] align-top leading-relaxed ${getCellAlignmentClass(
                style
              )}`}
            >
              {children}
            </td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-4 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-[var(--text-muted)]">
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr className="my-5 border-0 border-t border-[var(--border-subtle)]" />
          ),
          a: ({ href, children }) => {
            const safeHref = sanitizeEditorialUrl(href || '');
            if (!safeHref) {
              return <span>{children}</span>;
            }
            const isExternal = /^https?:\/\//i.test(safeHref);
            return (
              <a
                href={safeHref}
                className="font-medium text-[var(--text-main)] underline underline-offset-4 decoration-[var(--border-strong)] hover:decoration-[var(--text-main)] transition-colors"
                {...(isExternal
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {prepared}
      </Markdown>
    </div>
  );
}
