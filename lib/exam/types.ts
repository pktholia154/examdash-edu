// ============================================================================
// STRICT PILLAR 2 & INDIAN CBT ENGINE CONTRACTS (100% Schema-Exact)
// ============================================================================

export type TableCellObject = {
  text: string;
  colSpan?: number;
  rowSpan?: number;
  align?: 'left' | 'center' | 'right';
};

export type TableCellInput = string | number | TableCellObject;

export type VisualBlock =
  | {
      id: string;
      type: 'chart';
      chartType:
        | 'bar'
        | 'stacked_bar'
        | 'line'
        | 'area'
        | 'scatter'
        | 'combo'
        | 'pie'
        | 'radar';
      title?: string | null;
      note?: string | null;
      xAxisKey: string;
      xAxisLabel?: string;
      yAxisLabel?: string;
      rightYAxisLabel?: string;
      series: Array<{
        key: string;
        label: string;
        type?: 'bar' | 'line' | 'area' | 'scatter';
        yAxis?: 'left' | 'right';
      }>;
      data: Array<Record<string, string | number>>;
    }
  | {
      id: string;
      type: 'table';
      title?: string | null;
      note?: string | null;
      headers?: TableCellInput[] | TableCellInput[][];
      rows: TableCellInput[][];
    }
  | {
      id: string;
      type: 'svg' | 'mermaid' | 'smiles' | 'image';
      title?: string | null;
      note?: string | null;
      data: string;
      alt?: string;
    };

export interface ExamContext {
  id: string;
  title?: string | null;
  text: string;
  visuals: VisualBlock[];
}

export interface ExamOption {
  id: string;
  text: string;
  visuals: VisualBlock[];
}

export interface ExamQuestion {
  id: string;
  contextIds: string[];
  type: 'MCQ' | 'MSQ' | 'NAT';
  marks: { correct: number; wrong: number; partial: number };
  prompt: string;
  visuals: VisualBlock[];
  options: ExamOption[];
  answer: string | string[] | [number, number];
  explanation: string;
  explanationVisuals: VisualBlock[];
}

export interface ExamSection {
  id: string;
  title: string;
  duration: number | null;
  totalQuestions: number;
  maxAttempts: number | null;
  contexts: ExamContext[];
  questions: ExamQuestion[];
}

export interface ExamSet {
  id: string;
  title: string;
  duration: number;
  totalQuestions: number;
  totalMarks: number;
  sectionalTiming: boolean;
  calculator: 'none' | 'basic' | 'scientific';
  sections: ExamSection[];
}

export interface QuestionEvaluation {
  status: 'UNATTEMPTED' | 'CORRECT' | 'PARTIAL' | 'WRONG';
  marksAwarded: number;
  ignoredByCap?: boolean;
}

export interface ExamEvaluationResult {
  totalScore: number;
  maxScore: number;
  sectionResults: Record<
    string,
    {
      score: number;
      attempted: number;
      correct: number;
      partial: number;
      wrong: number;
      unattempted: number;
    }
  >;
  questionResults: Record<string, QuestionEvaluation>;
}

// ============================================================================
// INDIAN CBT (TCS iON / THINK EXAM) STATE & ANALYTICS CONTRACTS
// ============================================================================

export type CbtPaletteStatus =
  | 'NOT_VISITED'
  | 'NOT_ANSWERED'
  | 'ANSWERED'
  | 'MARKED_FOR_REVIEW'
  | 'ANSWERED_AND_MARKED';

export interface QuestionTelemetry {
  timeSpentMs: number;
  visits: number;
}

export interface PersistedExamSession {
  schemaVersion: 1;
  packId: string;
  examSlug: string;
  setId: string;
  mode: 'trial' | 'full';
  status: 'in_progress' | 'submitted';
  startedAtEpochMs: number;
  targetEndEpochMs: number;
  /** Map of sectionId -> targetEndEpochMs when sectionalTiming === true */
  sectionEndEpochMs: Record<string, number>;
  lockedSectionIds: string[];
  activeSectionId: string;
  activeQuestionId: string;
  responses: Record<string, unknown>;
  markedForReview: Record<string, boolean>;
  visitedQuestions: Record<string, boolean>;
  telemetry: Record<string, QuestionTelemetry>;
  submittedAtEpochMs?: number;
  totalTimeSpentMs?: number;
  updatedAtEpochMs: number;
}

export interface SectionAnalyticsItem {
  sectionId: string;
  sectionTitle: string;
  totalQuestions: number;
  maxAttempts: number | null;
  maxMarks: number;
  score: number;
  attempted: number;
  correct: number;
  partial: number;
  wrong: number;
  unattempted: number;
  accuracyPct: number;
  attemptPct: number;
  timeSpentMs: number;
  negativeMarksLost: number;
}

export interface QuestionAnalyticsItem {
  questionId: string;
  questionNumber: number;
  sectionId: string;
  sectionTitle: string;
  type: 'MCQ' | 'MSQ' | 'NAT';
  status: QuestionEvaluation['status'];
  marksAwarded: number;
  positiveMarksPossible: number;
  negativePenaltyPossible: number;
  ignoredByCap: boolean;
  timeSpentMs: number;
  visits: number;
  markedForReview: boolean;
}

export interface FullExamAnalytics {
  evaluation: ExamEvaluationResult;
  scorePct: number;
  accuracyPct: number;
  attemptPct: number;
  totalQuestions: number;
  totalAttempted: number;
  totalCorrect: number;
  totalPartial: number;
  totalWrong: number;
  totalUnattempted: number;
  positiveMarksEarned: number;
  negativeMarksLost: number;
  totalTimeSpentMs: number;
  avgTimePerAttemptedMs: number;
  sectionBreakdown: SectionAnalyticsItem[];
  questionBreakdown: QuestionAnalyticsItem[];
}

export interface CompletedAttemptSummary {
  idempotencyKey: string;
  packId: string;
  examSlug: string;
  examTitle: string;
  setId: string;
  setTitle: string;
  mode: 'trial' | 'full';
  totalScore: number;
  maxScore: number;
  accuracyPct: number;
  totalAttempted: number;
  totalQuestions: number;
  totalTimeSpentMs: number;
  completedAtIso: string;
  synced: boolean;
}
