/// <reference lib="webworker" />

import {
  buildMarkdownChapters,
  detectFencedCode,
  detectMathTokens,
  escapeHtml,
  type MarkdownChapterChunk,
  type MarkdownSubheadingItem,
  type MarkdownTocItem,
} from '../../../lib/reader/markdown-chapters';

export type {
  MarkdownChapterChunk,
  MarkdownSubheadingItem,
  MarkdownTocItem,
};

export interface MarkdownWorkerRequest {
  type: 'PARSE_MARKDOWN';
  requestId: string;
  markdown: string;
  bookTitle?: string;
  assetBaseUrl?: string;
}

export interface MarkdownWorkerResponse {
  type: 'PARSE_SUCCESS';
  requestId: string;
  chapters: MarkdownChapterChunk[];
  toc: MarkdownTocItem[];
  mathMap: Record<string, string>;
  hasMath: boolean;
  hasFencedCode: boolean;
}

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<MarkdownWorkerRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'PARSE_MARKDOWN') return;

  const rawMarkdown = msg.markdown || '';
  const hasMath = detectMathTokens(rawMarkdown);
  const hasFencedCode = detectFencedCode(rawMarkdown);

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

  const parsed = buildMarkdownChapters({
    rawMarkdown,
    bookTitle: msg.bookTitle,
    assetBaseUrl: msg.assetBaseUrl,
    katexRender,
    highlightCode,
  });

  const response: MarkdownWorkerResponse = {
    type: 'PARSE_SUCCESS',
    requestId: msg.requestId,
    chapters: parsed.chapters,
    toc: parsed.toc,
    mathMap: parsed.mathMap,
    hasMath: parsed.hasMath,
    hasFencedCode: parsed.hasFencedCode,
  };

  workerScope.postMessage(response);
};
