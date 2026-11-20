/// <reference lib="webworker" />

import {
  createEngine,
  PdfBudgetError,
  PdfFormatError,
  PdfPasswordError,
  type PdfDocument,
  type PdfEngine,
} from 'clawpdf/browser';

export interface PdfPageDimension {
  pageNumber: number; // 1-indexed
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

export type PdfWorkerRequest =
  | {
      type: 'OPEN_BUFFER';
      requestId: string;
      wasmUrl: string;
      buffer: ArrayBuffer;
      password?: string;
    }
  | {
      type: 'OPEN_URL';
      requestId: string;
      wasmUrl: string;
      url: string;
      password?: string;
      fetchTimeoutMs?: number;
      fetchMaxBytes?: number;
    }
  | {
      type: 'RENDER_PAGE';
      jobId: string;
      pageNumber: number;
      desiredWidth: number;
      extraRotate: 0 | 90 | 180 | 270;
      priority: number; // 2 = active visible, 1 = neighbor preload
    }
  | {
      type: 'CANCEL_OFFSCREEN';
      keepPages: number[];
    }
  | {
      type: 'CANCEL_ALL_RENDERS';
    }
  | {
      type: 'CLOSE_DOCUMENT';
    }
  | {
      type: 'DESTROY';
    };

export type PdfWorkerResponse =
  | {
      type: 'OPEN_SUCCESS';
      requestId: string;
      pageCount: number;
      pages: PdfPageDimension[];
      title?: string;
    }
  | {
      type: 'OPEN_ERROR';
      requestId: string;
      errorCode: 'PASSWORD' | 'FORMAT' | 'BUDGET' | 'UNKNOWN';
      message: string;
    }
  | {
      type: 'RENDER_SUCCESS';
      jobId: string;
      pageNumber: number;
      width: number;
      height: number;
      extraRotate: 0 | 90 | 180 | 270;
      bitmap?: ImageBitmap;
      rgbaBuffer?: ArrayBuffer;
    }
  | {
      type: 'RENDER_ERROR';
      jobId: string;
      pageNumber: number;
      errorCode: 'BUDGET' | 'FORMAT' | 'UNKNOWN';
      message: string;
    }
  | {
      type: 'DESTROYED';
    };

interface QueuedRenderJob {
  jobId: string;
  pageNumber: number;
  desiredWidth: number;
  extraRotate: 0 | 90 | 180 | 270;
  priority: number;
  enqueuedAt: number;
}

const MAX_ENGINE_RENDER_PIXELS = 16_000_000;
const SAFE_CLAMP_PIXELS = 12_500_000; // 12.5 MP ceiling
const SAFE_MAX_SIDE = 4096; // WebKit GPU texture ceiling

let sharedEngine: PdfEngine | null = null;
let engineInitPromise: Promise<PdfEngine> | null = null;
let activeDoc: PdfDocument | null = null;
let activeOpenAbort: AbortController | null = null;

const renderQueue: QueuedRenderJob[] = [];
let isProcessingQueue = false;

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

async function ensureEngine(wasmUrl: string): Promise<PdfEngine> {
  if (sharedEngine) return sharedEngine;
  if (engineInitPromise) return engineInitPromise;

  engineInitPromise = (async () => {
    try {
      const eng = await createEngine({
        wasmUrl,
        maxRenderPixels: MAX_ENGINE_RENDER_PIXELS,
      });
      sharedEngine = eng;
      return eng;
    } catch {
      // Fallback for restrictive WebViews where instantiateStreaming fails
      const res = await fetch(wasmUrl, { credentials: 'same-origin' });
      if (!res.ok) {
        throw new Error(`Failed to load local pdfium.wasm (${res.status})`);
      }
      const wasmBinary = await res.arrayBuffer();
      const eng = await createEngine({
        wasmBinary,
        maxRenderPixels: MAX_ENGINE_RENDER_PIXELS,
      });
      sharedEngine = eng;
      return eng;
    } finally {
      engineInitPromise = null;
    }
  })();

  return engineInitPromise;
}

function classifyPdfError(
  error: unknown
): { code: 'PASSWORD' | 'FORMAT' | 'BUDGET' | 'UNKNOWN'; message: string } {
  if (error instanceof PdfPasswordError) {
    return {
      code: 'PASSWORD',
      message: error.message || 'This PDF requires a password to open.',
    };
  }
  if (error instanceof PdfBudgetError) {
    return {
      code: 'BUDGET',
      message: error.message || 'PDF exceeded safe memory render budget.',
    };
  }
  if (error instanceof PdfFormatError) {
    return {
      code: 'FORMAT',
      message: error.message || 'Invalid or corrupted PDF format.',
    };
  }
  return {
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
  };
}

function clampSafeRenderWidth(
  intrinsicWidth: number,
  intrinsicHeight: number,
  embeddedRotation: 0 | 90 | 180 | 270,
  extraRotate: 0 | 90 | 180 | 270,
  desiredWidth: number
): number {
  const totalRotation = (embeddedRotation + extraRotate) % 360;
  const swapped = totalRotation === 90 || totalRotation === 270;
  const baseW = Math.max(1, swapped ? intrinsicHeight : intrinsicWidth);
  const baseH = Math.max(1, swapped ? intrinsicWidth : intrinsicHeight);
  const aspect = baseH / baseW;

  const maxWByPixels = Math.floor(
    Math.sqrt(SAFE_CLAMP_PIXELS / Math.max(0.01, aspect))
  );
  const maxWBySide =
    aspect >= 1
      ? Math.floor(SAFE_MAX_SIDE / aspect)
      : SAFE_MAX_SIDE;

  // Subtract 2px safety margin so Math.ceil inside PDFium never crosses 4096 or 12.5MP
  const hardMaxW = Math.max(64, Math.min(maxWByPixels - 2, maxWBySide - 2, SAFE_MAX_SIDE));
  return Math.max(64, Math.min(Math.round(desiredWidth), hardMaxW));
}

function closeCurrentDocument(): void {
  renderQueue.length = 0;
  if (activeOpenAbort) {
    activeOpenAbort.abort();
    activeOpenAbort = null;
  }
  if (activeDoc) {
    try {
      activeDoc.destroy();
    } catch {
      // Ignore already destroyed
    }
    activeDoc = null;
  }
}

async function processRenderQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  try {
    while (renderQueue.length > 0 && activeDoc) {
      // Sort so highest priority runs first, and newest job (LIFO) wins ties
      renderQueue.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return b.enqueuedAt - a.enqueuedAt;
      });

