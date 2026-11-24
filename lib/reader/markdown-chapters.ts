import MarkdownIt from 'markdown-it';

export interface MarkdownSubheadingItem {
  id: string;
  text: string;
  level: 2 | 3 | 4;
  blockId: string;
}

export interface MarkdownTocItem {
  id: string;
  text: string;
  level: 1;
  chapterIndex: number;
  chapterId: string;
  blockId: string;
  wordCount: number;
  estimatedReadMinutes: number;
  subheadings: MarkdownSubheadingItem[];
}

export interface MarkdownChapterChunk {
  chapterIndex: number;
  chapterId: string;
  headingId: string;
  title: string;
  hasH1Heading: boolean;
  rawHtml: string;
  firstBlockId: string;
  startBlockNum: number;
  endBlockNum: number;
  anchorIds: string[];
  subheadings: MarkdownSubheadingItem[];
  wordCount: number;
  estimatedReadMinutes: number;
}

export interface ParsedMarkdownBook {
  chapters: MarkdownChapterChunk[];
  toc: MarkdownTocItem[];
  mathMap: Record<string, string>;
  hasMath: boolean;
  hasFencedCode: boolean;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function slugifyHeading(text: string, seen: Map<string, number>): string {
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

export function detectMathTokens(md: string): boolean {
  if (/\$\$[\s\S]+?\$\$/.test(md)) return true;
  if (/\\\[[\s\S]+?\\\]/.test(md)) return true;
  if (/\\\([\s\S]+?\\\)/.test(md)) return true;
  return /(?<!\\)\$(?!\s)(?:\\\$|[^$\n])+?(?<!\s)(?<!\\)\$/.test(md);
}

export function detectFencedCode(md: string): boolean {
  return /^```/m.test(md);
}

/**
 * Normalizes line endings, converts GFM Alert Callouts (> [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]),
 * and unwraps raw <details>/<summary> wrappers so study answers display inline cleanly.
 */
export function preprocessStudyMarkdown(raw: string): string {
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

    if (/^<\/?details\b[^>]*>$/i.test(trimmed)) {
      i++;
      continue;
    }
    if (/^<summary\b[^>]*>[\s\S]*?<\/summary>$/i.test(trimmed)) {
      i++;
      continue;
    }

    const alertMatch = trimmed.match(
      /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i
    );
    if (alertMatch) {
      const kind = alertMatch[1].toLowerCase() as
        | 'note'
        | 'tip'
        | 'important'
        | 'warning'
        | 'caution';
      const customTitle = alertMatch[2].trim();
      const labelMap: Record<typeof kind, string> = {
        note: 'Note',
        tip: 'Study Tip',
        important: 'Key Concept',
        warning: 'Exam Caution',
        caution: 'Important Caution',
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
 * Extracts LaTeX math outside fenced/inline code spans, renders via KaTeX callback,
 * and emits placeholder tokens for post-DOMPurify hydration.
 */
export function extractAndRenderMath(
  input: string,
  renderFn: (tex: string, displayMode: boolean) => string
): { text: string; mathMap: Record<string, string> } {
  const codeProtections: string[] = [];
  const mathMap: Record<string, string> = {};
  let mathCounter = 0;

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

  protectedText = protectedText.replace(
    /(?<!\\)\$\$([\s\S]+?)\$\$/g,
    (_m, expr: string) => registerMath(expr, true)
  );

  protectedText = protectedText.replace(
    /\\\[([\s\S]+?)\\\]/g,
    (_m, expr: string) => registerMath(expr, true)
  );

  protectedText = protectedText.replace(
    /\\\(([\s\S]+?)\\\)/g,
    (_m, expr: string) => registerMath(expr, false)
  );

  protectedText = protectedText.replace(
    /(?<!\\)(?<!\$)\$(?!\s|\$)((?:\\\$|[^$\n])+?)(?<!\s)(?<!\\)\$(?!\$)/g,
    (fullMatch, expr: string, offset: number, fullStr: string) => {
      const afterIdx = offset + fullMatch.length;
      const charAfter = fullStr[afterIdx] || '';
      if (/^\d/.test(expr) && /\d/.test(charAfter)) {
        return fullMatch;
      }
      if (/^\d[\d,.\s]*(?:and|or|to|per|for|of|in|is|was|were)\b/i.test(expr)) {
        return fullMatch;
      }
      return registerMath(expr, false);
    }
  );

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

function countWordsInText(raw: string): number {
  const cleaned = raw
    .replace(/@@ED_MATH_(?:BLOCK|INLINE)_math_\d+@@/g, ' formula ')
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

type MdToken = ReturnType<InstanceType<typeof MarkdownIt>['parse']>[number];

function extractCleanHeadingText(inlineTok: MdToken | undefined): string {
  if (!inlineTok) return 'Section';
  const fromChildren = inlineTok.children?.length
    ? inlineTok.children
        .map((child) => {
          if (child.type === 'text' || child.type === 'code_inline') {
            return child.content;
          }
          if (child.type === 'softbreak' || child.type === 'hardbreak') {
            return ' ';
          }
          return '';
        })
        .join('')
    : '';
  const raw = fromChildren.trim() ? fromChildren : inlineTok.content || '';
  return (
    raw
      .replace(/@@ED_MATH_(?:BLOCK|INLINE)_math_\d+@@/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Section'
  );
}

export interface BuildMarkdownChaptersOptions {
  rawMarkdown: string;
  bookTitle?: string;
  assetBaseUrl?: string;
  katexRender?: ((tex: string, displayMode: boolean) => string) | null;
  highlightCode?: ((code: string, lang: string) => string) | null;
}

export function buildMarkdownChapters({
  rawMarkdown,
  bookTitle,
  assetBaseUrl,
  katexRender,
  highlightCode,
}: BuildMarkdownChaptersOptions): ParsedMarkdownBook {
  const hasFencedCode = detectFencedCode(rawMarkdown);
  const processed = preprocessStudyMarkdown(rawMarkdown || '');

  let mdInput = processed;
  let mathMap: Record<string, string> = {};
  if (katexRender) {
    const extracted = extractAndRenderMath(processed, katexRender);
    mdInput = extracted.text;
    mathMap = extracted.mathMap;
  }

  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    breaks: true,
  });

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = (token.info || '').trim().split(/\s+/)[0] || '';
    const rawCode = token.content;
    const highlighted = highlightCode
      ? highlightCode(rawCode, info)
      : escapeHtml(rawCode);
    return `<div class="md-scroll-x"><pre><code class="hljs">${highlighted}</code></pre></div>`;
  };

  const defaultImgRule =
    md.renderer.rules.image ||
    ((tokens, idx, options, _env, selfRenderer) =>
      selfRenderer.renderToken(tokens, idx, options));

  md.renderer.rules.image = (tokens, idx, options, env, selfRenderer) => {
    const token = tokens[idx];
    const rawSrc = String(token.attrGet('src') || '');
    token.attrSet('src', resolveImageSrc(rawSrc, assetBaseUrl));
    token.attrSet('loading', 'lazy');
    token.attrSet('decoding', 'async');
    token.attrSet('referrerpolicy', 'no-referrer');
    token.attrSet('data-md-lightbox', 'true');
    return defaultImgRule(tokens, idx, options, env, selfRenderer);
  };

  const tokens = md.parse(mdInput, {});

  const seenSlugs = new Map<string, number>();
  const chapters: MarkdownChapterChunk[] = [];

  let currentTokens: MdToken[] = [];
  let currentTitle = bookTitle?.trim() || 'Introduction';
  let currentHeadingId = '';
  let currentHasH1 = false;
  let currentAnchorIds: string[] = [];
  let currentWordCount = 0;
  let currentStartBlock = 0;
  let currentEndBlock = 0;
  let currentFirstBlockId = '';

  let blockCounter = 0;
  let tableCounter = 0;
  let depth = 0;
  const hasMathEntries = Object.keys(mathMap).length > 0;

  const registerBlockNum = (num: number, idStr: string) => {
    if (currentStartBlock === 0) {
      currentStartBlock = num;
      currentFirstBlockId = idStr;
    }
    currentEndBlock = num;
  };

  const resetChapterAccumulator = (nextTitle: string) => {
    currentTokens = [];
    currentTitle = nextTitle;
    currentHeadingId = '';
    currentHasH1 = false;
    currentAnchorIds = [];
    currentWordCount = 0;
    currentStartBlock = 0;
    currentEndBlock = 0;
    currentFirstBlockId = '';
  };

  const flushCurrentChapter = () => {
    if (currentTokens.length === 0) return;

    let html = md.renderer.render(currentTokens, md.options, {});
    if (!html.trim()) {
      resetChapterAccumulator('Overview');
      return;
    }

    if (hasMathEntries) {
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

    html = html.replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
      tableCounter += 1;
      return `<div class="md-scroll-x" data-block-id="blk_tbl_${tableCounter}">${tableHtml}</div>`;
    });

    const chapterIndex = chapters.length;
    const chapterId = `ch_${chapterIndex + 1}`;
    const headingId =
      currentHeadingId || slugifyHeading(currentTitle || chapterId, seenSlugs);
    if (!currentAnchorIds.includes(headingId)) {
      currentAnchorIds.unshift(headingId);
    }

    const words = Math.max(1, currentWordCount);
    const estimatedReadMinutes = Math.max(1, Math.round(words / 220));

    chapters.push({
      chapterIndex,
      chapterId,
      headingId,
      title: currentTitle || `Chapter ${chapterIndex + 1}`,
      hasH1Heading: currentHasH1,
      rawHtml: html,
      firstBlockId: currentFirstBlockId || `blk_${currentStartBlock || 1}`,
      startBlockNum: currentStartBlock,
      endBlockNum: currentEndBlock,
      anchorIds: currentAnchorIds,
      subheadings: [],
      wordCount: words,
      estimatedReadMinutes,
    });

    resetChapterAccumulator(`Chapter ${chapters.length + 1}`);
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    // Split into a new chapter strictly at top-level `#` (H1) headings.
    // Any preamble tokens before the first H1 remain attached to Chapter 1 so no prose is lost
    // and every TOC entry corresponds strictly to an H1 heading from the file.
    if (
      depth === 0 &&
      tok.type === 'heading_open' &&
      tok.tag === 'h1' &&
      currentHasH1 &&
      currentTokens.length > 0
    ) {
      flushCurrentChapter();
    }

    if (tok.type === 'inline' || tok.type === 'fence' || tok.type === 'code_block') {
      currentWordCount += countWordsInText(tok.content || '');
    }

    if (depth === 0) {
      if (tok.type === 'heading_open') {
        const inlineTok = tokens[i + 1];
        const headingText = extractCleanHeadingText(inlineTok);
        const num = ++blockCounter;
        const blockId = `blk_${num}`;
        tok.attrSet('data-block-id', blockId);
        registerBlockNum(num, blockId);

        const slug = slugifyHeading(headingText, seenSlugs);
        tok.attrSet('id', slug);
        currentAnchorIds.push(slug);

        // Only top-level `#` (H1) headings populate chapter titles and the TOC menu;
        // lower headings (h2-h6) remain rendered in prose with anchor IDs but are ignored in TOC.
        if (tok.tag === 'h1') {
          currentTitle = headingText;
          currentHeadingId = slug;
          currentHasH1 = true;
        }
      } else if (
        tok.type === 'paragraph_open' ||
        tok.type === 'bullet_list_open' ||
        tok.type === 'ordered_list_open' ||
        tok.type === 'blockquote_open'
      ) {
        const num = ++blockCounter;
        const blockId = `blk_${num}`;
        tok.attrSet('data-block-id', blockId);
        registerBlockNum(num, blockId);
      } else if (tok.type === 'fence' || tok.type === 'code_block') {
        const num = ++blockCounter;
        registerBlockNum(num, `blk_${num}`);
      } else if (tok.type === 'html_block' && tok.content.trim()) {
        const num = ++blockCounter;
        const blockId = `blk_${num}`;
        tok.content = `<div data-block-id="${blockId}">${tok.content}</div>`;
        registerBlockNum(num, blockId);
      }
    }

    if (tok.nesting === 1) depth += 1;
    if (tok.nesting === -1) depth = Math.max(0, depth - 1);

    currentTokens.push(tok);
  }

  flushCurrentChapter();

  // Strictly include ONLY `#` (H1) headings extracted from the Markdown file in the TOC menu.
  const toc: MarkdownTocItem[] = chapters
    .filter((ch) => ch.hasH1Heading)
    .map((ch) => ({
      id: ch.headingId,
      text: ch.title,
      level: 1,
      chapterIndex: ch.chapterIndex,
      chapterId: ch.chapterId,
      blockId: ch.firstBlockId,
      wordCount: ch.wordCount,
      estimatedReadMinutes: ch.estimatedReadMinutes,
      subheadings: [],
    }));

  return {
    chapters,
    toc,
    mathMap,
    hasMath: hasMathEntries,
    hasFencedCode,
  };
}
