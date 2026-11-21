import React from 'react';
import Markdown from 'react-markdown';

function normalizeHeadingComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Strips any leading Markdown `#` / `##` heading that duplicates `heroTitle`
 * so the page never repeats the hero `<h1>` immediately inside the description body.
 */
export function prepareEditorialMarkdown(
  rawMarkdown: string,
  heroTitle: string
): string {
  const trimmed = (rawMarkdown || '').trim();
  if (!trimmed) return '';

  const lines = trimmed.split(/\r?\n/);
  let firstContentIdx = 0;
  while (firstContentIdx < lines.length && !lines[firstContentIdx].trim()) {
    firstContentIdx++;
  }

  if (firstContentIdx < lines.length) {
    const firstLine = lines[firstContentIdx].trim();
    const headingMatch = /^#{1,3}\s+(.+?)\s*#*$/.exec(firstLine);
    if (headingMatch && heroTitle) {
      const candidate = normalizeHeadingComparison(headingMatch[1]);
      const target = normalizeHeadingComparison(heroTitle);
      if (
        candidate &&
        target &&
        (candidate === target || candidate.startsWith(`${target} `))
      ) {
        return lines
          .slice(firstContentIdx + 1)
          .join('\n')
          .trim();
      }
    }
  }

  return trimmed;
}

/**
 * Server-rendered Editorial Markdown block enforcing Single-`<h1>` Discipline:
 * remaps `#` -> `<h2>`, `##` -> `<h3>`, `###` -> `<h4>`, etc.
 */
export function DescriptionMarkdown({
  markdown,
  heroTitle,
}: {
  markdown: string;
  heroTitle: string;
}) {
  const prepared = prepareEditorialMarkdown(markdown, heroTitle);

  return (
    <div className="markdown-body space-y-3">
      <Markdown
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
        }}
      >
        {prepared}
      </Markdown>
    </div>
  );
}
