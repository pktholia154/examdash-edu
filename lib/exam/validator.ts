import katex from 'katex';
import 'katex/contrib/mhchem';
import type { MocktestTitleItem } from '../types/catalog';
import { CmsExamSetArraySchema, formatZodIssues } from '../validation/cms-ingestion';
import type { ExamSet, TableCellInput, VisualBlock } from './types';

export interface ExamPackValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  derivedMetadata: {
    totalMocktest: number;
    MocktestTitles: MocktestTitleItem[];
  };
}

function collectMathTokens(raw: string): Array<{ tex: string; display: boolean }> {
  const ESC_DOLLAR = '\uE000';
  const out: Array<{ tex: string; display: boolean }> = [];
  const codeStripped = raw
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .filter((seg) => !seg.startsWith('`'));

  for (const seg of codeStripped) {
    const safeSeg = seg.replace(/\\\$/g, ESC_DOLLAR);
    const parts = safeSeg.split(
      /(\$\$[\s\S]+?\$\$|\$(?!\s)(?:[^$\n]*?[^\s$\n])\$)/g
    );
    for (const token of parts) {
      if (token.startsWith('$$') && token.endsWith('$$') && token.length > 4) {
        out.push({
          tex: token.slice(2, -2).replaceAll(ESC_DOLLAR, '\\$'),
          display: true,
        });
      } else if (
        token.startsWith('$') &&
        token.endsWith('$') &&
        token.length >= 3
      ) {
        out.push({
          tex: token.slice(1, -1).replaceAll(ESC_DOLLAR, '\\$'),
          display: false,
        });
      }
    }
  }
  return out;
}

