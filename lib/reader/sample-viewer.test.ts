import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSampleTelemetrySession,
  type SampleTelemetryEventRecord,
} from '../analytics/sample-telemetry';
import {
  buildRemainingByteRanges,
  clearSampleStreamCachesForTest,
  fetchSamplePdfViaHttpRanges,
  parseContentRangeHeader,
  shouldAllowSpeculativePrefetch,
} from './sample-stream-loader';
import { computeDragDismissDecision } from './sample-overlay-events';

test('parseContentRangeHeader parses valid HTTP 206 Content-Range headers and rejects malformed values', () => {
  assert.deepEqual(parseContentRangeHeader('bytes 0-65535/420192'), {
    start: 0,
    end: 65535,
    total: 420192,
  });
  assert.deepEqual(parseContentRangeHeader('bytes 65536-131071/*'), {
    start: 65536,
    end: 131071,
    total: null,
  });
  assert.equal(parseContentRangeHeader('items 0-10/100'), null);
  assert.equal(parseContentRangeHeader('bytes 200-100/500'), null);
  assert.equal(parseContentRangeHeader('bytes 0-500/500'), null);
  assert.equal(parseContentRangeHeader(null), null);
});

test('buildRemainingByteRanges computes contiguous non-overlapping HTTP Range slices', () => {
  const ranges = buildRemainingByteRanges(65536, 600000, 262144);
  assert.deepEqual(ranges, [
    { start: 65536, end: 327679 },
    { start: 327680, end: 589823 },
    { start: 589824, end: 599999 },
  ]);
  assert.deepEqual(buildRemainingByteRanges(65536, 65536, 262144), []);
});

