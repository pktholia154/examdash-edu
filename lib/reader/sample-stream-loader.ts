import { apiUrl } from '../platform/api-base';

export const INITIAL_RANGE_PROBE_BYTES = 64 * 1024; // 64 KB linearized header + Page 1 XRef probe
export const SUBSEQUENT_RANGE_CHUNK_BYTES = 256 * 1024; // 256 KB streaming slices
export const MAX_SAMPLE_STREAM_BYTES = 64 * 1024 * 1024; // 64 MB FinOps safety cap
const MAX_CACHED_SAMPLES = 3;
const MAX_CACHE_TOTAL_BYTES = 16 * 1024 * 1024; // Cap memory cache at 16 MB

export interface ParsedContentRange {
  start: number;
  end: number;
  total: number | null;
}

export interface ByteRangeSlice {
  start: number;
  end: number;
}

export interface SampleRangeProgress {
  loadedBytes: number;
  totalBytes: number | null;
  usedRangeRequests: boolean;
}

export interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * Parses HTTP `Content-Range: bytes 0-65535/420192` headers safely.
 */
export function parseContentRangeHeader(
  headerValue: string | null | undefined
): ParsedContentRange | null {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(headerValue.trim());
  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2]);
  const totalRaw = match[3];
  const total = totalRaw === '*' ? null : Number(totalRaw);

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start
  ) {
    return null;
  }
  if (total !== null && (!Number.isInteger(total) || total <= end)) {
    return null;
  }

  return { start, end, total };
}

/**
 * Computes contiguous `Range: bytes=start-end` slices for remaining PDF bytes.
 */
export function buildRemainingByteRanges(
  nextByteOffset: number,
  totalBytes: number,
  chunkSize: number = SUBSEQUENT_RANGE_CHUNK_BYTES
): ByteRangeSlice[] {
  const safeChunk = Math.max(16 * 1024, Math.floor(chunkSize));
  if (
    !Number.isFinite(nextByteOffset) ||
    !Number.isFinite(totalBytes) ||
    nextByteOffset >= totalBytes
  ) {
    return [];
  }

  const slices: ByteRangeSlice[] = [];
  let cursor = Math.max(0, Math.floor(nextByteOffset));
  const endLimit = Math.floor(totalBytes) - 1;

  while (cursor <= endLimit) {
    const sliceEnd = Math.min(endLimit, cursor + safeChunk - 1);
    slices.push({ start: cursor, end: sliceEnd });
    cursor = sliceEnd + 1;
  }

  return slices;
}

/**
 * Respects user Data-Saver and constrained 2G connections before firing hover/touch prefetches.
 */
export function shouldAllowSpeculativePrefetch(
  connection?: NetworkInformationLike | null
): boolean {
  if (!connection) return true;
  if (connection.saveData === true) return false;
  const eff = (connection.effectiveType || '').toLowerCase();
  if (eff === 'slow-2g' || eff === '2g') return false;
  return true;
}

function getBrowserConnection(): NetworkInformationLike | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & {
    connection?: NetworkInformationLike;
  };
  return nav.connection ?? null;
}

// Bounded in-memory LRU cache + in-flight deduplication map for sample streams
const sampleBufferCache = new Map<string, ArrayBuffer>();
const sampleInFlightMap = new Map<string, Promise<ArrayBuffer>>();
const initialRangeProbeCache = new Map<
  string,
  { firstChunk: Uint8Array; totalBytes: number; complete: boolean }
>();

function rememberSampleBuffer(cacheKey: string, buffer: ArrayBuffer): void {
  if (buffer.byteLength > MAX_CACHE_TOTAL_BYTES) return;
  sampleBufferCache.delete(cacheKey);
  sampleBufferCache.set(cacheKey, buffer.slice(0));

  let totalBytes = 0;
  for (const buf of sampleBufferCache.values()) {
    totalBytes += buf.byteLength;
  }

  while (
    sampleBufferCache.size > MAX_CACHED_SAMPLES ||
    totalBytes > MAX_CACHE_TOTAL_BYTES
  ) {
    const oldestKey = sampleBufferCache.keys().next().value;
    if (!oldestKey) break;
    const evicted = sampleBufferCache.get(oldestKey);
    sampleBufferCache.delete(oldestKey);
    if (evicted) totalBytes -= evicted.byteLength;
  }
}