function checkLatexInText(
  text: unknown,
  location: string,
  errors: string[]
): void {
  if (typeof text !== 'string' || !text.includes('$')) return;
  const tokens = collectMathTokens(text);
  for (const t of tokens) {
    try {
      katex.renderToString(t.tex, {
        displayMode: t.display,
        throwOnError: true,
        strict: false,
      });
    } catch (err) {
      errors.push(
        `${location}: Invalid KaTeX math "$${t.tex}$" — ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

function checkVisualsAndPlaceholders(
  text: string | null | undefined,
  visuals: VisualBlock[] | undefined,
  location: string,
  errors: string[]
): void {
  checkLatexInText(text, location, errors);
  const safeVisuals = Array.isArray(visuals) ? visuals : [];
  const visualIds = new Set<string>();

  for (const v of safeVisuals) {
    if (!v || !v.id) {
      errors.push(`${location}: Visual block missing required 'id'.`);
      continue;
    }
    if (visualIds.has(v.id)) {
      errors.push(`${location}: Duplicate visual id '${v.id}'.`);
    }
    visualIds.add(v.id);
    checkLatexInText(v.title, `${location} visual(${v.id}).title`, errors);
    checkLatexInText(v.note, `${location} visual(${v.id}).note`, errors);

    if (v.type === 'table') {
      const checkCell = (cell: TableCellInput, cellLoc: string) => {
        if (cell && typeof cell === 'object' && 'text' in cell) {
          checkLatexInText(cell.text, cellLoc, errors);
        } else if (typeof cell === 'string') {
          checkLatexInText(cell, cellLoc, errors);
        }
      };
      if (Array.isArray(v.headers)) {
        v.headers.forEach((h, i) => {
          if (Array.isArray(h)) {
            h.forEach((c, j) =>
              checkCell(c, `${location} table(${v.id}).headers[${i}][${j}]`)
            );
          } else {
            checkCell(h as TableCellInput, `${location} table(${v.id}).headers[${i}]`);
          }
        });
      }
      if (Array.isArray(v.rows)) {
        v.rows.forEach((r, i) => {
          if (Array.isArray(r)) {
            r.forEach((c, j) =>
              checkCell(c, `${location} table(${v.id}).rows[${i}][${j}]`)
            );
          }
        });
      }
    }
  }

  if (typeof text === 'string') {
    const refs = text.matchAll(/\{\{([^{}]+)\}\}/g);
    for (const m of refs) {
      const refId = m[1];
      if (!visualIds.has(refId)) {
        errors.push(
          `${location}: Placeholder '{{${refId}}}' has no matching visual id in visuals[].`
        );
      }
    }
  }
}

/**
 * Deterministic Pillar 1 <-> Pillar 2 Zero-Drift Validator (Zero-AI Runtime).
 * Combines Zod structural ingestion validation with RFC 8259 checks, KaTeX expressions,
 * context/visual references, sectionalTiming durations, and maxAttempts top-K totalMarks.
 */
export function validateExamPack(rawSets: unknown): ExamPackValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const derivedTitles: MocktestTitleItem[] = [];

  if (!Array.isArray(rawSets) || rawSets.length === 0) {
    return {
      valid: false,
      errors: ['Root payload must be a non-empty ExamSet[] JSON array.'],
      warnings,
      derivedMetadata: { totalMocktest: 0, MocktestTitles: [] },
    };
  }

  const zodCheck = CmsExamSetArraySchema.safeParse(rawSets);
  if (!zodCheck.success) {
    for (const issue of formatZodIssues(zodCheck.error)) {
      errors.push(`Schema: ${issue}`);
    }
  }

  const seenSetIds = new Set<string>();

  rawSets.forEach((rawSet, setIdx) => {
    const setLoc = `ExamSet[${setIdx}]`;
    if (!rawSet || typeof rawSet !== 'object') {
      errors.push(`${setLoc}: Must be an object.`);
      return;
    }
    const exam = rawSet as ExamSet;
    if (!exam.id || typeof exam.id !== 'string') {
      errors.push(`${setLoc}: Missing string 'id'.`);
    } else if (seenSetIds.has(exam.id)) {
      errors.push(`${setLoc}: Duplicate ExamSet id '${exam.id}'.`);
    } else {
      seenSetIds.add(exam.id);
    }

    if (!Array.isArray(exam.sections) || exam.sections.length === 0) {
      errors.push(`${setLoc}(${exam.id}): Must contain at least one section.`);
      return;
    }

    let computedTotalQuestions = 0;
    let computedTotalMarks = 0;
    let computedSectionDurationSum = 0;

    exam.sections.forEach((sec, secIdx) => {
      const secLoc = `${setLoc}(${exam.id}).sections[${secIdx}](${sec.id})`;
      const questions = Array.isArray(sec.questions) ? sec.questions : [];

      if (sec.totalQuestions !== questions.length) {
        errors.push(
          `${secLoc}: section.totalQuestions (${sec.totalQuestions}) !== questions.length (${questions.length}).`
        );
      }
      computedTotalQuestions += questions.length;

      if (exam.sectionalTiming) {
        if (typeof sec.duration !== 'number' || sec.duration <= 0) {
          errors.push(
            `${secLoc}: sectionalTiming=true requires positive numeric section.duration.`
          );
        } else {
          computedSectionDurationSum += sec.duration;
        }
      }

      const sortedPositiveMarks = questions
        .map((q) => Number(q.marks?.correct ?? 0))
        .sort((a, b) => b - a);
      const cap = sec.maxAttempts ? Number(sec.maxAttempts) : null;
      computedTotalMarks += (
        cap ? sortedMarksSlice(sortedPositiveMarks, cap) : sortedPositiveMarks
      ).reduce((a, b) => a + b, 0);

      const contextIds = new Set<string>();
      for (const ctx of sec.contexts || []) {
        contextIds.add(ctx.id);
        checkVisualsAndPlaceholders(
          ctx.text,
          ctx.visuals,
          `${secLoc}.context(${ctx.id})`,
          errors
        );
        checkLatexInText(
          ctx.title,
          `${secLoc}.context(${ctx.id}).title`,
          errors
        );
      }

      for (const q of questions) {
        const qLoc = `${secLoc}.question(${q.id})`;
        for (const cid of q.contextIds || []) {
          if (!contextIds.has(cid)) {
            errors.push(
              `${qLoc}: References unknown contextId '${cid}' not in section.contexts.`
            );
          }
        }
        checkVisualsAndPlaceholders(q.prompt, q.visuals, `${qLoc}.prompt`, errors);
        checkVisualsAndPlaceholders(
          q.explanation,
          q.explanationVisuals,
          `${qLoc}.explanation`,
          errors
        );
        for (const opt of q.options || []) {
          checkVisualsAndPlaceholders(
            opt.text,
            opt.visuals,
            `${qLoc}.option(${opt.id})`,
            errors
          );
        }
      }
    });

    if (exam.totalQuestions !== computedTotalQuestions) {
      errors.push(
        `${setLoc}(${exam.id}): exam.totalQuestions (${exam.totalQuestions}) !== sum(section.totalQuestions) (${computedTotalQuestions}).`
      );
    }

    if (Math.abs(exam.totalMarks - computedTotalMarks) > 1e-6) {
      errors.push(
        `${setLoc}(${exam.id}): exam.totalMarks (${exam.totalMarks}) !== formula totalMarks (${computedTotalMarks}).`
      );
    }

    if (
      exam.sectionalTiming &&
      computedSectionDurationSum > 0 &&
      exam.duration !== computedSectionDurationSum
    ) {
      warnings.push(
        `${setLoc}(${exam.id}): exam.duration (${exam.duration}) differs from sum of section durations (${computedSectionDurationSum}).`
      );
    }

    derivedTitles.push({
      id: exam.id,
      title: exam.title,
      duration: exam.duration,
      totalQuestions: computedTotalQuestions,
      totalMarks: Number(computedTotalMarks.toFixed(2)),
    });
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    derivedMetadata: {
      totalMocktest: derivedTitles.length,
      MocktestTitles: derivedTitles,
    },
  };
}

function sortedMarksSlice(arr: number[], k: number): number[] {
  return arr.slice(0, Math.max(0, k));
}
