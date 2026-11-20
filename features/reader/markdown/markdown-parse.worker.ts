/// <reference lib="webworker" />

import MarkdownIt from 'markdown-it';

export interface MarkdownTocItem {
  id: string;
  text: string;
  level: 1 | 2 | 3;
  sectionId: string;
  blockId: string;
}

export interface MarkdownSearchEntry {
  blockId: string;
  sectionId: string;
  headingTitle: string;
  text: string;
}

export interface MarkdownSectionChunk {
  sectionId: string;
  headingTitle: string;
  rawHtml: string;
}

export interface MarkdownWorkerRequest {
  type: 'PARSE_MARKDOWN';
  requestId: string;
  markdown: string;
  assetBaseUrl?: string;
}

export interface MarkdownWorkerResponse {
  type: 'PARSE_SUCCESS';
  requestId: string;
  sections: MarkdownSectionChunk[];
  toc: MarkdownTocItem[];
  searchIndex: MarkdownSearchEntry[];
  codeMap: Record<string, string>;
  tableMap: Record<string, string>;
  hasMath: boolean;
  hasFencedCode: boolean;
  hasSolutionAccordions: boolean;
}

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugifyHeading(text: string, seen: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 72) || 'section';
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function detectMathTokens(md: string): boolean {
  if (/\$\$[\s\S]+?\$\$/.test(md)) return true;
  // Match inline $...$ where content starts/ends without whitespace and isn't plain currency
  return /(?:^|[\s(])\$(?!\s)([^$\n]{1,160}?)(?<!\s)\$(?=[\s).,;:!?]|$)/m.test(md);
}

function detectFencedCode(md: string): boolean {
  return /^```/m.test(md);
}

/**
 * Pre-processes GFM Alert Callouts (> [!NOTE], [!TIP], [!IMPORTANT], [!WARNING])
 * and ExamDash MCQ Solution lines (Ans: / Answer: / Solution:) outside fenced code blocks.
 */
function preprocessStudyMarkdown(raw: string): {
  processed: string;
  hasSolutionAccordions: boolean;
} {
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const out: string[] = [];

  let inFence = false;
  let inDetails = false;
  let hasSolutionAccordions = false;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }

    if (inFence) {
      out.push(line);
      i++;
      continue;
    }

    if (/<details\b/i.test(trimmed)) inDetails = true;
    if (/<\/details>/i.test(trimmed)) inDetails = false;
    if (/<summary\b/i.test(trimmed)) hasSolutionAccordions = true;

    // 1. GFM Alert Callout: > [!NOTE] | > [!TIP] | > [!IMPORTANT] | > [!WARNING]
    const alertMatch = trimmed.match(
      /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING)\]\s*(.*)$/i
    );
    if (alertMatch) {
      const kind = alertMatch[1].toLowerCase() as
        | 'note'
        | 'tip'
        | 'important'
        | 'warning';
      const customTitle = alertMatch[2].trim();
      const labelMap: Record<typeof kind, string> = {
        note: 'Note',
        tip: 'Study Tip',
        important: 'Key Concept',
        warning: 'Exam Caution',
      };
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        bodyLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push('');
      out.push(
        `<div class="ed-md-callout ed-md-callout-${kind}"><div class="ed-md-callout-title">${escapeHtml(
          customTitle || labelMap[kind]
        )}</div>\n\n${bodyLines.join('\n')}\n\n</div>`
      );
      out.push('');
      continue;
    }

    // 2. ExamDash Question Bank Answer/Solution line -> Interactive <details> card
    if (
      !inDetails &&
      /^(?:\*\*)?(?:Ans|Answer|Solution|Correct Answer)(?:\*\*)?\s*[:.-]\s+/i.test(
        trimmed
      )
    ) {
      const answerLines: string[] = [trimmed];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !/^(?:\*\*Q\d+|Q\d+[.)]|#{1,6}\s|```|>\s)/.test(lines[i].trim())
      ) {
        answerLines.push(lines[i].trim());
        i++;
      }
      hasSolutionAccordions = true;
      out.push('');
      out.push(
        `<details class="ed-md-solution"><summary>Tap to reveal solution</summary><div class="ed-md-solution-body">\n\n${answerLines.join(
          '\n'
        )}\n\n</div></details>`
      );
      out.push('');
      continue;
    }

    out.push(line);
    i++;
  }

  return {
    processed: out.join('\n'),
    hasSolutionAccordions,
  };
}