export function getCachedSampleBuffer(streamUrl: string): ArrayBuffer | null {
  const hit = sampleBufferCache.get(streamUrl);
  return hit ? hit.slice(0) : null;
}

export function clearSampleStreamCachesForTest(): void {
  sampleBufferCache.clear();
  sampleInFlightMap.clear();
  initialRangeProbeCache.clear();
}

export interface FetchSampleRangeOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  initialRangeBytes?: number;
  chunkBytes?: number;
  onProgress?: (progress: SampleRangeProgress) => void;
}

/**
 * Fetches a Sample PDF using HTTP Range Requests (`Range: bytes=0-65535` linearized probe
 * followed by bounded concurrent `256 KB` `206 Partial Content` slices).
 * Falls back cleanly to a standard `200 OK` response when upstream ignores Range or fits in chunk 1.
 */
export async function fetchSamplePdfViaHttpRanges(
  streamUrl: string,
  options: FetchSampleRangeOptions = {}
): Promise<ArrayBuffer> {
  const cached = getCachedSampleBuffer(streamUrl);
  if (cached) {
    options.onProgress?.({
      loadedBytes: cached.byteLength,
      totalBytes: cached.byteLength,
      usedRangeRequests: true,
    });
    return cached;
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const initialBytes = options.initialRangeBytes ?? INITIAL_RANGE_PROBE_BYTES;
  const chunkBytes = options.chunkBytes ?? SUBSEQUENT_RANGE_CHUNK_BYTES;

  // Deduplicate concurrent identical requests when using global fetch without a custom abort override
  const canShareInflight = !options.fetchImpl && !options.signal;
  if (canShareInflight) {
    const existing = sampleInFlightMap.get(streamUrl);
    if (existing) {
      const shared = await existing;
      return shared.slice(0);
    }
  }

  const runFetch = async (): Promise<ArrayBuffer> => {
    const prewarmedProbe = initialRangeProbeCache.get(streamUrl);
    let firstBytes: Uint8Array;
    let totalBytes: number;

    if (prewarmedProbe) {
      initialRangeProbeCache.delete(streamUrl);
      firstBytes = prewarmedProbe.firstChunk;
      totalBytes = prewarmedProbe.totalBytes;
      if (prewarmedProbe.complete) {
        const exact = firstBytes.buffer.slice(
          firstBytes.byteOffset,
          firstBytes.byteOffset + firstBytes.byteLength
        ) as ArrayBuffer;
        rememberSampleBuffer(streamUrl, exact);
        options.onProgress?.({
          loadedBytes: exact.byteLength,
          totalBytes: exact.byteLength,
          usedRangeRequests: true,
        });
        return exact.slice(0);
      }
    } else {
      const probeEnd = Math.max(1023, initialBytes - 1);
      const probeRes = await fetchFn(streamUrl, {
        method: 'GET',
        headers: {
          Range: `bytes=0-${probeEnd}`,
        },
        signal: options.signal,
      });

      if (probeRes.status === 416) {
        // Fallback to plain GET if byte range was rejected
        const plainRes = await fetchFn(streamUrl, {
          method: 'GET',
          signal: options.signal,
        });
        if (!plainRes.ok) {
          throw new Error(`Failed to load sample PDF (HTTP ${plainRes.status}).`);
        }
        const fullBuf = await plainRes.arrayBuffer();
        rememberSampleBuffer(streamUrl, fullBuf);
        options.onProgress?.({
          loadedBytes: fullBuf.byteLength,
          totalBytes: fullBuf.byteLength,
          usedRangeRequests: false,
        });
        return fullBuf.slice(0);
      }

      if (!probeRes.ok) {
        const errPayload = (await probeRes.json().catch(() => null)) as
          | { error?: string | { message?: string } }
          | null;
        const msg =
          typeof errPayload?.error === 'string'
            ? errPayload.error
            : typeof errPayload?.error?.message === 'string'
            ? errPayload.error.message
            : `Failed to load sample PDF stream (HTTP ${probeRes.status}).`;
        throw new Error(msg);
      }

      if (probeRes.status === 200) {
        const fullBuf = await probeRes.arrayBuffer();
        if (fullBuf.byteLength > MAX_SAMPLE_STREAM_BYTES) {
          throw new Error('Sample PDF exceeds the 64 MB safe download budget.');
        }
        rememberSampleBuffer(streamUrl, fullBuf);
        options.onProgress?.({
          loadedBytes: fullBuf.byteLength,
          totalBytes: fullBuf.byteLength,
          usedRangeRequests: false,
        });
        return fullBuf.slice(0);
      }

      const parsedRange = parseContentRangeHeader(
        probeRes.headers.get('content-range')
      );
      const firstArrayBuf = await probeRes.arrayBuffer();
      firstBytes = new Uint8Array(firstArrayBuf);

      if (!parsedRange || parsedRange.total === null || parsedRange.start !== 0) {
        // Server sent 206 without known total size -> fetch full cleanly
        const fallbackRes = await fetchFn(streamUrl, {
          method: 'GET',
          signal: options.signal,
        });
        if (!fallbackRes.ok) {
          throw new Error(
            `Failed to load sample PDF stream (HTTP ${fallbackRes.status}).`
          );
        }
        const fullBuf = await fallbackRes.arrayBuffer();
        rememberSampleBuffer(streamUrl, fullBuf);
        options.onProgress?.({
          loadedBytes: fullBuf.byteLength,
          totalBytes: fullBuf.byteLength,
          usedRangeRequests: false,
        });
        return fullBuf.slice(0);
      }

      totalBytes = parsedRange.total;
      if (totalBytes > MAX_SAMPLE_STREAM_BYTES) {
        throw new Error('Sample PDF exceeds the 64 MB safe download budget.');
      }

      if (firstBytes.byteLength >= totalBytes) {
        const completeBuf = firstBytes.buffer.slice(
          firstBytes.byteOffset,
          firstBytes.byteOffset + totalBytes
        ) as ArrayBuffer;
        rememberSampleBuffer(streamUrl, completeBuf);
        options.onProgress?.({
          loadedBytes: totalBytes,
          totalBytes,
          usedRangeRequests: true,
        });
        return completeBuf.slice(0);
      }
    }

    const assembled = new Uint8Array(totalBytes);
    assembled.set(firstBytes, 0);
    let loadedBytes = firstBytes.byteLength;

    options.onProgress?.({
      loadedBytes,
      totalBytes,
      usedRangeRequests: true,
    });

    const remainingSlices = buildRemainingByteRanges(
      firstBytes.byteLength,
      totalBytes,
      chunkBytes
    );

    // Bounded concurrency = 2 over HTTP/2 to stream linearized PDF pages smoothly without head-of-line blocking
    let nextIdx = 0;
    const workerCount = Math.min(2, remainingSlices.length);

    const runSliceWorker = async () => {
      while (nextIdx < remainingSlices.length) {
        const currentSlice = remainingSlices[nextIdx++];
        if (!currentSlice) break;

        const sliceRes = await fetchFn(streamUrl, {
          method: 'GET',
          headers: {
            Range: `bytes=${currentSlice.start}-${currentSlice.end}`,
          },
          signal: options.signal,
        });

        if (!sliceRes.ok) {
          throw new Error(
            `Failed to stream PDF byte range ${currentSlice.start}-${currentSlice.end} (HTTP ${sliceRes.status}).`
          );
        }

        const sliceBuf = await sliceRes.arrayBuffer();
        const sliceBytes = new Uint8Array(sliceBuf);

        if (sliceRes.status === 200 && sliceBytes.byteLength === totalBytes) {
          assembled.set(sliceBytes, 0);
          loadedBytes = totalBytes;
          nextIdx = remainingSlices.length;
          options.onProgress?.({
            loadedBytes,
            totalBytes,
            usedRangeRequests: false,
          });
          return;
        }

        const safeLen = Math.min(
          sliceBytes.byteLength,
          totalBytes - currentSlice.start
        );
        assembled.set(sliceBytes.subarray(0, safeLen), currentSlice.start);
        loadedBytes = Math.min(totalBytes, loadedBytes + safeLen);

        options.onProgress?.({
          loadedBytes,
          totalBytes,
          usedRangeRequests: true,
        });
      }
    };

    await Promise.all(
      Array.from({ length: workerCount }, () => runSliceWorker())
    );

    const finalBuffer = assembled.buffer.slice(0) as ArrayBuffer;
    rememberSampleBuffer(streamUrl, finalBuffer);
    return finalBuffer.slice(0);
  };

  if (canShareInflight) {
    const p = runFetch().finally(() => {
      sampleInFlightMap.delete(streamUrl);
    });
    sampleInFlightMap.set(streamUrl, p);
    const buf = await p;
    return buf.slice(0);
  }

  return runFetch();
}

/**
 * Fetches & caches a Sample Markdown buffer with in-flight deduplication.
 */
export async function fetchSampleMarkdownCached(
  streamUrl: string,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const cached = getCachedSampleBuffer(streamUrl);
  if (cached) return cached;

  if (!signal) {
    const existing = sampleInFlightMap.get(streamUrl);
    if (existing) {
      const shared = await existing;
      return shared.slice(0);
    }
  }

  const run = async (): Promise<ArrayBuffer> => {
    const res = await fetch(streamUrl, { method: 'GET', signal });
    if (!res.ok) {
      const errObj = (await res.json().catch(() => null)) as
        | { error?: string | { message?: string } }
        | null;
      const msg =
        typeof errObj?.error === 'string'
          ? errObj.error
          : typeof errObj?.error?.message === 'string'
          ? errObj.error.message
          : `Failed to load sample Markdown stream (HTTP ${res.status}).`;
      throw new Error(msg);
    }
    const buf = await res.arrayBuffer();
    rememberSampleBuffer(streamUrl, buf);
    return buf.slice(0);
  };

  if (!signal) {
    const p = run().finally(() => {
      sampleInFlightMap.delete(streamUrl);
    });
    sampleInFlightMap.set(streamUrl, p);
    const buf = await p;
    return buf.slice(0);
  }

  return run();
}

const prefetchedSlugFormats = new Set<string>();
let wasmPrefetched = false;

export function buildBookSampleStreamUrl(
  urlSlug: string,
  format: 'pdf' | 'markdown'
): string {
  return apiUrl(
    `/api/v1/library/stream?collection=books&slug=${encodeURIComponent(
      urlSlug
    )}&mode=sample&format=${format}`
  );
}

/**
 * Zero-initial-load speculative warm-up triggered ONLY on user hover / touchstart / focus.
 * Warms:
 * 1. Dynamic viewer JS chunks (`book-inline-reader-modal` + `pdf-viewer` or `markdown-viewer`)
 * 2. Immutable `/wasm/pdfium.wasm` engine binary (when format === 'pdf')
 * 3. Initial `Range: bytes=0-65535` linearized PDF header probe (or lightweight Markdown sample)
 */
export function prefetchBookSampleOnIntent(params: {
  urlSlug: string;
  preferredFormat: 'pdf' | 'markdown';
  preloadViewerChunks?: () => void;
}): void {
  if (typeof window === 'undefined') return;
  if (!shouldAllowSpeculativePrefetch(getBrowserConnection())) return;

  params.preloadViewerChunks?.();

  const key = `${params.urlSlug}:${params.preferredFormat}`;
  if (prefetchedSlugFormats.has(key)) return;
  prefetchedSlugFormats.add(key);

  if (params.preferredFormat === 'pdf') {
    if (!wasmPrefetched) {
      wasmPrefetched = true;
      void fetch('/wasm/pdfium.wasm', {
        method: 'GET',
        credentials: 'same-origin',
      }).catch(() => {});
    }

    const pdfUrl = buildBookSampleStreamUrl(params.urlSlug, 'pdf');
    if (sampleBufferCache.has(pdfUrl) || initialRangeProbeCache.has(pdfUrl)) {
      return;
    }

    // Lightweight 64 KB HTTP Range probe (warms first linearized pages without downloading multi-MB files on hover)
    const probeEnd = INITIAL_RANGE_PROBE_BYTES - 1;
    void fetch(pdfUrl, {
      method: 'GET',
      headers: {
        Range: `bytes=0-${probeEnd}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        if (res.status === 200) {
          rememberSampleBuffer(pdfUrl, buf);
          return;
        }
        const range = parseContentRangeHeader(res.headers.get('content-range'));
        if (range && range.total !== null && range.start === 0) {
          const bytes = new Uint8Array(buf);
          if (bytes.byteLength >= range.total) {
            rememberSampleBuffer(pdfUrl, buf.slice(0, range.total));
          } else {
            initialRangeProbeCache.set(pdfUrl, {
              firstChunk: bytes,
              totalBytes: range.total,
              complete: false,
            });
          }
        }
      })
      .catch(() => {});
  } else {
    const mdUrl = buildBookSampleStreamUrl(params.urlSlug, 'markdown');
    if (!sampleBufferCache.has(mdUrl)) {
      void fetchSampleMarkdownCached(mdUrl).catch(() => {});
    }
  }
}
