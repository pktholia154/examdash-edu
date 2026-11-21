'use client';

import React, {
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import dynamic from 'next/dynamic';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/contrib/mhchem';
import {
  BookOpen,
  CheckCircle2,
  Expand,
  HelpCircle,
  Minus,
  Plus,
  RotateCcw,
  X,
  XCircle,
} from 'lucide-react';
import type {
  ExamContext,
  ExamQuestion,
  ExamSection,
  TableCellInput,
  TableCellObject,
  VisualBlock,
} from '../../lib/exam/types';
import {
  evaluateQuestion,
  hasActiveSlot,
  isQuestionLockedBySectionCap,
} from '../../lib/exam/grading';
import { isCapacitorNative } from '../../lib/platform/capacitor-bridge';
import { useTheme } from '../theme/theme-provider';
import { cn } from '../../lib/utils';

// Lazy-load Recharts ONLY when visual.type === 'chart' (keeps core CBT chunk tiny)
const LazyExamChartRenderer = dynamic(
  () => import('./exam-chart-renderer').then((m) => m.ExamChartRenderer),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 w-full rounded-lg ed-skeleton flex items-center justify-center text-xs text-[var(--text-muted)]">
        Loading chart telemetry...
      </div>
    ),
  }
);

let mermaidRenderSeq = 0;

// ============================================================================
// 1. DOMPURIFY SVG SANITIZER & OFFLINE IMAGE RESOLVER (Master Pillar 9)
// ============================================================================
export function sanitizeSvg(raw: string, allowForeignObject = false): string {
  if (typeof window === 'undefined') return '';
  return DOMPurify.sanitize(String(raw || ''), {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: allowForeignObject ? ['foreignObject'] : [],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'animate', 'set'],
  });
}

function resolveExamImageSrc(src: string): string {
  if (!src) return '';
  if (
    isCapacitorNative() &&
    typeof window !== 'undefined' &&
    src.startsWith('file://')
  ) {
    const cap = (
      window as unknown as {
        Capacitor?: { convertFileSrc?: (p: string) => string };
      }
    ).Capacitor;
    if (cap?.convertFileSrc) {
      return cap.convertFileSrc(src);
    }
  }
  return src;
}

// ============================================================================
// 2. CODE + LATEX (\ce) + FORMATTED MARKDOWN RENDERER
// ============================================================================
const ESC_DOLLAR = '\uE000';

function renderFormattedText(
  plain: string,
  keyPrefix: string
): React.ReactNode {
  const restored = plain.replaceAll(ESC_DOLLAR, '$');
  const tokens = restored.split(
    /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|\*(?!\s)(?:[^*\n]*?[^\s*\n])?\*)/g
  );

  return tokens.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong
          key={`${keyPrefix}-b-${idx}`}
          className="font-semibold text-[var(--text-main)]"
        >
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('__') && part.endsWith('__') && part.length > 4) {
      return (
        <u
          key={`${keyPrefix}-u-${idx}`}
          className="underline decoration-[var(--text-main)] decoration-2 underline-offset-4"
        >
          {part.slice(2, -2)}
        </u>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={`${keyPrefix}-i-${idx}`} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part.split('\n').map((line, lIdx, arr) => (
      <React.Fragment key={`${keyPrefix}-l-${idx}-${lIdx}`}>
        {line}
        {lIdx < arr.length - 1 && <br />}
      </React.Fragment>
    ));
  });
}

