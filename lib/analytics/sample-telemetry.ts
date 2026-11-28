export type SampleViewerFormat = 'pdf' | 'markdown';

export type SampleTriggerSource =
  | 'buy_card_cta'
  | 'chapter_list'
  | 'format_switch';

export type SampleCloseReason =
  | 'close_button'
  | 'backdrop'
  | 'escape'
  | 'drag_handle'
  | 'back_button'
  | 'cta_checkout'
  | 'pagehide';

export type SampleCtaType =
  | 'sticky_buy_ebook'
  | 'sticky_add_to_cart'
  | 'end_card_unlock';

export type AllowedSampleEventName =
  | 'sample_view_open'
  | 'sample_progress'
  | 'sample_active_heartbeat'
  | 'sample_cta_click'
  | 'sample_view_close';

const ALLOWED_SAMPLE_EVENTS: ReadonlySet<AllowedSampleEventName> = new Set([
  'sample_view_open',
  'sample_progress',
  'sample_active_heartbeat',
  'sample_cta_click',
  'sample_view_close',
]);

export interface SampleTelemetryEventRecord {
  event: AllowedSampleEventName;
  timestampMs: number;
  params: Record<string, string | number | boolean>;
}

export interface SampleTelemetryBookContext {
  bookId: string;
  bookSlug: string;
  bookTitle: string;
  pagePath: string;
}

export const HEARTBEAT_INTERVAL_SECONDS = 30;
export const MAX_IDLE_WINDOW_MS = 45_000;
const PROGRESS_MILESTONES = [25, 50, 75, 100] as const;
const MAX_RING_BUFFER_EVENTS = 50;
const LOCAL_ENGAGEMENT_STORAGE_KEY = 'ed-sample-engagement-v1';

interface WindowAnalyticsGlobals {
  gtag?: (
    command: 'event',
    eventName: string,
    eventParams?: Record<string, unknown>
  ) => void;
  dataLayer?: Array<Record<string, unknown>>;
  __edSampleTelemetry?: SampleTelemetryEventRecord[];
}

/**
 * Dispatches strictly whitelisted sample-engagement events to GA4 (`gtag` / `dataLayer`)
 * and `window` custom events while guaranteeing ZERO `page_view` or `screen_view` triggers.
 */
export function dispatchSampleAnalyticsEvent(
  eventName: AllowedSampleEventName,
  params: Record<string, string | number | boolean>,
  customSink?: (record: SampleTelemetryEventRecord) => void
): SampleTelemetryEventRecord | null {
  if (!ALLOWED_SAMPLE_EVENTS.has(eventName)) {
    return null;
  }

  const record: SampleTelemetryEventRecord = {
    event: eventName,
    timestampMs: Date.now(),
    params: {
      ...params,
      non_interaction: false,
    },
  };

  if (customSink) {
    customSink(record);
  }

  if (typeof window !== 'undefined') {
    const win = window as unknown as WindowAnalyticsGlobals;

    if (!Array.isArray(win.__edSampleTelemetry)) {
      win.__edSampleTelemetry = [];
    }
    win.__edSampleTelemetry.push(record);
    if (win.__edSampleTelemetry.length > MAX_RING_BUFFER_EVENTS) {
      win.__edSampleTelemetry.splice(
        0,
        win.__edSampleTelemetry.length - MAX_RING_BUFFER_EVENTS
      );
    }

    try {
      if (typeof win.gtag === 'function') {
        win.gtag('event', eventName, record.params);
      } else if (Array.isArray(win.dataLayer)) {
        win.dataLayer.push({
          event: eventName,
          ...record.params,
        });
      }
    } catch {
      // Never allow third-party tag manager exceptions to disrupt reading UX
    }

    try {
      window.dispatchEvent(
        new CustomEvent<SampleTelemetryEventRecord>('ed:sample-telemetry', {
          detail: record,
        })
      );
    } catch {
      // Ignore restricted environments
    }
  }

  return record;
}