      const job = renderQueue.shift();
      if (!job || !activeDoc) break;

      try {
        const page = activeDoc.page(job.pageNumber);
        const safeWidth = clampSafeRenderWidth(
          page.width,
          page.height,
          page.rotation,
          job.extraRotate,
          job.desiredWidth
        );

        const rendered = page.render({
          width: safeWidth,
          background: 'white',
          forms: true,
          rotate: job.extraRotate,
        });

        const { width, height, rgba } = rendered;

        if (typeof createImageBitmap === 'function' && typeof ImageData !== 'undefined') {
          const clamped = new Uint8ClampedArray(rgba);
          const imgData = new ImageData(clamped, width, height);
          const bitmap = await createImageBitmap(imgData);
          const msg: PdfWorkerResponse = {
            type: 'RENDER_SUCCESS',
            jobId: job.jobId,
            pageNumber: job.pageNumber,
            width,
            height,
            extraRotate: job.extraRotate,
            bitmap,
          };
          workerScope.postMessage(msg, [bitmap]);
        } else {
          // 5-line fallback transferring raw RGBA ArrayBuffer for older Android/iOS WebViews
          const copy = new Uint8Array(rgba).buffer;
          const msg: PdfWorkerResponse = {
            type: 'RENDER_SUCCESS',
            jobId: job.jobId,
            pageNumber: job.pageNumber,
            width,
            height,
            extraRotate: job.extraRotate,
            rgbaBuffer: copy,
          };
          workerScope.postMessage(msg, [copy]);
        }
      } catch (err) {
        const info = classifyPdfError(err);
        const errMsg: PdfWorkerResponse = {
          type: 'RENDER_ERROR',
          jobId: job.jobId,
          pageNumber: job.pageNumber,
          errorCode:
            info.code === 'BUDGET'
              ? 'BUDGET'
              : info.code === 'FORMAT'
              ? 'FORMAT'
              : 'UNKNOWN',
          message: info.message,
        };
        workerScope.postMessage(errMsg);
      }