export function defaultRenderLatex(input: unknown): React.ReactNode {
  if (input === null || input === undefined || input === '') return null;
  const raw = String(input);

  const codeParts = raw.split(/(```[\s\S]*?```|`[^`\n]+`)/g);

  return codeParts.map((seg, cIdx) => {
    if (seg.startsWith('```') && seg.endsWith('```') && seg.length >= 6) {
      const code = seg.slice(3, -3).replace(/^[a-zA-Z0-9_+-]*\r?\n/, '');
      return (
        <pre
          key={`cb-${cIdx}`}
          className="my-2 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100"
        >
          <code>{code}</code>
        </pre>
      );
    }
    if (seg.startsWith('`') && seg.endsWith('`') && seg.length >= 2) {
      return (
        <code
          key={`ic-${cIdx}`}
          className="rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-xs font-medium text-[var(--text-main)]"
        >
          {seg.slice(1, -1)}
        </code>
      );
    }

    const safeSeg = seg.replace(/\\\$/g, ESC_DOLLAR);
    const mathParts = safeSeg.split(
      /(\$\$[\s\S]+?\$\$|\$(?!\s)(?:[^$\n]*?[^\s$\n])\$)/g
    );

    return (
      <React.Fragment key={`seg-${cIdx}`}>
        {mathParts.map((mToken, mIdx) => {
          if (
            mToken.startsWith('$$') &&
            mToken.endsWith('$$') &&
            mToken.length > 4
          ) {
            const tex = mToken.slice(2, -2).replaceAll(ESC_DOLLAR, '\\$');
            const html = katex.renderToString(tex, {
              displayMode: true,
              throwOnError: false,
              strict: false,
            });
            return (
              <span
                key={`dm-${mIdx}`}
                className="my-2 block overflow-x-auto"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          }
          if (
            mToken.startsWith('$') &&
            mToken.endsWith('$') &&
            mToken.length >= 3
          ) {
            const tex = mToken.slice(1, -1).replaceAll(ESC_DOLLAR, '\\$');
            const html = katex.renderToString(tex, {
              displayMode: false,
              throwOnError: false,
              strict: false,
            });
            return (
              <span
                key={`im-${mIdx}`}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          }
          return renderFormattedText(mToken, `${cIdx}-${mIdx}`);
        })}
      </React.Fragment>
    );
  });
}

// ============================================================================
// 3. THEME-AWARE DIAGRAM MOUNT (Mermaid FSM & SMILES Organic Chemistry)
// ============================================================================
function DeclarativeDiagramMount({
  type,
  data,
}: {
  type: 'smiles' | 'mermaid';
  data: string;
}) {
  const { theme } = useTheme();
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, '_');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [mermaidSvg, setMermaidSvg] = useState<string>('');
  const [smilesError, setSmilesError] = useState<boolean>(false);

  useEffect(() => {
    let active = true;

    if (type === 'mermaid' && data) {
      import('mermaid')
        .then(async (m) => {
          const mermaid = m.default;
          mermaid.initialize({
            startOnLoad: false,
            suppressErrorRendering: true,
            theme: theme === 'dark' ? 'dark' : 'neutral',
            securityLevel: 'strict',
            flowchart: { htmlLabels: false },
          });
          const renderId = `mmd_${baseId}_${++mermaidRenderSeq}`;
          const { svg } = await mermaid.render(renderId, String(data));
          if (active) setMermaidSvg(sanitizeSvg(svg, true));
        })
        .catch(() => {
          if (active) setMermaidSvg('');
        });
    } else if (type === 'smiles' && data && svgRef.current) {
      const smilesTheme = theme === 'dark' ? 'dark' : 'light';
      const svgEl = svgRef.current;
      svgEl.innerHTML = '';
      import('smiles-drawer')
        .then((mod) => {
          const SD = (mod as unknown as { default?: typeof mod }).default || mod;
          if (!active || !svgRef.current) return;
          if (SD.SmiDrawer) {
            const smiDrawer = new SD.SmiDrawer({ width: 260, height: 160 });
            smiDrawer.draw(
              String(data),
              svgRef.current,
              smilesTheme,
              undefined,
              () => {
                if (active) setSmilesError(true);
              }
            );
          } else if (SD.SvgDrawer && SD.parse) {
            const drawer = new SD.SvgDrawer({ width: 260, height: 160 });
            SD.parse(
              String(data),
              (tree: unknown) => {
                if (active && svgRef.current) {
                  svgRef.current.innerHTML = '';
                  drawer.draw(tree, svgRef.current, smilesTheme);
                }
              },
              () => {
                if (active) setSmilesError(true);
              }
            );
          }
        })
        .catch(() => {
          if (active) setSmilesError(true);
        });
    }

    return () => {
      active = false;
    };
  }, [type, data, baseId, theme]);

  if (type === 'mermaid') {
    return mermaidSvg ? (
      <div
        className="flex justify-center overflow-x-auto py-2 [&>svg]:h-auto [&>svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: mermaidSvg }}
      />
    ) : (
      <pre className="overflow-x-auto rounded bg-[var(--bg-elevated)] p-2 text-xs text-[var(--text-muted)]">
        {data}
      </pre>
    );
  }

  if (smilesError) {
    return (
      <code className="block rounded bg-[var(--bg-elevated)] p-2 text-xs text-[var(--text-main)]">
        {data}
      </code>
    );
  }

  return (
    <div className="flex justify-center overflow-x-auto py-1">
      <svg
        ref={svgRef}
        viewBox="0 0 260 160"
        className="h-auto max-h-40 w-full max-w-[260px]"
      />
    </div>
  );
}

// ============================================================================
// 4. VISUAL CARD + TAP-TO-ZOOM 2D PAN LIGHTBOX
// ============================================================================
function normalizeCell(cell: TableCellInput): TableCellObject {
  if (cell !== null && typeof cell === 'object' && 'text' in cell) return cell;
  return { text: cell === null || cell === undefined ? '' : String(cell) };
}

function VisualBodyContent({
  visual,
  renderLatex,
  expanded = false,
}: {
  visual: VisualBlock;
  renderLatex: (txt: unknown) => React.ReactNode;
  expanded?: boolean;
}) {
  const { theme } = useTheme();
  const headerRows: TableCellInput[][] =
    visual.type === 'table' &&
    Array.isArray(visual.headers) &&
    visual.headers.length > 0
      ? Array.isArray(visual.headers[0])
        ? (visual.headers as TableCellInput[][])
        : [visual.headers as TableCellInput[]]
      : [];

  return (
    <>
      {visual.type === 'chart' && Array.isArray(visual.data) && (
        <LazyExamChartRenderer
          visual={visual}
          heightClass={expanded ? 'h-[62svh]' : 'h-72'}
        />
      )}

      {visual.type === 'table' && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-start text-sm tabular-nums">
            {headerRows.length > 0 && (
              <thead>
                {headerRows.map((hRow, rIdx) => (
                  <tr key={rIdx} className="bg-[var(--bg-elevated)]">
                    {hRow.map((rawCell, cIdx) => {
                      const c = normalizeCell(rawCell);
                      const alignCls =
                        c.align === 'center'
                          ? 'text-center'
                          : c.align === 'right'
                          ? 'text-end'
                          : 'text-start';
                      return (
                        <th
                          key={cIdx}
                          colSpan={c.colSpan}
                          rowSpan={c.rowSpan}
                          className={`border border-[var(--border-strong)] px-3 py-2 font-semibold text-[var(--text-main)] ${alignCls}`}
                        >
                          {renderLatex(c.text)}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
            )}
            <tbody>
              {(visual.rows || []).map((row, rIdx) => (
                <tr key={rIdx} className="even:bg-[var(--bg-canvas)]">
                  {(row || []).map((rawCell, cIdx) => {
                    const c = normalizeCell(rawCell);
                    const alignCls =
                      c.align === 'center'
                        ? 'text-center'
                        : c.align === 'right'
                        ? 'text-end'
                        : 'text-start';
                    return (
                      <td
                        key={cIdx}
                        colSpan={c.colSpan}
                        rowSpan={c.rowSpan}
                        className={`border border-[var(--border-subtle)] px-3 py-2 text-[var(--text-main)] ${alignCls}`}
                      >
                        {renderLatex(c.text)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {visual.type === 'svg' && visual.data && (
        <div
          className={cn(
            'overflow-x-auto py-2 [&>svg]:mx-auto [&>svg]:block [&>svg]:h-auto [&>svg]:w-full',
            expanded ? '[&>svg]:max-w-4xl' : '[&>svg]:max-h-80 [&>svg]:max-w-xl',
            theme === 'dark' &&
              'rounded-lg bg-slate-100 p-2 text-slate-900'
          )}
          dangerouslySetInnerHTML={{ __html: sanitizeSvg(visual.data, false) }}
        />
      )}

      {(visual.type === 'smiles' || visual.type === 'mermaid') &&
        visual.data && (
          <DeclarativeDiagramMount
            type={visual.type}
            data={String(visual.data)}
          />
        )}

      {visual.type === 'image' && visual.data && (
        <div className="flex justify-center py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolveExamImageSrc(visual.data)}
            alt={visual.alt || visual.title || 'Exam diagram'}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className={cn(
              'w-auto rounded-lg object-contain',
              expanded ? 'max-h-[70svh]' : 'max-h-80'
            )}
          />
        </div>
      )}
    </>
  );
}

export const SingleVisualCard = memo(function SingleVisualCard({
  visual,
  renderLatex = defaultRenderLatex,
  allowExpand = true,
}: {
  visual: VisualBlock;
  renderLatex?: (txt: unknown) => React.ReactNode;
  allowExpand?: boolean;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setLightboxOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxOpen]);

  if (!visual || typeof visual !== 'object') return null;

  return (
    <>
      <div className="my-2.5 min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5">
        {(visual.title || allowExpand) && (
          <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
            <h4 className="text-sm font-bold text-[var(--text-main)] min-w-0">
              {visual.title ? renderLatex(visual.title) : 'Diagram / Data View'}
            </h4>
            {allowExpand && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setZoom(1);
                  setLightboxOpen(true);
                }}
                aria-label={`Expand ${visual.title || visual.type}`}
                className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap shrink-0"
              >
                <Expand className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Expand</span>
              </button>
            )}
          </div>
        )}

        <VisualBodyContent visual={visual} renderLatex={renderLatex} />

        {visual.note && (
          <div className="mt-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--text-main)]">
            {renderLatex(visual.note)}
          </div>
        )}
      </div>

      {lightboxOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={visual.title || 'Expanded visual viewer'}
          onClick={(e) => e.stopPropagation()}
          className="fixed inset-0 z-50 h-[100dvh] w-screen bg-slate-950/95 text-slate-100 flex flex-col"
        >
          <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-slate-800 shrink-0">
            <p className="text-sm font-semibold truncate">
              {visual.title || 'Expanded Exam Visual'}
            </p>
            <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
              <button
                type="button"
                onClick={() =>
                  setZoom((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100))
                }
                aria-label="Zoom out visual"
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800"
              >
                <Minus className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                aria-label="Reset visual zoom"
                className="inline-flex items-center justify-center gap-1 min-h-[44px] px-3 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-semibold"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{Math.round(zoom * 100)}%</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))
                }
                aria-label="Zoom in visual"
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                aria-label="Close expanded visual"
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 ms-1"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div
            className="flex-1 overflow-auto overscroll-contain p-4 sm:p-8"
            style={{ touchAction: 'pan-x pan-y' }}
          >
            <div
              className="mx-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-main)] p-4 sm:p-6 transition-transform duration-150 origin-top-left"
              style={{ width: `${Math.max(100, Math.round(zoom * 100))}%` }}
            >
              <VisualBodyContent
                visual={visual}
                renderLatex={renderLatex}
                expanded
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
});

// ============================================================================
// 5. MULTI-VISUAL CONTENT BLOCK (Safe Dynamic {{id}} Interleaving + Fallback)
// ============================================================================
export function MultiVisualContentBlock({
  text,
  visuals = [],
  renderLatex = defaultRenderLatex,
  allowExpand = true,
}: {
  text?: string | null;
  visuals?: VisualBlock[] | null;
  renderLatex?: (txt: unknown) => React.ReactNode;
  allowExpand?: boolean;
}) {
  const safeVisuals = Array.isArray(visuals) ? visuals.filter(Boolean) : [];
  const visualMap = new Map(safeVisuals.map((v) => [v.id, v]));
  const renderedIds = new Set<string>();

  let parts: string[] = text ? [String(text)] : [];
  if (text && visualMap.size > 0) {
    const escapedIds = Array.from(visualMap.keys()).map((id) =>
      id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    const splitRegex = new RegExp(`(\\{\\{(?:${escapedIds.join('|')})\\}\\})`, 'g');
    parts = String(text).split(splitRegex);
  }

  return (
    <div className="space-y-2.5">
      {parts.map((part, idx) => {
        const match = part.match(/^\{\{(.+)\}\}$/);
        if (match && visualMap.has(match[1])) {
          const target = visualMap.get(match[1])!;
          renderedIds.add(target.id);
          return (
            <SingleVisualCard
              key={`v-${idx}`}
              visual={target}
              renderLatex={renderLatex}
              allowExpand={allowExpand}
            />
          );
        }
        const trimmed = part.replace(/^\r?\n+|\r?\n+$/g, '');
        return trimmed ? (
          <div
            key={`t-${idx}`}
            className="leading-relaxed text-[var(--text-main)] text-start"
          >
            {renderLatex(trimmed)}
          </div>
        ) : null;
      })}

      {safeVisuals
        .filter((v) => !renderedIds.has(v.id))
        .map((v, idx) => (
          <SingleVisualCard
            key={v.id || `rem-${idx}`}
            visual={v}
            renderLatex={renderLatex}
            allowExpand={allowExpand}
          />
        ))}
    </div>
  );
}

// ============================================================================
// 6. COARSE-POINTER ERGONOMICS & QUESTION RESPONSE BLOCK
// ============================================================================
function subscribeCoarsePointer(cb: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(pointer: coarse)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function getCoarsePointerSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

function useIsCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarsePointer,
    getCoarsePointerSnapshot,
    () => false
  );
}

export function QuestionResponseBlock({
  question,
  userAnswer,
  onChange,
  mode = 'exam',
  isAttemptCapReached = false,
  showVirtualKeypad = true,
  renderLatex = defaultRenderLatex,
}: {
  question: ExamQuestion;
  userAnswer: unknown;
  onChange: (val: unknown) => void;
  mode?: 'exam' | 'review';
  isAttemptCapReached?: boolean;
  showVirtualKeypad?: boolean;
  renderLatex?: (txt: unknown) => React.ReactNode;
}) {
  const isCoarsePointer = useIsCoarsePointer();
  const natInputId = useId();
  const isReview = mode === 'review';
  const isLocked =
    isReview || (isAttemptCapReached && !hasActiveSlot(question, userAnswer));

  if (question.type === 'NAT') {
    const valStr =
      userAnswer !== null && userAnswer !== undefined ? String(userAnswer) : '';
    const range = Array.isArray(question.answer)
      ? question.answer
      : [question.answer, question.answer];
    const suppressNativeKeyboard = isCoarsePointer && showVirtualKeypad;

    const handleNumericInput = (next: string) => {
      if (isLocked) return;
      if (next === '' || /^-?\d*\.?\d*$/.test(next)) onChange(next);
    };

    const handleKeyPress = (key: string) => {
      if (isLocked) return;
      if (key === 'CLEAR') return onChange('');
      if (key === 'BACKSPACE') return onChange(valStr.slice(0, -1));
      if (key === '-')
        return onChange(valStr.startsWith('-') ? valStr.slice(1) : '-' + valStr);
      if (key === '.' && valStr.includes('.')) return;
      handleNumericInput(valStr + key);
    };

    return (
      <div className="mt-4 space-y-3">
        {!isReview && isLocked && (
          <div className="rounded-lg border border-[var(--status-warning)] bg-[var(--status-warning-bg)] p-3 text-xs font-medium text-[var(--text-main)]">
            Section attempt limit reached. Clear an existing response in this section to attempt this question.
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3 tabular-nums">
          <div>
            <label
              htmlFor={natInputId}
              className="mb-1.5 block text-xs font-semibold text-[var(--text-muted)]"
            >
              Numerical Answer (NAT / TITA)
            </label>
            <input
              id={natInputId}
              type="text"
              inputMode={suppressNativeKeyboard ? 'none' : 'decimal'}
              readOnly={suppressNativeKeyboard}
              disabled={isLocked}
              value={valStr}
              onChange={(e) => handleNumericInput(e.target.value)}
              placeholder={isReview ? 'Unattempted' : 'Enter numerical value'}
              className="min-h-12 w-64 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-3.5 py-2.5 text-base font-semibold text-[var(--text-main)] tabular-nums focus:border-[var(--brand-primary)] focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] disabled:opacity-70"
            />
          </div>
          {isReview && (
            <div className="min-h-12 inline-flex items-center rounded-lg border border-[var(--status-success)] bg-[var(--status-success-bg)] px-3.5 py-2 text-xs font-semibold text-[var(--text-main)]">
              Accepted Answer:{' '}
              {Number(range[0]) === Number(range[1])
                ? range[0]
                : `${range[0]} to ${range[1]}`}
            </div>
          )}
        </div>

        {!isReview && showVirtualKeypad && !isLocked && (
          <div
            aria-label="Virtual numerical keypad"
            className="inline-grid grid-cols-4 gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5 tabular-nums chrome-no-select"
          >
            {[
              '7',
              '8',
              '9',
              'BACKSPACE',
              '4',
              '5',
              '6',
              '-',
              '1',
              '2',
              '3',
              '.',
              '0',
              'CLEAR',
            ].map((k) => (
              <button
                key={k}
                type="button"
                aria-label={
                  k === 'BACKSPACE'
                    ? 'Backspace'
                    : k === 'CLEAR'
                    ? 'Clear numerical input'
                    : `Digit ${k}`
                }
                onClick={() => handleKeyPress(k)}
                className={cn(
                  'min-h-11 sm:min-h-12 min-w-12 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-sm font-bold text-[var(--text-main)] hover:bg-[var(--bg-canvas)] active:scale-[0.98] transition-transform',
                  k === '0' && 'col-span-2',
                  k === 'CLEAR' &&
                    'col-span-2 text-[var(--status-danger)] text-xs',
                  k === 'BACKSPACE' && 'text-[var(--status-danger)] text-xs'
                )}
              >
                {k === 'BACKSPACE' ? '⌫' : k}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const isMSQ = question.type === 'MSQ';
  const selectedSet = new Set(
    isMSQ
      ? Array.isArray(userAnswer)
        ? userAnswer.map(String)
        : []
      : userAnswer
      ? [String(userAnswer)]
      : []
  );
  const correctSet = new Set(
    isMSQ
      ? Array.isArray(question.answer)
        ? question.answer.map(String)
        : []
      : [String(question.answer)]
  );

  return (
    <div
      className="mt-4 space-y-2.5"
      role={isMSQ ? 'group' : 'radiogroup'}
      aria-label={isMSQ ? 'Multiple select options' : 'Single choice options'}
    >
      {!isReview && isLocked && (
        <div className="rounded-lg border border-[var(--status-warning)] bg-[var(--status-warning-bg)] p-3 text-xs font-medium text-[var(--text-main)]">
          Section attempt limit reached. Clear an existing response in this section to attempt this question.
        </div>
      )}

      {(question.options || []).map((opt) => {
        const isSelected = selectedSet.has(opt.id);
        const isCorrectOpt = correctSet.has(opt.id);

        const toggleOption = () => {
          if (isLocked) return;
          if (!isMSQ) {
            onChange(isSelected ? null : opt.id);
          } else {
            const next = isSelected
              ? Array.from(selectedSet).filter((id) => id !== opt.id)
              : Array.from(new Set([...selectedSet, opt.id])).sort();
            onChange(next);
          }
        };

        let cardCls =
          'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]/50';
        let badgeCls =
          'border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--text-main)]';
        let statusTag: React.ReactNode = null;

        if (isReview) {
          if (isCorrectOpt && isSelected) {
            cardCls =
              'border-[var(--status-success)] bg-[var(--status-success-bg)] ring-1 ring-[var(--status-success)]';
            badgeCls =
              'border-[var(--status-success)] bg-[var(--status-success)] text-white';
            statusTag = (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--status-success)] shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Correct Selection</span>
              </span>
            );
          } else if (isCorrectOpt && !isSelected) {
            cardCls =
              'border-dashed border-[var(--status-success)] bg-[var(--status-success-bg)]/60';
            badgeCls =
              'border-[var(--status-success)] text-[var(--status-success)]';
            statusTag = (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--status-success)] shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Correct Key</span>
              </span>
            );
          } else if (!isCorrectOpt && isSelected) {
            cardCls =
              'border-[var(--status-danger)] bg-[var(--status-danger-bg)] ring-1 ring-[var(--status-danger)]';
            badgeCls =
              'border-[var(--status-danger)] bg-[var(--status-danger)] text-white';
            statusTag = (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--status-danger)] shrink-0">
                <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Incorrect Selection</span>
              </span>
            );
          }
        } else if (isSelected) {
          cardCls =
            'border-blue-600 dark:border-blue-400 bg-blue-50/70 dark:bg-blue-950/40 ring-1 ring-blue-600 dark:ring-blue-400';
          badgeCls = 'border-blue-600 bg-blue-600 text-white';
        }

        return (
          <button
            key={opt.id}
            type="button"
            role={isMSQ ? 'checkbox' : 'radio'}
            aria-checked={isSelected}
            disabled={isLocked}
            onClick={toggleOption}
            className={cn(
              'flex w-full min-h-12 items-start gap-3 rounded-xl border p-3.5 text-start transition-colors select-none',
              cardCls,
              isLocked && 'cursor-default opacity-95'
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold tabular-nums',
                badgeCls
              )}
            >
              {opt.id}
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <MultiVisualContentBlock
                text={opt.text}
                visuals={opt.visuals}
                renderLatex={renderLatex}
                allowExpand={false}
              />
            </div>
            {statusTag}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// 7. UNIFIED SPLIT-PANE MULTI-CONTEXT WORKSPACE + MOBILE CASELET SWITCHER
// ============================================================================
export const ExamQuestionWorkspace = memo(function ExamQuestionWorkspace({
  section,
  question,
  questionNumber,
  sectionResponses,
  onChange,
  mode = 'exam',
  showVirtualKeypad = true,
  renderLatex = defaultRenderLatex,
}: {
  section: ExamSection;
  question: ExamQuestion;
  questionNumber?: number;
  sectionResponses: Record<string, unknown>;
  onChange: (questionId: string, nextAnswer: unknown) => void;
  mode?: 'exam' | 'review';
  showVirtualKeypad?: boolean;
  renderLatex?: (txt: unknown) => React.ReactNode;
}) {
  const [mobileCaseletQuestionId, setMobileCaseletQuestionId] = useState<
    string | null
  >(null);
  const mobilePane: 'caselet' | 'question' =
    mobileCaseletQuestionId === question.id ? 'caselet' : 'question';

  const resolvedContexts = (question.contextIds || [])
    .map((cid) => (section.contexts || []).find((c) => c.id === cid))
    .filter((c): c is ExamContext => Boolean(c));

  const userAnswer = sectionResponses[question.id];
  const capLocked = isQuestionLockedBySectionCap(
    section,
    question.id,
    sectionResponses
  );
  const evaluation =
    mode === 'review' ? evaluateQuestion(question, userAnswer) : null;

  const handleAnswerChange = useCallback(
    (val: unknown) => {
      onChange(question.id, val);
    },
    [onChange, question.id]
  );

  const typeLabel =
    question.type === 'MSQ'
      ? 'MSQ · Multiple Correct'
      : question.type === 'NAT'
      ? 'NAT · Numerical Value'
      : 'MCQ · Single Choice';

  return (
    <div className="space-y-3">
      {/* Mobile Sticky Caselet / Question Switcher (< lg viewports) */}
      {resolvedContexts.length > 0 && mode === 'exam' && (
        <div className="lg:hidden sticky top-0 z-20 flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shadow-xs">
          <button
            type="button"
            onClick={() => setMobileCaseletQuestionId(question.id)}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-1.5 min-h-[42px] px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap',
              mobilePane === 'caselet'
                ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            )}
          >
            <BookOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Caselet / Passage ({resolvedContexts.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileCaseletQuestionId(null)}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-1.5 min-h-[42px] px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap',
              mobilePane === 'question'
                ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            )}
          >
            <HelpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              Question {questionNumber !== undefined ? `#${questionNumber}` : ''}
            </span>
          </button>
        </div>
      )}

      <div
        className={cn(
          'grid gap-5 items-start',
          resolvedContexts.length > 0
            ? 'lg:grid-cols-12'
            : 'mx-auto max-w-4xl grid-cols-1'
        )}
      >
        {resolvedContexts.length > 0 && (
          <div
            className={cn(
              'space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 lg:col-span-6',
              mode === 'exam' && mobilePane === 'question' && 'hidden lg:block'
            )}
          >
            {resolvedContexts.map((ctx, idx) => (
              <div
                key={ctx.id}
                className={
                  idx > 0
                    ? 'border-t border-[var(--border-subtle)] pt-4'
                    : ''
                }
              >
                {ctx.title && (
                  <p className="mb-2 text-xs font-bold text-[var(--text-muted)]">
                    {renderLatex(ctx.title)}
                  </p>
                )}
                <MultiVisualContentBlock
                  text={ctx.text}
                  visuals={ctx.visuals}
                  renderLatex={renderLatex}
                />
              </div>
            ))}
          </div>
        )}

        <div
          className={cn(
            'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5',
            resolvedContexts.length > 0 && 'lg:col-span-6',
            resolvedContexts.length > 0 &&
              mode === 'exam' &&
              mobilePane === 'caselet' &&
              'hidden lg:block'
          )}
        >
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5 tabular-nums">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
              {questionNumber !== undefined && (
                <span className="font-extrabold text-sm text-[var(--text-main)]">
                  Question {questionNumber}
                </span>
              )}
              <span aria-hidden="true">·</span>
              <span>{typeLabel}</span>
            </div>

            <div className="flex items-center gap-2 text-xs font-semibold tabular-nums">
              <span className="text-[var(--status-success)]">
                Correct: +{question.marks.correct}
              </span>
              <span aria-hidden="true" className="text-[var(--text-muted)]">
                ·
              </span>
              <span className="text-[var(--status-danger)]">
                Wrong:{' '}
                {question.marks.wrong === 0
                  ? '0'
                  : -Math.abs(Number(question.marks.wrong.toFixed(2)))}
              </span>
              {question.marks.partial > 0 && (
                <>
                  <span aria-hidden="true" className="text-[var(--text-muted)]">
                    ·
                  </span>
                  <span className="text-[var(--status-warning)]">
                    Partial: +{question.marks.partial}
                  </span>
                </>
              )}
            </div>
          </div>

          <MultiVisualContentBlock
            text={question.prompt}
            visuals={question.visuals}
            renderLatex={renderLatex}
          />

          <QuestionResponseBlock
            question={question}
            userAnswer={userAnswer}
            onChange={handleAnswerChange}
            mode={mode}
            isAttemptCapReached={capLocked}
            showVirtualKeypad={showVirtualKeypad}
            renderLatex={renderLatex}
          />

          {mode === 'review' && evaluation && (
            <div className="mt-5 space-y-3 border-t border-[var(--border-subtle)] pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-2.5 text-xs font-bold tabular-nums">
                <span>Result Status: {evaluation.status}</span>
                <span
                  className={cn(
                    evaluation.marksAwarded > 0
                      ? 'text-[var(--status-success)]'
                      : evaluation.marksAwarded < 0
                      ? 'text-[var(--status-danger)]'
                      : 'text-[var(--text-muted)]'
                  )}
                >
                  Marks Awarded:{' '}
                  {evaluation.marksAwarded > 0 ? '+' : ''}
                  {Number(evaluation.marksAwarded.toFixed(2))}
                </span>
              </div>

              {(question.explanation ||
                (question.explanationVisuals &&
                  question.explanationVisuals.length > 0)) && (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 text-sm">
                  <p className="mb-2 text-xs font-bold text-[var(--text-muted)]">
                    Step-by-Step Official Explanation
                  </p>
                  <MultiVisualContentBlock
                    text={question.explanation}
                    visuals={question.explanationVisuals}
                    renderLatex={renderLatex}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