function persistLocalSampleEngagement(
  bookId: string,
  bookSlug: string,
  addedActiveSeconds: number,
  maxProgressPct: number
): void {
  if (typeof window === 'undefined' || addedActiveSeconds <= 0) return;
  try {
    const raw = window.localStorage.getItem(LOCAL_ENGAGEMENT_STORAGE_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Record<
          string,
          {
            slug: string;
            activeSeconds: number;
            maxProgressPct: number;
            updatedAt: number;
          }
        >)
      : {};
    const prev = parsed[bookId];
    parsed[bookId] = {
      slug: bookSlug,
      activeSeconds: (prev?.activeSeconds || 0) + addedActiveSeconds,
      maxProgressPct: Math.max(prev?.maxProgressPct || 0, maxProgressPct),
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(
      LOCAL_ENGAGEMENT_STORAGE_KEY,
      JSON.stringify(parsed)
    );
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export interface SampleTelemetrySessionOptions {
  context: SampleTelemetryBookContext;
  initialFormat: SampleViewerFormat;
  triggerSource: SampleTriggerSource;
  nowMs?: () => number;
  isVisibleAndFocused?: () => boolean;
  sink?: (record: SampleTelemetryEventRecord) => void;
}

/**
 * Pure, testable session state machine for Same-DOM Sample Reading Analytics:
 * - Tracks `sample_view_open` once on mount (and format switches).
 * - Deduplicates `sample_progress` across quartile scroll/page milestones & new pages reached.
 * - Accumulates active reading seconds ONLY while tab is visible + user interacted within 45s,
 *   emitting `sample_active_heartbeat` every 30 active seconds.
 * - Tracks `sample_cta_click` and a single idempotent `sample_view_close`.
 * - Never emits `page_view` or `screen_view`.
 */
export function createSampleTelemetrySession(
  options: SampleTelemetrySessionOptions
) {
  const getNow = options.nowMs ?? (() => Date.now());
  const checkActiveSurface =
    options.isVisibleAndFocused ??
    (() => {
      if (typeof document === 'undefined') return true;
      return document.visibilityState === 'visible';
    });

  let activeFormat: SampleViewerFormat = options.initialFormat;
  let lastActivityAtMs = getNow();
  let lastTickAtMs = getNow();
  let accumulatedActiveMs = 0;
  let emittedHeartbeats = 0;
  let maxProgressPct = 0;
  let maxPageReached = 0;
  let currentUnit = 1;
  let totalUnits = 1;
  let closed = false;

  const reachedMilestonesByFormat: Record<SampleViewerFormat, Set<number>> = {
    pdf: new Set<number>(),
    markdown: new Set<number>(),
  };

  const emit = (
    eventName: AllowedSampleEventName,
    extra: Record<string, string | number | boolean>
  ) => {
    return dispatchSampleAnalyticsEvent(
      eventName,
      {
        book_id: options.context.bookId,
        book_slug: options.context.bookSlug,
        book_title: options.context.bookTitle,
        page_path: options.context.pagePath,
        sample_format: activeFormat,
        ...extra,
      },
      options.sink
    );
  };

  const startOpen = () => {
    const now = getNow();
    lastActivityAtMs = now;
    lastTickAtMs = now;
    emit('sample_view_open', {
      trigger_source: options.triggerSource,
    });
  };

  const recordInteraction = () => {
    if (closed) return;
    lastActivityAtMs = getNow();
  };

  const switchFormat = (nextFormat: SampleViewerFormat) => {
    if (closed || nextFormat === activeFormat) return;
    activeFormat = nextFormat;
    recordInteraction();
    emit('sample_view_open', {
      trigger_source: 'format_switch',
    });
  };

  const updateProgress = (input: {
    format: SampleViewerFormat;
    current: number;
    total: number;
    ratio: number;
  }) => {
    if (closed) return;
    activeFormat = input.format;
    recordInteraction();

    const safeTotal = Math.max(1, Math.floor(input.total || 1));
    const safeCurrent = Math.min(
      safeTotal,
      Math.max(1, Math.floor(input.current || 1))
    );
    currentUnit = safeCurrent;
    totalUnits = safeTotal;

    const clampedRatio = Number.isFinite(input.ratio)
      ? Math.min(1, Math.max(0, input.ratio))
      : safeCurrent / safeTotal;
    const pct = Math.min(100, Math.max(0, Math.round(clampedRatio * 100)));
    if (pct > maxProgressPct) {
      maxProgressPct = pct;
    }

    const formatMilestones = reachedMilestonesByFormat[input.format];
    let highestNewMilestone: number | null = null;
    for (const m of PROGRESS_MILESTONES) {
      if (pct >= m && !formatMilestones.has(m)) {
        formatMilestones.add(m);
        highestNewMilestone = m;
      }
    }

    const isNewPdfPage =
      input.format === 'pdf' &&
      safeCurrent > maxPageReached &&
      safeCurrent > 1;
    if (input.format === 'pdf' && safeCurrent > maxPageReached) {
      maxPageReached = safeCurrent;
    }

    if (highestNewMilestone !== null || isNewPdfPage) {
      emit('sample_progress', {
        current_unit: safeCurrent,
        total_units: safeTotal,
        progress_pct: pct,
        milestone_pct: highestNewMilestone ?? pct,
      });
    }
  };

  /**
   * Advances the active-reading clock and fires `sample_active_heartbeat`
   * strictly once per 30 seconds of verified active on-page reading.
   */
  const tick = (): number => {
    if (closed) return Math.floor(accumulatedActiveMs / 1000);
    const now = getNow();
    const deltaMs = Math.max(0, Math.min(now - lastTickAtMs, 15_000));
    lastTickAtMs = now;

    const withinIdleWindow = now - lastActivityAtMs <= MAX_IDLE_WINDOW_MS;
    if (checkActiveSurface() && withinIdleWindow) {
      accumulatedActiveMs += deltaMs;
      const totalActiveSec = Math.floor(accumulatedActiveMs / 1000);
      const targetHeartbeats = Math.floor(
        totalActiveSec / HEARTBEAT_INTERVAL_SECONDS
      );

      while (emittedHeartbeats < targetHeartbeats) {
        emittedHeartbeats += 1;
        const beatSeconds = emittedHeartbeats * HEARTBEAT_INTERVAL_SECONDS;
        emit('sample_active_heartbeat', {
          heartbeat_index: emittedHeartbeats,
          active_reading_seconds: beatSeconds,
          max_progress_pct: maxProgressPct,
          current_unit: currentUnit,
          total_units: totalUnits,
        });
        persistLocalSampleEngagement(
          options.context.bookId,
          options.context.bookSlug,
          HEARTBEAT_INTERVAL_SECONDS,
          maxProgressPct
        );
      }
    }

    return Math.floor(accumulatedActiveMs / 1000);
  };

  const recordCtaClick = (input: {
    ctaType: SampleCtaType;
    value: number;
    currency: string;
    validityMonths: number;
  }) => {
    if (closed) return;
    tick();
    const activeSec = Math.floor(accumulatedActiveMs / 1000);
    emit('sample_cta_click', {
      cta_type: input.ctaType,
      active_reading_seconds: activeSec,
      max_progress_pct: maxProgressPct,
      value: Number.isFinite(input.value) ? input.value : 0,
      currency: input.currency || 'INR',
      validity_months: input.validityMonths,
    });
  };

  const close = (reason: SampleCloseReason) => {
    if (closed) return;
    tick();
    closed = true;
    const totalActiveSec = Math.floor(accumulatedActiveMs / 1000);
    const remainderSec =
      totalActiveSec - emittedHeartbeats * HEARTBEAT_INTERVAL_SECONDS;
    if (remainderSec > 0) {
      persistLocalSampleEngagement(
        options.context.bookId,
        options.context.bookSlug,
        remainderSec,
        maxProgressPct
      );
    }
    emit('sample_view_close', {
      close_reason: reason,
      active_reading_seconds: totalActiveSec,
      max_progress_pct: maxProgressPct,
      heartbeats_sent: emittedHeartbeats,
    });
  };

  return {
    startOpen,
    recordInteraction,
    switchFormat,
    updateProgress,
    tick,
    recordCtaClick,
    close,
    getSnapshot: () => ({
      activeFormat,
      activeReadingSeconds: Math.floor(accumulatedActiveMs / 1000),
      maxProgressPct,
      emittedHeartbeats,
      currentUnit,
      totalUnits,
      closed,
    }),
  };
}