test('fetchSamplePdfViaHttpRanges streams linearized 206 Partial Content chunks and caches assembled PDF bytes', async () => {
  clearSampleStreamCachesForTest();

  // Create a synthetic 200 KB deterministic byte buffer
  const totalSize = 200 * 1024;
  const source = new Uint8Array(totalSize);
  for (let i = 0; i < totalSize; i++) {
    source[i] = (i * 31 + 7) & 0xff;
  }

  const seenRanges: string[] = [];
  const mockRangeFetch: typeof fetch = async (_input, init) => {
    const rawHeaders = init?.headers as Record<string, string> | undefined;
    const rangeHeader = rawHeaders?.Range || '';
    seenRanges.push(rangeHeader);

    const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
    if (!match) {
      return new Response(source.slice(0), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    }

    const start = Number(match[1]);
    const end = Math.min(totalSize - 1, Number(match[2]));
    const slice = source.slice(start, end + 1);

    return new Response(slice, {
      status: 206,
      headers: {
        'Content-Type': 'application/pdf',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': String(slice.byteLength),
      },
    });
  };

  const progressSnapshots: number[] = [];
  const assembled = await fetchSamplePdfViaHttpRanges(
    'https://exam-dash.com/api/v1/library/stream?slug=polity&mode=sample&format=pdf',
    {
      fetchImpl: mockRangeFetch,
      initialRangeBytes: 64 * 1024,
      chunkBytes: 64 * 1024,
      onProgress: (p) => progressSnapshots.push(p.loadedBytes),
    }
  );

  // 200 KB split into 64 KB probe + 3 x 64 KB/8 KB slices = 4 HTTP Range requests
  assert.equal(seenRanges.length, 4);
  assert.equal(seenRanges[0], 'bytes=0-65535');
  assert.equal(assembled.byteLength, totalSize);
  assert.deepEqual(new Uint8Array(assembled), source);
  assert.equal(progressSnapshots[progressSnapshots.length - 1], totalSize);

  // Subsequent call hits bounded in-memory cache with 0 additional network calls
  const cachedHit = await fetchSamplePdfViaHttpRanges(
    'https://exam-dash.com/api/v1/library/stream?slug=polity&mode=sample&format=pdf',
    { fetchImpl: mockRangeFetch }
  );
  assert.equal(seenRanges.length, 4);
  assert.equal(cachedHit.byteLength, totalSize);
});

test('shouldAllowSpeculativePrefetch skips speculative hover/touch prefetch on Save-Data and 2G networks', () => {
  assert.equal(shouldAllowSpeculativePrefetch(null), true);
  assert.equal(shouldAllowSpeculativePrefetch({ effectiveType: '4g' }), true);
  assert.equal(
    shouldAllowSpeculativePrefetch({ saveData: true, effectiveType: '4g' }),
    false
  );
  assert.equal(shouldAllowSpeculativePrefetch({ effectiveType: '2g' }), false);
  assert.equal(
    shouldAllowSpeculativePrefetch({ effectiveType: 'slow-2g' }),
    false
  );
});

test('createSampleTelemetrySession tracks open, quartile milestones, 30s active heartbeats, CTA clicks, close, and NEVER emits page_view', () => {
  let fakeNowMs = 1_000_000;
  let visible = true;
  const events: SampleTelemetryEventRecord[] = [];

  const session = createSampleTelemetrySession({
    context: {
      bookId: 'book_101',
      bookSlug: 'upsc-modern-history-101',
      bookTitle: 'UPSC Modern History Question Bank',
      pagePath: '/books/upsc-modern-history-101',
    },
    initialFormat: 'pdf',
    triggerSource: 'buy_card_cta',
    nowMs: () => fakeNowMs,
    isVisibleAndFocused: () => visible,
    sink: (rec) => events.push(rec),
  });

  session.startOpen();
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'sample_view_open');
  assert.equal(events[0].params.trigger_source, 'buy_card_cta');

  // Advance 3 x 10s ticks while actively reading -> fires 1st 30s heartbeat
  for (let i = 0; i < 3; i++) {
    fakeNowMs += 10_000;
    session.recordInteraction();
    session.tick();
  }
  const heartbeatsAfter30s = events.filter(
    (e) => e.event === 'sample_active_heartbeat'
  );
  assert.equal(heartbeatsAfter30s.length, 1);
  assert.equal(heartbeatsAfter30s[0].params.active_reading_seconds, 30);

  // Tab hidden for 30s -> must NOT count toward active reading time or fire heartbeat
  visible = false;
  for (let i = 0; i < 3; i++) {
    fakeNowMs += 10_000;
    session.tick();
  }
  assert.equal(
    events.filter((e) => e.event === 'sample_active_heartbeat').length,
    1
  );

  // Tab visible again + user scrolls to page 2 of 4 (50% milestone)
  visible = true;
  session.updateProgress({
    format: 'pdf',
    current: 2,
    total: 4,
    ratio: 0.5,
  });
  const progressEvents = events.filter((e) => e.event === 'sample_progress');
  assert.equal(progressEvents.length, 1);
  assert.equal(progressEvents[0].params.progress_pct, 50);
  assert.equal(progressEvents[0].params.milestone_pct, 50);

  // Duplicate update at same page & ratio -> deduplicated (no spam)
  session.updateProgress({
    format: 'pdf',
    current: 2,
    total: 4,
    ratio: 0.5,
  });
  assert.equal(
    events.filter((e) => e.event === 'sample_progress').length,
    1
  );

  // User clicks sticky "Buy eBook" CTA and closes modal
  fakeNowMs += 5_000;
  session.recordCtaClick({
    ctaType: 'sticky_buy_ebook',
    value: 119,
    currency: 'INR',
    validityMonths: 6,
  });
  session.close('cta_checkout');
  // Calling close a second time is a no-op
  session.close('close_button');

  const ctaEvents = events.filter((e) => e.event === 'sample_cta_click');
  assert.equal(ctaEvents.length, 1);
  assert.equal(ctaEvents[0].params.cta_type, 'sticky_buy_ebook');
  assert.equal(ctaEvents[0].params.active_reading_seconds, 35);

  const closeEvents = events.filter((e) => e.event === 'sample_view_close');
  assert.equal(closeEvents.length, 1);
  assert.equal(closeEvents[0].params.close_reason, 'cta_checkout');

  // Strict Guardrail #3: Zero page_view or screen_view events ever emitted
  assert.equal(
    events.some(
      (e) =>
        String(e.event).includes('page_view') ||
        String(e.event).includes('screen_view')
    ),
    false
  );
});

test('computeDragDismissDecision dismisses on downward drag >= 96px or fast downward flick, never on upward scroll', () => {
  assert.equal(
    computeDragDismissDecision({ deltaY: -80, velocityPxPerMs: 1.2 }),
    false
  );
  assert.equal(
    computeDragDismissDecision({ deltaY: 28, velocityPxPerMs: 0.2 }),
    false
  );
  assert.equal(
    computeDragDismissDecision({ deltaY: 110, velocityPxPerMs: 0.15 }),
    true
  );
  assert.equal(
    computeDragDismissDecision({ deltaY: 52, velocityPxPerMs: 0.85 }),
    true
  );
});