function resolveImageSrc(src: string, assetBaseUrl?: string): string {
  if (!src) return '';
  if (
    src.startsWith('http://') ||
    src.startsWith('https://') ||
    src.startsWith('data:image/') ||
    src.startsWith('blob:') ||
    src.startsWith('/')
  ) {
    return src;
  }
  if (assetBaseUrl) {
    try {
      return new URL(src, assetBaseUrl).href;
    } catch {
      return src;
    }
  }
  return src;
}

workerScope.onmessage = async (event: MessageEvent<MarkdownWorkerRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'PARSE_MARKDOWN') return;

  const rawMarkdown = msg.markdown || '';
  const hasMath = detectMathTokens(rawMarkdown);
  const hasFencedCode = detectFencedCode(rawMarkdown);

  // Lazy-load heavy study modules strictly on demand inside the Worker
  let katexRender:
    | ((tex: string, displayMode: boolean) => string)
    | null = null;
  if (hasMath) {
    try {
      const katexMod = await import('katex');
      const katex = katexMod.default ?? katexMod;
      katexRender = (tex: string, displayMode: boolean) =>
        katex.renderToString(tex, {
          displayMode,
          throwOnError: false,
          strict: 'ignore',
        });
    } catch {
      katexRender = null;
    }
  }

  let highlightCode:
    | ((code: string, lang: string) => string)
    | null = null;
  if (hasFencedCode) {
    try {
      const [
        hljsCoreMod,
        jsMod,
        tsMod,
        pyMod,
        sqlMod,
        jsonMod,
        bashMod,
        xmlMod,
      ] = await Promise.all([
        import('highlight.js/lib/core'),
        import('highlight.js/lib/languages/javascript'),
        import('highlight.js/lib/languages/typescript'),
        import('highlight.js/lib/languages/python'),
        import('highlight.js/lib/languages/sql'),
        import('highlight.js/lib/languages/json'),
        import('highlight.js/lib/languages/bash'),
        import('highlight.js/lib/languages/xml'),
      ]);
      const hljs = hljsCoreMod.default ?? hljsCoreMod;
      hljs.registerLanguage('javascript', jsMod.default);
      hljs.registerLanguage('js', jsMod.default);
      hljs.registerLanguage('typescript', tsMod.default);
      hljs.registerLanguage('ts', tsMod.default);
      hljs.registerLanguage('python', pyMod.default);
      hljs.registerLanguage('py', pyMod.default);
      hljs.registerLanguage('sql', sqlMod.default);
      hljs.registerLanguage('json', jsonMod.default);
      hljs.registerLanguage('bash', bashMod.default);
      hljs.registerLanguage('sh', bashMod.default);
      hljs.registerLanguage('html', xmlMod.default);
      hljs.registerLanguage('xml', xmlMod.default);

      highlightCode = (code: string, lang: string) => {
        const cleanLang = (lang || '').trim().toLowerCase();
        if (cleanLang && hljs.getLanguage(cleanLang)) {
          return hljs.highlight(code, { language: cleanLang }).value;
        }
        return escapeHtml(code);
      };
    } catch {
      highlightCode = null;
    }
  }

  const { processed, hasSolutionAccordions } =
    preprocessStudyMarkdown(rawMarkdown);

  // Replace display $$...$$ and inline $...$ math before MarkdownIt if KaTeX is loaded
  const mathPlaceholders: string[] = [];
  let mdInput = processed;
  if (katexRender) {
    const renderFn = katexRender;
    mdInput = mdInput.replace(/\$\$([\s\S]+?)\$\$/g, (_m, expr: string) => {
      const idx = mathPlaceholders.length;
      mathPlaceholders.push(
        `<div class="md-scroll-x p-3 my-3">${renderFn(expr.trim(), true)}</div>`
      );
      return `@@ED_MATH_BLOCK_${idx}@@`;
    });
    mdInput = mdInput.replace(
      /(^|[\s(])\$(?!\s)([^$\n]{1,160}?)(?<!\s)\$(?=[\s).,;:!?]|$)/gm,
      (_m, prefix: string, expr: string) => {
        const idx = mathPlaceholders.length;
        mathPlaceholders.push(renderFn(expr.trim(), false));
        return `${prefix}@@ED_MATH_INLINE_${idx}@@`;
      }
    );
  }

  const codeMap: Record<string, string> = {};
  const tableMap: Record<string, string> = {};
  let codeCounter = 0;

  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: true,
  });

  // Custom fenced code renderer with .md-scroll-x + 1-tap Copy button
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = (token.info || '').trim().split(/\s+/)[0] || '';
    const rawCode = token.content;
    const codeId = `code_${++codeCounter}`;
    codeMap[codeId] = rawCode;

    const highlighted = highlightCode
      ? highlightCode(rawCode, info)
      : escapeHtml(rawCode);

    const langLabel = info ? escapeHtml(info.toUpperCase()) : 'CODE';
    return `<div class="md-scroll-x"><div class="ed-md-code-bar"><span>${langLabel}</span><button type="button" class="ed-md-action-btn" data-code-copy="${codeId}">Copy</button></div><pre><code class="hljs">${highlighted}</code></pre></div>`;
  };

  // Mode-aware lazy images with tap-to-expand lightbox marker
  const defaultImgRule =
    md.renderer.rules.image ||
    ((tokens, idx, options, _env, selfRenderer) =>
      selfRenderer.renderToken(tokens, idx, options));

  md.renderer.rules.image = (tokens, idx, options, env, selfRenderer) => {
    const token = tokens[idx];
    const rawSrc = String(token.attrGet('src') || '');
    token.attrSet('src', resolveImageSrc(rawSrc, msg.assetBaseUrl));
    token.attrSet('loading', 'lazy');
    token.attrSet('decoding', 'async');
    token.attrSet('referrerpolicy', 'no-referrer');
    token.attrSet('data-md-lightbox', 'true');
    return defaultImgRule(tokens, idx, options, env, selfRenderer);
  };

  // Parse token stream and split into logical <section data-sec-id> chunks at h1/h2 boundaries
  const tokens = md.parse(mdInput, {});
  const seenSlugs = new Map<string, number>();
  const toc: MarkdownTocItem[] = [];
  const searchIndex: MarkdownSearchEntry[] = [];
  const sections: MarkdownSectionChunk[] = [];

  let sectionIdx = 1;
  let currentSectionId = `sec_${sectionIdx}`;
  let currentSectionTitle = 'Introduction';
  let currentHeadingTitle = 'Overview';
  let currentSectionTokens: typeof tokens = [];

  let blockCounter = 0;
  let tableCounter = 0;
  let depth = 0;

  const flushSection = () => {
    if (currentSectionTokens.length === 0) return;
    let html = md.renderer.render(currentSectionTokens, md.options, {});

    // Restore math placeholders
    if (mathPlaceholders.length > 0) {
      html = html.replace(/@@ED_MATH_(?:BLOCK|INLINE)_(\d+)@@/g, (_m, idxStr) => {
        return mathPlaceholders[Number(idxStr)] || '';
      });
    }

    // Wrap every <table> in .md-scroll-x with an "Expand Table" button
    html = html.replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
      const tableId = `tbl_${++tableCounter}`;
      tableMap[tableId] = tableHtml;
      return `<div class="md-scroll-x" data-block-id="blk_tbl_${tableCounter}"><div class="ed-md-table-bar"><span>Data Table · Swipe horizontally</span><button type="button" class="ed-md-action-btn" data-table-expand="${tableId}">Expand Table</button></div>${tableHtml}</div>`;
    });

    sections.push({
      sectionId: currentSectionId,
      headingTitle: currentSectionTitle,
      rawHtml: html,
    });
    currentSectionTokens = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    // Split section BEFORE top-level h1 / h2 (once initial content exists)
    if (
      depth === 0 &&
      tok.type === 'heading_open' &&
      (tok.tag === 'h1' || tok.tag === 'h2') &&
      currentSectionTokens.length > 0
    ) {
      flushSection();
      sectionIdx += 1;
      currentSectionId = `sec_${sectionIdx}`;
    }

    // Stamp deterministic [data-block-id] on top-level blocks
    if (depth === 0) {
      if (tok.type === 'heading_open') {
        const inlineTok = tokens[i + 1];
        const headingText = (inlineTok?.content || '').trim() || 'Section';
        const levelNum = Number(tok.tag.slice(1));
        const blockId = `blk_${++blockCounter}`;
        tok.attrSet('data-block-id', blockId);

        if (levelNum === 1 || levelNum === 2 || levelNum === 3) {
          const slug = slugifyHeading(headingText, seenSlugs);
          tok.attrSet('id', slug);
          currentHeadingTitle = headingText;
          if (levelNum === 1 || levelNum === 2) {
            currentSectionTitle = headingText;
          }
          toc.push({
            id: slug,
            text: headingText,
            level: levelNum as 1 | 2 | 3,
            sectionId: currentSectionId,
            blockId,
          });
        }

        searchIndex.push({
          blockId,
          sectionId: currentSectionId,
          headingTitle: currentHeadingTitle,
          text: headingText,
        });
      } else if (
        tok.type === 'paragraph_open' ||
        tok.type === 'bullet_list_open' ||
        tok.type === 'ordered_list_open' ||
        tok.type === 'blockquote_open'
      ) {
        const blockId = `blk_${++blockCounter}`;
        tok.attrSet('data-block-id', blockId);
        const nextInline = tokens[i + 1];
        if (nextInline?.type === 'inline' && nextInline.content.trim()) {
          searchIndex.push({
            blockId,
            sectionId: currentSectionId,
            headingTitle: currentHeadingTitle,
            text: nextInline.content.replace(/@@ED_MATH_\w+_\d+@@/g, '[formula]').trim(),
          });
        }
      } else if (tok.type === 'fence') {
        const blockId = `blk_${++blockCounter}`;
        if (tok.content.trim()) {
          searchIndex.push({
            blockId,
            sectionId: currentSectionId,
            headingTitle: currentHeadingTitle,
            text: tok.content.slice(0, 600).trim(),
          });
        }
      } else if (tok.type === 'html_block' && tok.content.trim()) {
        const blockId = `blk_${++blockCounter}`;
        const plain = tok.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (plain) {
          searchIndex.push({
            blockId,
            sectionId: currentSectionId,
            headingTitle: currentHeadingTitle,
            text: plain.slice(0, 600),
          });
        }
        tok.content = `<div data-block-id="${blockId}">${tok.content}</div>`;
      }
    }

    if (tok.nesting === 1) depth += 1;
    if (tok.nesting === -1) depth = Math.max(0, depth - 1);

    currentSectionTokens.push(tok);
  }

  flushSection();

  const response: MarkdownWorkerResponse = {
    type: 'PARSE_SUCCESS',
    requestId: msg.requestId,
    sections,
    toc,
    searchIndex,
    codeMap,
    tableMap,
    hasMath,
    hasFencedCode,
    hasSolutionAccordions,
  };

  workerScope.postMessage(response);
};
