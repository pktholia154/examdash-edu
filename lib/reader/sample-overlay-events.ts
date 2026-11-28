import type {
  SampleTriggerSource,
  SampleViewerFormat,
} from '../analytics/sample-telemetry';

export const OPEN_BOOK_SAMPLE_EVENT = 'ed:open-book-sample';

export interface OpenBookSampleDetail {
  bookId: string;
  format?: SampleViewerFormat;
  triggerSource: SampleTriggerSource;
}

/**
 * Dispatches a same-DOM sample open request so sibling islands on `/books/[urlSlug]`
 * (such as `BookChaptersList` Chapter 1) open the inline viewer without route navigation.
 */
export function requestOpenBookSample(detail: OpenBookSampleDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<OpenBookSampleDetail>(OPEN_BOOK_SAMPLE_EVENT, { detail })
  );
}

export function subscribeOpenBookSample(
  bookId: string,
  onOpen: (detail: OpenBookSampleDetail) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const listener = (ev: Event) => {
    const custom = ev as CustomEvent<OpenBookSampleDetail>;
    if (custom.detail?.bookId === bookId) {
      onOpen(custom.detail);
    }
  };

  window.addEventListener(OPEN_BOOK_SAMPLE_EVENT, listener);
  return () => {
    window.removeEventListener(OPEN_BOOK_SAMPLE_EVENT, listener);
  };
}

export interface DragDismissEvaluationInput {
  deltaY: number;
  velocityPxPerMs: number;
  distanceThresholdPx?: number;
  flickVelocityThreshold?: number;
}

/**
 * Pure physics check for mobile bottom-sheet top-handle drag-to-close:
 * - Never closes on upward drag (`deltaY <= 0`).
 * - Closes if dragged downward >= 96px OR downward flick >= 40px at >= 0.65 px/ms.
 */
export function computeDragDismissDecision(
  input: DragDismissEvaluationInput
): boolean {
  const distanceThreshold = input.distanceThresholdPx ?? 96;
  const velocityThreshold = input.flickVelocityThreshold ?? 0.65;

  if (!Number.isFinite(input.deltaY) || input.deltaY <= 0) {
    return false;
  }
  if (input.deltaY >= distanceThreshold) {
    return true;
  }
  if (
    input.deltaY >= 40 &&
    Number.isFinite(input.velocityPxPerMs) &&
    input.velocityPxPerMs >= velocityThreshold
  ) {
    return true;
  }
  return false;
}

/**
 * Pushes a same-URL history entry (`window.location.href` strictly unchanged) so mobile
 * hardware/gesture Back dismisses the Sample Viewer without triggering a route navigation
 * or a duplicate GA4 Enhanced Measurement `page_view`.
 */
export function pushSameUrlSampleHistoryState(bookId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const currentState =
      window.history.state && typeof window.history.state === 'object'
        ? (window.history.state as Record<string, unknown>)
        : {};
    if (currentState.edInlineReader === true) {
      return false;
    }
    const exactSameUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.pushState(
      {
        ...currentState,
        edInlineReader: true,
        edSampleBookId: bookId,
      },
      '',
      exactSameUrl
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Pops our pushed same-URL history entry when the user closes the modal via UI
 * (`X`, Escape, Backdrop, Drag Handle) so no orphan history entry traps the Back button.
 */
export function popSameUrlSampleHistoryStateIfPresent(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const currentState =
      window.history.state && typeof window.history.state === 'object'
        ? (window.history.state as Record<string, unknown>)
        : null;
    if (currentState?.edInlineReader === true) {
      window.history.back();
      return true;
    }
  } catch {
    // Ignore restricted iframe history environments
  }
  return false;
}