      // Yield briefly between pages soCANCEL_OFFSCREEN messages arrive mid-burst
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  } finally {
    isProcessingQueue = false;
  }
}

workerScope.onmessage = async (event: MessageEvent<PdfWorkerRequest>) => {
  const msg = event.data;
  if (!msg) return;

  switch (msg.type) {
    case 'OPEN_BUFFER':
    case 'OPEN_URL': {
      closeCurrentDocument();
      const abortController = new AbortController();
      activeOpenAbort = abortController;

      try {
        const engine = await ensureEngine(msg.wasmUrl);
        const doc =
          msg.type === 'OPEN_BUFFER'
            ? await engine.open(msg.buffer, {
                password: msg.password,
                signal: abortController.signal,
              })
            : await engine.open(msg.url, {
                password: msg.password,
                signal: abortController.signal,
                fetchTimeoutMs: msg.fetchTimeoutMs ?? 30_000,
                fetchMaxBytes: msg.fetchMaxBytes ?? 64 * 1024 * 1024,
              });

        if (abortController.signal.aborted) {
          doc.destroy();
          return;
        }

        activeDoc = doc;
        const pageCount = doc.pageCount;
        const pages: PdfPageDimension[] = [];
        for (let p = 1; p <= pageCount; p++) {
          const pg = doc.page(p);
          pages.push({
            pageNumber: p,
            width: pg.width || 595,
            height: pg.height || 842,
            rotation: pg.rotation,
          });
        }

        const res: PdfWorkerResponse = {
          type: 'OPEN_SUCCESS',
          requestId: msg.requestId,
          pageCount,
          pages,
          title: doc.metadata?.title,
        };
        workerScope.postMessage(res);
      } catch (err) {
        const classified = classifyPdfError(err);
        const errRes: PdfWorkerResponse = {
          type: 'OPEN_ERROR',
          requestId: msg.requestId,
          errorCode: classified.code,
          message: classified.message,
        };
        workerScope.postMessage(errRes);
      }
      break;
    }

    case 'RENDER_PAGE': {
      // Deduplicate any stale queued render for the same pageNumber
      for (let i = renderQueue.length - 1; i >= 0; i--) {
        if (renderQueue[i].pageNumber === msg.pageNumber) {
          renderQueue.splice(i, 1);
        }
      }
      renderQueue.push({
        jobId: msg.jobId,
        pageNumber: msg.pageNumber,
        desiredWidth: msg.desiredWidth,
        extraRotate: msg.extraRotate,
        priority: msg.priority,
        enqueuedAt: performance.now(),
      });
      void processRenderQueue();
      break;
    }

    case 'CANCEL_OFFSCREEN': {
      const keep = new Set(msg.keepPages);
      for (let i = renderQueue.length - 1; i >= 0; i--) {
        if (!keep.has(renderQueue[i].pageNumber)) {
          renderQueue.splice(i, 1);
        }
      }
      break;
    }

    case 'CANCEL_ALL_RENDERS': {
      renderQueue.length = 0;
      break;
    }

    case 'CLOSE_DOCUMENT': {
      closeCurrentDocument();
      break;
    }

    case 'DESTROY': {
      closeCurrentDocument();
      if (sharedEngine) {
        try {
          await sharedEngine.destroy();
        } catch {
          // Ignore
        }
        sharedEngine = null;
      }
      workerScope.postMessage({ type: 'DESTROYED' } satisfies PdfWorkerResponse);
      break;
    }
  }
};
