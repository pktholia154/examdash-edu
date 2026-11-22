/// <reference lib="webworker" />

import MarkdownIt from 'markdown-it';

export interface MarkdownTocItem {
  id: string;
  text: string;
  level: 1;
  sectionId: string;
  blockId: string;
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
  mathMap: Record<string, string>;
  hasMath: boolean;
  hasFencedCode: boolean;
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
  if (/\\\[[\s\S]+?\\\]/.test(md)) return true;
  if (/\\\([\s\S]+?\\\)/.test(md)) return true;
  return /(?<!\\)\$(?!\s)(?:\\\$|[^$\n])+?(?<!\s)(?<!\\)\$/.test(md);
}

function detectFencedCode(md: string): boolean {
  return /^```/m.test(md);
}

/**
 * Minimal preprocessing:
 * - Normalizes line endings
 * - Converts GFM Alert Callouts (> [!NOTE], [!TIP], [!IMPORTANT], [!WARNING])
 * - Unwraps any raw <details>/<summary> "tap to reveal" wrappers so full text renders directly
 * - Leaves MCQ answers/solutions completely inline (no tap-to-reveal controls)
 */
function preprocessStudyMarkdown(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const out: string[] = [];

  let inFence = false;
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

    // Strip collapsible <details> / <summary> tags so all text displays directly
    if (/^<\/?details\b[^>]*>$/i.test(trimmed)) {
      i++;
      continue;
    }
    if (/^<summary\b[^>]*>[\s\S]*?<\/summary>$/i.test(trimmed)) {
      i++;
      continue;
    }

    // GFM Alert Callout: > [!NOTE] | > [!TIP] | > [!IMPORTANT] | > [!WARNING]
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

    // Remove inline <details>/<summary> wrappers if present on the same line
    const cleanedLine = line
      .replace(/<details\b[^>]*>/gi, '')
      .replace(/<\/details>/gi, '')
      .replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/gi, '');

    out.push(cleanedLine);
    i++;
  }

  return out.join('\n');
}

/**
 * Extracts LaTeX math ($$...$$, \[...\], \(...\), and currency-safe $...$) outside
 * fenced and inline code spans, renders with KaTeX (trust: false), and stores safe
 * HTML in mathMap for post-DOMPurify hydration on the main thread.
 */
function extractAndRenderMath(
  input: string,
  renderFn: (tex: string, displayMode: boolean) => string
): { text: string; mathMap: Record<string, string> } {
  const codeProtections: string[] = [];
  const mathMap: Record<string, string> = {};
  let mathCounter = 0;

  // 1. Protect fenced code blocks (```...```) and inline code (`...`)
  let protectedText = input.replace(
    /(^```[\s\S]*?^```|`[^`\n]+`)/gm,
    (match) => {
      const idx = codeProtections.length;
      codeProtections.push(match);
      return `@@ED_CODE_PROT_${idx}@@`;
    }
  );

  const registerMath = (tex: string, displayMode: boolean): string => {
    const id = `math_${mathCounter++}`;
    mathMap[id] = renderFn(tex.trim(), displayMode);
    return displayMode
      ? `\n\n@@ED_MATH_BLOCK_${id}@@\n\n`
      : `@@ED_MATH_INLINE_${id}@@`;
  };

  // 2. Display math: $$ ... $$
  protectedText = protectedText.replace(
    /(?<!\\)\$\$([\s\S]+?)\$\$/g,
    (_m, expr: string) => registerMath(expr, true)
  );

  // 3. Display math: \[ ... \]
  protectedText = protectedText.replace(
    /\\\[([\s\S]+?)\\\]/g,
    (_m, expr: string) => registerMath(expr, true)
  );

  // 4. Inline math: \( ... \)
  protectedText = protectedText.replace(
    /\\\(([\s\S]+?)\\\)/g,
    (_m, expr: string) => registerMath(expr, false)
  );

  // 5. Inline math: $ ... $ (currency-safe: skips e.g. "$10 and $20")
  protectedText = protectedText.replace(
    /(?<!\\)(?<!\$)\$(?!\s|\$)((?:\\\$|[^$\n])+?)(?<!\s)(?<!\\)\$(?!\$)/g,
    (fullMatch, expr: string, offset: number, fullStr: string) => {
      const afterIdx = offset + fullMatch.length;
      const charAfter = fullStr[afterIdx] || '';
      // Avoid mis-parsing currency pairs like "$10 to $20" or "$50, $60"
      if (/^\d/.test(expr) && /\d/.test(charAfter)) {
        return fullMatch;
      }
      if (/^\d[\d,.\s]*(?:and|or|to|per|for|of|in|is|was|were)\b/i.test(expr)) {
        return fullMatch;
      }
      return registerMath(expr, false);
    }
  );

  // 6. Restore protected code blocks
  const restored = protectedText.replace(
    /@@ED_CODE_PROT_(\d+)@@/g,
    (_m, idxStr: string) => codeProtections[Number(idxStr)] ?? ''
  );

  return { text: restored, mathMap };
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

  // Lazy-load KaTeX when math tokens exist
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
          trust: false,
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

  const processed = preprocessStudyMarkdown(rawMarkdown);

  // Extract & render KaTeX BEFORE MarkdownIt so underscores, backslashes, and asterisks are preserved
  let mdInput = processed;
  let mathMap: Record<string, string> = {};
  if (katexRender) {
    const extracted = extractAndRenderMath(processed, katexRender);
    mdInput = extracted.text;
    mathMap = extracted.mathMap;
  }

  // typographer: false prevents (C) -> ©, (R) -> ®, (TM) -> ™ replacements in MCQ options
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    breaks: true,
  });

  // Minimal fenced code renderer
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = (token.info || '').trim().split(/\s+/)[0] || '';
    const rawCode = token.content;
    const highlighted = highlightCode
      ? highlightCode(rawCode, info)
      : escapeHtml(rawCode);
    return `<div class="md-scroll-x"><pre><code class="hljs">${highlighted}</code></pre></div>`;
  };

  // Lazy images with tap-to-expand lightbox marker
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
  const sections: MarkdownSectionChunk[] = [];

  let sectionIdx = 1;
  let currentSectionId = `sec_${sectionIdx}`;
  let currentSectionTitle = 'Introduction';
  let currentSectionTokens: typeof tokens = [];

  let blockCounter = 0;
  let tableCounter = 0;
  let depth = 0;

  const flushSection = () => {
    if (currentSectionTokens.length === 0) return;
    let html = md.renderer.render(currentSectionTokens, md.options, {});

    // Replace math placeholders with DOMPurify-safe placeholder elements
    if (Object.keys(mathMap).length > 0) {
      html = html.replace(
        /<p>@@ED_MATH_BLOCK_(math_\d+)@@<\/p>/g,
        '<div class="ed-md-math-block" data-katex-id="$1"></div>'
      );
      html = html.replace(
        /@@ED_MATH_BLOCK_(math_\d+)@@/g,
        '<div class="ed-md-math-block" data-katex-id="$1"></div>'
      );
      html = html.replace(
        /@@ED_MATH_INLINE_(math_\d+)@@/g,
        '<span class="ed-md-math-inline" data-katex-id="$1"></span>'
      );
    }

    // Wrap every <table> in minimal .md-scroll-x without extra header controls
    html = html.replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
      tableCounter += 1;
      return `<div class="md-scroll-x" data-block-id="blk_tbl_${tableCounter}">${tableHtml}</div>`;
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
        const headingText = (inlineTok?.content || '')
          .replace(/@@ED_MATH_(?:BLOCK|INLINE)_math_\d+@@/g, '')
          .trim() || 'Section';
        const levelNum = Number(tok.tag.slice(1));
        const blockId = `blk_${++blockCounter}`;
        tok.attrSet('data-block-id', blockId);

        if (levelNum === 1 || levelNum === 2 || levelNum === 3) {
          const slug = slugifyHeading(headingText, seenSlugs);
          tok.attrSet('id', slug);
          if (levelNum === 1) {
            currentSectionTitle = headingText;
            // Menu TOC strictly allows only h1 headings
            toc.push({
              id: slug,
              text: headingText,
              level: 1,
              sectionId: currentSectionId,
              blockId,
            });
          } else if (levelNum === 2) {
            currentSectionTitle = headingText;
          }
        }
      } else if (
        tok.type === 'paragraph_open' ||
        tok.type === 'bullet_list_open' ||
        tok.type === 'ordered_list_open' ||
        tok.type === 'blockquote_open'
      ) {
        const blockId = `blk_${++blockCounter}`;
        tok.attrSet('data-block-id', blockId);
      } else if (tok.type === 'html_block' && tok.content.trim()) {
        const blockId = `blk_${++blockCounter}`;
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
    mathMap,
    hasMath: Object.keys(mathMap).length > 0,
    hasFencedCode,
  };

  workerScope.postMessage(response);
};
