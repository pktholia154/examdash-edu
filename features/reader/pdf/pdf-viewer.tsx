'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  Loader2,
  Lock,
  Minus,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  Sunset,
} from 'lucide-react';
import type { PublicBookDTO } from '../../../lib/types/catalog';
import { fetchClientStorageBytes } from '../../../lib/firebase/storage-client';
import { readBookFormatOffline } from '../../../lib/offline/offline-vault';
import { cn } from '../../../lib/utils';
import {
  getPdfCanvasWindowRadius,
  getPdfNeighborMaxDpr,
  readOfflineAsset,
  readStoredJsonSync,
  registerLifecycleFlush,
  writeStoredJsonSync,
  type PdfReadingProgress,
  type ReaderComfortTheme,
} from '../shared/platform-adapter';
import {
  ReaderTopBar,
  type ReaderTopBarProps,
} from '../shared/reader-top-bar';
import { SampleUnlockCard } from '../shared/sample-unlock-card';
import type {
  PdfPageDimension,
  PdfWorkerRequest,
  PdfWorkerResponse,
} from './pdf-render.worker';

export interface PdfViewerProps {
  book: PublicBookDTO;
  streamUrl: string;
  fullStoragePath?: string;
  directStreamUrl?: string;
  isSample: boolean;
  userId?: string;
  preferOffline?: boolean;
  bearerTokenProvider?: () => Promise<string | null>;
  onRefreshSignedUrl?: () => Promise<string | null>;
  onSwitchToFullMode?: () => void;
  topBar?: ReaderTopBarProps;
}

interface RenderedCanvasMeta {
  renderedWidth: number;
  renderedDpr: number;
  extraRotate: 0 | 90 | 180 | 270;
}

const MIN_ZOOM = 1.0;
const MAX_ZOOM = 3.5;
const PINCH_DEADZONE_PX = 8;
const PINCH_DAMPED_GAIN = 0.82;
const FINGER_LIFT_COOLDOWN_MS = 140;
const PHASE2_SETTLE_MS = 180;
const SCROLL_IDLE_SHARPEN_MS = 150;
const FETCH_TIMEOUT_MS = 35_000;
const FETCH_MAX_BYTES = 64 * 1024 * 1024;

export function PdfViewer({
  book,
  streamUrl,
  fullStoragePath,
  directStreamUrl,
  isSample,
  userId,
  preferOffline = false,
  bearerTokenProvider,
  onRefreshSignedUrl,
  onSwitchToFullMode,
  topBar,
}: PdfViewerProps) {
  const progressKey = `ed-pdf-prog-v1:${book.id}:${isSample ? 'sample' : 'full'}`;
  const vaultKey = `pdf_${book.id}_sample.pdf`;

  const savedInitial = useMemo(
    () => readStoredJsonSync<PdfReadingProgress>(progressKey),
    [progressKey]
  );

  const [pages, setPages] = useState<PdfPageDimension[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(
    savedInitial?.pageIndex ?? 1
  );
  const [zoomScale, setZoomScale] = useState<number>(() => {
    const z = savedInitial?.zoomScale ?? 1.0;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  });
  const [livePreviewZoom, setLivePreviewZoom] = useState<number | null>(null);
  const [comfortTheme, setComfortTheme] = useState<ReaderComfortTheme>(
    savedInitial?.comfortTheme ?? 'light'
  );

  const [loadingState, setLoadingState] = useState<
    'loading' | 'ready' | 'password' | 'error'
  >('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [submittedPassword, setSubmittedPassword] = useState<string | undefined>(
    undefined
  );

  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 780
  );
  const [isDraggingMouse, setIsDraggingMouse] = useState(false);

  const rootContainerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasMapRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pageSlotMapRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderedMetaRef = useRef<Map<number, RenderedCanvasMeta>>(new Map());

  const workerRef = useRef<Worker | null>(null);
  const pdfBytesCacheRef = useRef<ArrayBuffer | null>(null);
  const workerRespawnCountRef = useRef<number>(0);
  const jobCounterRef = useRef<number>(0);

  const [reloadNonce, setReloadNonce] = useState(0);
  const zoomScaleRef = useRef<number>(zoomScale);
  const currentPageRef = useRef<number>(currentPage);
  const submittedPasswordRef = useRef<string | undefined>(submittedPassword);
  const bearerTokenProviderRef = useRef(bearerTokenProvider);
  const onRefreshSignedUrlRef = useRef(onRefreshSignedUrl);
  const streamUrlRef = useRef(streamUrl);
  const fullStoragePathRef = useRef(fullStoragePath);
  const directStreamUrlRef = useRef(directStreamUrl);
  const flushProgressRef = useRef<() => void>(() => {});
  const pageLayoutItemsRef = useRef<
    Array<{ pageNumber: number; cssWidth: number; cssHeight: number; top: number }>
  >([]);

  useEffect(() => {
    zoomScaleRef.current = zoomScale;
  }, [zoomScale]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    submittedPasswordRef.current = submittedPassword;
  }, [submittedPassword]);

  useEffect(() => {
    bearerTokenProviderRef.current = bearerTokenProvider;
  }, [bearerTokenProvider]);

  useEffect(() => {
    onRefreshSignedUrlRef.current = onRefreshSignedUrl;
  }, [onRefreshSignedUrl]);

  useEffect(() => {
    streamUrlRef.current = streamUrl;
    fullStoragePathRef.current = fullStoragePath;
    directStreamUrlRef.current = directStreamUrl;
  }, [directStreamUrl, fullStoragePath, streamUrl]);

  const hasStreamTarget = Boolean(
    streamUrl || fullStoragePath || directStreamUrl
  );

  const initialRestoredRef = useRef<boolean>(false);
  const pendingFocalCommitRef = useRef<{
    focalDocX: number;
    focalDocY: number;
    focalClientX: number;
    focalClientY: number;
    oldZoom: number;
    newZoom: number;
  } | null>(null);

  // Gesture state refs (zero React re-renders during 60fps Phase-1 live pinch)
  const pinchStateRef = useRef<{
    active: boolean;
    deadzonePassed: boolean;
    startDist: number;
    startZoom: number;
    focalClientX: number;
    focalClientY: number;
    focalStageX: number;
    focalStageY: number;
    lastRatio: number;
  } | null>(null);
  const fingerLiftCooldownUntilRef = useRef<number>(0);
  const phase2TimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinchRafRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({
    time: 0,
    x: 0,
    y: 0,
  });
  const mouseDragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  const scrollSharpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const progressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Full-width on mobile (0 side margin); generous unboxed width on tablet/desktop
  const isCompactViewport = viewportWidth < 640;
  const baseFitCssWidth = useMemo(() => {
    if (viewportWidth < 640) {
      return Math.max(240, Math.floor(viewportWidth));
    }
    return Math.max(320, Math.min(1100, Math.floor(viewportWidth - 16)));
  }, [viewportWidth]);

  // Compute CSS dimensions per 1-indexed page
  const pageLayoutMetrics = useMemo(() => {
    let currentTop = isCompactViewport ? 4 : 8;
    let maxCssW = 0;
    const gapPx = isCompactViewport ? 8 : 12;
    const list: Array<{
      pageNumber: number;
      cssWidth: number;
      cssHeight: number;
      top: number;
    }> = [];

    for (const pg of pages) {
      const totalRot = pg.rotation % 360;
      const swapped = totalRot === 90 || totalRot === 270;
      const intrinsicW = Math.max(1, swapped ? pg.height : pg.width);
      const intrinsicH = Math.max(1, swapped ? pg.width : pg.height);
      const aspect = intrinsicH / intrinsicW;

      const cssWidth = Math.round(baseFitCssWidth * zoomScale);
      const cssHeight = Math.max(1, Math.round(cssWidth * aspect));
      if (cssWidth > maxCssW) maxCssW = cssWidth;

      const top = currentTop;
      currentTop += cssHeight + gapPx;

      list.push({
        pageNumber: pg.pageNumber,
        cssWidth,
        cssHeight,
        top,
      });
    }

    return {
      items: list,
      maxPageCssWidth: maxCssW,
      totalHeight: currentTop,
    };
  }, [baseFitCssWidth, isCompactViewport, pages, zoomScale]);

  useEffect(() => {
    pageLayoutItemsRef.current = pageLayoutMetrics.items;
  }, [pageLayoutMetrics.items]);

  // Measure .pdf-viewport width & maintain reading anchor on orientation/resize
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const updateWidth = () => {
      const nextW = vp.clientWidth;
      if (nextW > 0) {
        setViewportWidth((prev) => (Math.abs(prev - nextW) >= 2 ? nextW : prev));
      }
    };

    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => updateWidth());
    ro.observe(vp);
    return () => ro.disconnect();
  }, []);

  // Flush exact 2D reading progress
  const flushProgressNow = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || pages.length === 0) return;

    const maxScrollX = Math.max(1, vp.scrollWidth - vp.clientWidth);
    const maxScrollY = Math.max(1, vp.scrollHeight - vp.clientHeight);
    const payload: PdfReadingProgress = {
      pageIndex: currentPageRef.current,
      scrollRatioX:
        vp.scrollWidth > vp.clientWidth
          ? Math.min(1, Math.max(0, vp.scrollLeft / maxScrollX))
          : 0,
      scrollRatioY:
        vp.scrollHeight > vp.clientHeight
          ? Math.min(1, Math.max(0, vp.scrollTop / maxScrollY))
          : 0,
      zoomScale: zoomScaleRef.current,
      comfortTheme,
      updatedAt: Date.now(),
    };
    writeStoredJsonSync(progressKey, payload);
  }, [comfortTheme, pages.length, progressKey]);

  const scheduleProgressSave = useCallback(() => {
    if (progressDebounceRef.current) {
      clearTimeout(progressDebounceRef.current);
    }
    progressDebounceRef.current = setTimeout(() => {
      flushProgressNow();
    }, 1000);
  }, [flushProgressNow]);

  useEffect(() => {
    flushProgressRef.current = flushProgressNow;
    return registerLifecycleFlush(flushProgressNow);
  }, [flushProgressNow]);

  // Evict offscreen canvases when backgrounded to protect mobile RAM
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        const active = currentPageRef.current;
        canvasMapRef.current.forEach((canvas, pNum) => {
          if (Math.abs(pNum - active) > 1) {
            canvas.width = 0;
            canvas.height = 0;
            renderedMetaRef.current.delete(pNum);
          }
        });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Two-Tier DPR Rendering & Bidirectional Eviction Scheduler
  const scheduleWindowRenders = useCallback(
    (upgradeNeighborsToHighDpr: boolean) => {
      const worker = workerRef.current;
      if (!worker || pageLayoutMetrics.items.length === 0) return;

      const center = currentPageRef.current;
      const radius = getPdfCanvasWindowRadius();
      const deviceDpr =
        typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const nativeDpr = Math.min(deviceDpr, 3.0);
      const neighborDpr = upgradeNeighborsToHighDpr
        ? nativeDpr
        : Math.min(deviceDpr, getPdfNeighborMaxDpr());

      const minKeep = Math.max(1, center - radius);
      const maxKeep = Math.min(pageLayoutMetrics.items.length, center + radius);

      // 1. Bidirectional Canvas Eviction outside current ± radius
      canvasMapRef.current.forEach((canvas, pNum) => {
        if (pNum < minKeep || pNum > maxKeep) {
          if (canvas.width !== 0 || canvas.height !== 0) {
            canvas.width = 0;
            canvas.height = 0;
          }
          renderedMetaRef.current.delete(pNum);
        }
      });

      const keepPages: number[] = [];
      for (let p = minKeep; p <= maxKeep; p++) {
        keepPages.push(p);
      }
      worker.postMessage({
        type: 'CANCEL_OFFSCREEN',
        keepPages,
      } satisfies PdfWorkerRequest);

      // 2. Center-Out Dispatch (outer neighbors first, active center last for LIFO priority)
      const orderedOffsets: number[] = [];
      for (let dist = radius; dist >= 1; dist--) {
        if (center - dist >= minKeep) orderedOffsets.push(center - dist);
        if (center + dist <= maxKeep) orderedOffsets.push(center + dist);
      }
      orderedOffsets.push(center);

      for (const pageNum of orderedOffsets) {
        const metric = pageLayoutMetrics.items[pageNum - 1];
        if (!metric) continue;

        const isPrimary = Math.abs(pageNum - center) <= 1;
        const effectiveDpr = isPrimary ? nativeDpr : neighborDpr;
        const desiredWidth = Math.round(metric.cssWidth * effectiveDpr);

        const existing = renderedMetaRef.current.get(pageNum);
        if (
          existing &&
          existing.extraRotate === 0 &&
          Math.abs(existing.renderedWidth - desiredWidth) <= 4
        ) {
          continue;
        }

        const jobId = `job_${++jobCounterRef.current}_p${pageNum}`;
        worker.postMessage({
          type: 'RENDER_PAGE',
          jobId,
          pageNumber: pageNum,
          desiredWidth,
          extraRotate: 0,
          priority: isPrimary ? 2 : 1,
        } satisfies PdfWorkerRequest);
      }
    },
    [pageLayoutMetrics.items]
  );

  // Spawn / Auto-Respawn Worker & Paint Incoming Frames
  const createAndBindWorker = useCallback(() => {
    function spawnWorkerInstance(): Worker {
      if (workerRef.current) {
        try {
          workerRef.current.postMessage({
            type: 'DESTROY',
          } satisfies PdfWorkerRequest);
          workerRef.current.terminate();
        } catch {
          // Ignore
        }
        workerRef.current = null;
      }

      const worker = new Worker(
        new URL('./pdf-render.worker.ts', import.meta.url)
      );
      workerRef.current = worker;

      worker.onmessage = (ev: MessageEvent<PdfWorkerResponse>) => {
        const data = ev.data;
        if (!data) return;

        if (data.type === 'OPEN_SUCCESS') {
          renderedMetaRef.current.clear();
          setPages(data.pages);
          setLoadingState('ready');
          setErrorMessage('');
          return;
        }

        if (data.type === 'OPEN_ERROR') {
          if (data.errorCode === 'PASSWORD') {
            setLoadingState('password');
            setErrorMessage(data.message);
          } else {
            setLoadingState('error');
            setErrorMessage(data.message);
          }
          return;
        }

        if (data.type === 'RENDER_SUCCESS') {
          const canvas = canvasMapRef.current.get(data.pageNumber);
          if (!canvas) {
            data.bitmap?.close();
            return;
          }

          canvas.width = data.width;
          canvas.height = data.height;
          const ctx = canvas.getContext('2d', { alpha: false });
          if (ctx) {
            if (data.bitmap) {
              ctx.drawImage(data.bitmap, 0, 0, data.width, data.height);
              data.bitmap.close();
            } else if (data.rgbaBuffer && typeof ImageData !== 'undefined') {
              const clamped = new Uint8ClampedArray(data.rgbaBuffer);
              const imgData = new ImageData(clamped, data.width, data.height);
              ctx.putImageData(imgData, 0, 0);
            }
          } else {
            data.bitmap?.close();
          }

          const metric = pageLayoutItemsRef.current[data.pageNumber - 1];
          const actualDpr = metric
            ? data.width / Math.max(1, metric.cssWidth)
            : 1;

          renderedMetaRef.current.set(data.pageNumber, {
            renderedWidth: data.width,
            renderedDpr: actualDpr,
            extraRotate: data.extraRotate,
          });
        }
      };

      worker.onerror = () => {
        if (
          workerRespawnCountRef.current < 2 &&
          pdfBytesCacheRef.current &&
          typeof window !== 'undefined'
        ) {
          workerRespawnCountRef.current += 1;
          renderedMetaRef.current.clear();
          const respawned = spawnWorkerInstance();
          const copy = pdfBytesCacheRef.current.slice(0);
          const wasmUrl = `${window.location.origin}/wasm/pdfium.wasm`;
          respawned.postMessage(
            {
              type: 'OPEN_BUFFER',
              requestId: `respawn_${Date.now()}`,
              wasmUrl,
              buffer: copy,
              password: submittedPasswordRef.current,
            } satisfies PdfWorkerRequest,
            [copy]
          );
        } else {
          setLoadingState('error');
          setErrorMessage(
            'PDF rendering engine encountered an unexpected memory error.'
          );
        }
      };

      return worker;
    }

    return spawnWorkerInstance();
  }, []);

  // Fetch PDF Bytes (Offline Vault <-> Verified Online Stream w/ Silent 401/403 Refresh) & Open in Worker
  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    const timeoutId = setTimeout(
      () => abortController.abort(),
      FETCH_TIMEOUT_MS
    );

    const readFromLocalVault = async (): Promise<ArrayBuffer | null> => {
      if (!isSample) {
        if (!userId) return null;
        return readBookFormatOffline(userId, book.id, 'pdf');
      }
      return readOfflineAsset(vaultKey);
    };

    const fetchOnlinePdfStream = async (): Promise<ArrayBuffer> => {
      let resolvedUrl = streamUrlRef.current;
      const activeStoragePath = fullStoragePathRef.current;
      const activeDirectUrl = directStreamUrlRef.current;

      if (!resolvedUrl && !isSample && onRefreshSignedUrlRef.current) {
        resolvedUrl = (await onRefreshSignedUrlRef.current()) || '';
      }

      const fetchWithUrl = async (targetUrl: string): Promise<Response> => {
        const headers: Record<string, string> = {};
        const tokenProvider = bearerTokenProviderRef.current;
        if (tokenProvider) {
          const token = await tokenProvider();
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          }
        }
        return fetch(targetUrl, {
          method: 'GET',
          headers,
          signal: abortController.signal,
        });
      };

      let primaryError: Error | null = null;

      if (resolvedUrl) {
        try {
          let res = await fetchWithUrl(resolvedUrl);

          if (
            res.status === 401 &&
            !isSample &&
            onRefreshSignedUrlRef.current
          ) {
            const refreshedUrl = await onRefreshSignedUrlRef.current();
            if (refreshedUrl) {
              streamUrlRef.current = refreshedUrl;
              res = await fetchWithUrl(refreshedUrl);
            }
          }

          if (res.ok) {
            const contentLen = Number(res.headers.get('content-length') || '0');
            if (contentLen > FETCH_MAX_BYTES) {
              throw new Error(
                'PDF file exceeds the 64 MB safe download budget.'
              );
            }
            return await res.arrayBuffer();
          }

          const errPayload = (await res.json().catch(() => null)) as
            | { error?: string | { message?: string } }
            | null;
          const parsedErr =
            typeof errPayload?.error === 'string'
              ? errPayload.error
              : typeof errPayload?.error?.message === 'string'
              ? errPayload.error.message
              : '';
          primaryError = new Error(
            parsedErr || `Failed to load PDF stream (HTTP ${res.status}).`
          );

          if (isSample || (!activeStoragePath && !activeDirectUrl)) {
            throw primaryError;
          }
        } catch (streamErr) {
          if (abortController.signal.aborted || isSample) {
            throw streamErr;
          }
          primaryError =
            primaryError ??
            (streamErr instanceof Error
              ? streamErr
              : new Error('Failed to load PDF stream.'));
          if (!activeStoragePath && !activeDirectUrl) {
            throw primaryError;
          }
        }
      }

      if (!isSample && activeStoragePath) {
        try {
          return await fetchClientStorageBytes(
            activeStoragePath,
            abortController.signal
          );
        } catch (storageErr) {
          if (abortController.signal.aborted) {
            throw storageErr;
          }
          primaryError =
            primaryError ??
            (storageErr instanceof Error
              ? storageErr
              : new Error('Unable to access PDF in Firebase Storage.'));
          if (!activeDirectUrl) {
            throw primaryError;
          }
        }
      }

      if (!isSample && activeDirectUrl) {
        const directRes = await fetch(activeDirectUrl, {
          method: 'GET',
          signal: abortController.signal,
        });
        if (directRes.ok) {
          return directRes.arrayBuffer();
        }
      }

      if (primaryError) {
        throw primaryError;
      }

      throw new Error('No PDF stream URL configured for this book.');
    };

    const runLoad = async () => {
      await Promise.resolve();
      if (cancelled) return;

      setLoadingState('loading');
      setErrorMessage('');

      try {
        let pdfBuffer: ArrayBuffer | null = null;
        const offlineFirst =
          isSample ||
          preferOffline ||
          (typeof navigator !== 'undefined' && !navigator.onLine);

        if (offlineFirst) {
          pdfBuffer = await readFromLocalVault();
          if (cancelled) return;
          if (
            !pdfBuffer &&
            (typeof navigator === 'undefined' || navigator.onLine)
          ) {
            pdfBuffer = await fetchOnlinePdfStream();
          }
          if (!pdfBuffer) {
            throw new Error(
              'This PDF is not saved offline on this device yet. Reconnect to read online.'
            );
          }
        } else {
          try {
            pdfBuffer = await fetchOnlinePdfStream();
          } catch (onlineErr) {
            if (cancelled) return;
            const vaultFallback = await readFromLocalVault();
            if (vaultFallback) {
              pdfBuffer = vaultFallback;
            } else {
              throw onlineErr;
            }
          }
        }

        if (cancelled) return;
        pdfBytesCacheRef.current = pdfBuffer;
        const worker = workerRef.current ?? createAndBindWorker();
        const transferableCopy = pdfBuffer.slice(0);
        const wasmUrl = `${window.location.origin}/wasm/pdfium.wasm`;

        worker.postMessage(
          {
            type: 'OPEN_BUFFER',
            requestId: `open_${Date.now()}`,
            wasmUrl,
            buffer: transferableCopy,
            password: submittedPassword,
          } satisfies PdfWorkerRequest,
          [transferableCopy]
        );
      } catch (err) {
        if (cancelled) return;
        if (abortController.signal.aborted) {
          setLoadingState('error');
          setErrorMessage(
            'Timed out loading PDF stream. Check your connection and retry.'
          );
        } else {
          setLoadingState('error');
          setErrorMessage(
            err instanceof Error ? err.message : 'Unable to load PDF document.'
          );
        }
      } finally {
        clearTimeout(timeoutId);
      }
    };

    void runLoad();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [
    book.id,
    createAndBindWorker,
    hasStreamTarget,
    isSample,
    preferOffline,
    reloadNonce,
    submittedPassword,
    userId,
    vaultKey,
  ]);

  // Strict Unmount Cleanup (pdf.destroy() & engine.destroy())
  useEffect(() => {
    return () => {
      flushProgressRef.current();
      const w = workerRef.current;
      workerRef.current = null;
      if (w) {
        try {
          w.postMessage({ type: 'DESTROY' } satisfies PdfWorkerRequest);
          setTimeout(() => w.terminate(), 60);
        } catch {
          // Ignore
        }
      }
    };
  }, []);

  // Restore exact 2D Sub-Page Progress once layout metrics mount
  useEffect(() => {
    if (
      loadingState !== 'ready' ||
      pageLayoutMetrics.items.length === 0 ||
      initialRestoredRef.current
    ) {
      return;
    }
    initialRestoredRef.current = true;
    const vp = viewportRef.current;
    if (vp && savedInitial) {
      requestAnimationFrame(() => {
        const maxX = Math.max(0, vp.scrollWidth - vp.clientWidth);
        const maxY = Math.max(0, vp.scrollHeight - vp.clientHeight);
        if (savedInitial.scrollRatioY > 0 && maxY > 0) {
          vp.scrollTop = Math.round(savedInitial.scrollRatioY * maxY);
          vp.scrollLeft = Math.round(savedInitial.scrollRatioX * maxX);
        } else if (savedInitial.pageIndex > 1) {
          const slot = pageLayoutMetrics.items[savedInitial.pageIndex - 1];
          if (slot) {
            vp.scrollTop = slot.top;
          }
        }
        scheduleWindowRenders(true);
      });
    } else {
      scheduleWindowRenders(true);
    }
  }, [loadingState, pageLayoutMetrics.items, savedInitial, scheduleWindowRenders]);

  // Commit Pending Focal Scroll Coordinates Synchronously After Zoom Commit
  useEffect(() => {
    const pending = pendingFocalCommitRef.current;
    const vp = viewportRef.current;
    const stage = stageRef.current;
    if (!pending || !vp) return;

    pendingFocalCommitRef.current = null;
    if (stage) {
      stage.style.transform = '';
      stage.style.willChange = 'auto';
    }

    const scaleRatio = pending.newZoom / Math.max(0.01, pending.oldZoom);
    vp.scrollLeft = Math.max(
      0,
      Math.round(pending.focalDocX * scaleRatio - pending.focalClientX)
    );
    vp.scrollTop = Math.max(
      0,
      Math.round(pending.focalDocY * scaleRatio - pending.focalClientY)
    );
  }, [zoomScale]);

  // Re-trigger renders when currentPage, zoomScale, or baseFitCssWidth changes
  useEffect(() => {
    if (loadingState !== 'ready') return;
    scheduleWindowRenders(false);
    if (scrollSharpenTimerRef.current) {
      clearTimeout(scrollSharpenTimerRef.current);
    }
    scrollSharpenTimerRef.current = setTimeout(() => {
      scheduleWindowRenders(true);
    }, SCROLL_IDLE_SHARPEN_MS);
  }, [
    baseFitCssWidth,
    currentPage,
    loadingState,
    scheduleWindowRenders,
    zoomScale,
  ]);

  // Native Scroll Handler -> Active Page Detection + 150ms Idle 3.0 DPR Upgrade
  const handleViewportScroll = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || pageLayoutMetrics.items.length === 0) return;

    const viewMidY = vp.scrollTop + vp.clientHeight * 0.38;
    let bestPage = 1;
    for (let i = 0; i < pageLayoutMetrics.items.length; i++) {
      const m = pageLayoutMetrics.items[i];
      if (viewMidY >= m.top) {
        bestPage = m.pageNumber;
      } else {
        break;
      }
    }

    if (bestPage !== currentPageRef.current) {
      currentPageRef.current = bestPage;
      setCurrentPage(bestPage);
    }

    if (scrollSharpenTimerRef.current) {
      clearTimeout(scrollSharpenTimerRef.current);
    }
    scrollSharpenTimerRef.current = setTimeout(() => {
      scheduleWindowRenders(true);
    }, SCROLL_IDLE_SHARPEN_MS);

    scheduleProgressSave();
  }, [pageLayoutMetrics.items, scheduleProgressSave, scheduleWindowRenders]);

  // Deterministic Focal Zoom Commit Helper
  const commitZoomAnchored = useCallback(
    (nextZoomRaw: number, clientX?: number, clientY?: number) => {
      const vp = viewportRef.current;
      const clamped = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, Math.round(nextZoomRaw * 100) / 100)
      );
      const oldZoom = zoomScaleRef.current;
      if (!vp || Math.abs(clamped - oldZoom) < 0.005) {
        const stage = stageRef.current;
        if (stage) {
          stage.style.transform = '';
          stage.style.willChange = 'auto';
        }
        setLivePreviewZoom(null);
        return;
      }

      const rect = vp.getBoundingClientRect();
      const focalClientX =
        clientX !== undefined ? clientX - rect.left : vp.clientWidth / 2;
      const focalClientY =
        clientY !== undefined ? clientY - rect.top : vp.clientHeight / 2;

      pendingFocalCommitRef.current = {
        focalDocX: vp.scrollLeft + focalClientX,
        focalDocY: vp.scrollTop + focalClientY,
        focalClientX,
        focalClientY,
        oldZoom,
        newZoom: clamped,
      };

      setLivePreviewZoom(null);
      setZoomScale(clamped);
      scheduleProgressSave();
    },
    [scheduleProgressSave]
  );

  // Damped Two-Phase Pinch Zoom + Ctrl/Meta Wheel Listeners
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        if (phase2TimerRef.current) {
          clearTimeout(phase2TimerRef.current);
          phase2TimerRef.current = null;
        }
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const startDist = Math.hypot(
          t0.clientX - t1.clientX,
          t0.clientY - t1.clientY
        );
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        const rect = vp.getBoundingClientRect();
        const focalClientX = midX - rect.left;
        const focalClientY = midY - rect.top;

        pinchStateRef.current = {
          active: true,
          deadzonePassed: false,
          startDist,
          startZoom: zoomScaleRef.current,
          focalClientX,
          focalClientY,
          focalStageX: vp.scrollLeft + focalClientX,
          focalStageY: vp.scrollTop + focalClientY,
          lastRatio: 1,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (
        e.touches.length === 1 &&
        performance.now() < fingerLiftCooldownUntilRef.current
      ) {
        e.preventDefault();
        return;
      }

      if (e.touches.length < 2 || !pinchStateRef.current?.active) return;

      e.preventDefault();

      const state = pinchStateRef.current;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(
        t0.clientX - t1.clientX,
        t0.clientY - t1.clientY
      );

      if (!state.deadzonePassed) {
        if (Math.abs(dist - state.startDist) < PINCH_DEADZONE_PX) {
          return;
        }
        state.deadzonePassed = true;
      }

      const rawRatio = dist / Math.max(1, state.startDist);
      const dampedRatio = 1 + (rawRatio - 1) * PINCH_DAMPED_GAIN;
      const unclampedTarget = state.startZoom * dampedRatio;
      const previewZoom = Math.min(
        MAX_ZOOM,
        Math.max(0.92, unclampedTarget)
      );
      const effectiveRatio = previewZoom / state.startZoom;
      state.lastRatio = effectiveRatio;

      if (pinchRafRef.current) cancelAnimationFrame(pinchRafRef.current);
      pinchRafRef.current = requestAnimationFrame(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const tx = state.focalStageX * (1 - effectiveRatio);
        const ty = state.focalStageY * (1 - effectiveRatio);
        stage.style.willChange = 'transform';
        stage.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${effectiveRatio})`;
        setLivePreviewZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, previewZoom)));
      });
    };

    const onTouchEnd = (e: TouchEvent) => {
      const state = pinchStateRef.current;
      if (!state?.active) return;

      if (e.touches.length < 2) {
        state.active = false;
        fingerLiftCooldownUntilRef.current =
          performance.now() + FINGER_LIFT_COOLDOWN_MS;

        if (!state.deadzonePassed) {
          pinchStateRef.current = null;
          return;
        }

        const targetZoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, state.startZoom * state.lastRatio)
        );
        const rect = vp.getBoundingClientRect();
        const clientX = rect.left + state.focalClientX;
        const clientY = rect.top + state.focalClientY;

        if (phase2TimerRef.current) clearTimeout(phase2TimerRef.current);
        phase2TimerRef.current = setTimeout(() => {
          requestAnimationFrame(() => {
            commitZoomAnchored(targetZoom, clientX, clientY);
          });
        }, PHASE2_SETTLE_MS);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const deltaFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const target = zoomScaleRef.current * deltaFactor;
      commitZoomAnchored(target, e.clientX, e.clientY);
    };

    vp.addEventListener('touchstart', onTouchStart, { passive: true });
    vp.addEventListener('touchmove', onTouchMove, { passive: false });
    vp.addEventListener('touchend', onTouchEnd, { passive: true });
    vp.addEventListener('touchcancel', onTouchEnd, { passive: true });
    vp.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      vp.removeEventListener('touchstart', onTouchStart);
      vp.removeEventListener('touchmove', onTouchMove);
      vp.removeEventListener('touchend', onTouchEnd);
      vp.removeEventListener('touchcancel', onTouchEnd);
      vp.removeEventListener('wheel', onWheel);
    };
  }, [commitZoomAnchored]);

  // Desktop Mouse Drag-to-Pan when zoomScale > 1.01
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (zoomScale <= 1.01 || e.button !== 0) return;
    const vp = viewportRef.current;
    if (!vp) return;
    mouseDragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: vp.scrollLeft,
      scrollTop: vp.scrollTop,
    };
    setIsDraggingMouse(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const drag = mouseDragRef.current;
    if (!drag.active) return;
    const vp = viewportRef.current;
    if (!vp) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      drag.moved = true;
    }
    vp.scrollLeft = drag.scrollLeft - dx;
    vp.scrollTop = drag.scrollTop - dy;
  };

  const stopMouseDrag = () => {
    if (mouseDragRef.current.active) {
      mouseDragRef.current.active = false;
      setIsDraggingMouse(false);
    }
  };

  // Smart Double-Tap (1.0x <-> 1.8x anchored to tapped point)
  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mouseDragRef.current.moved) {
      mouseDragRef.current.moved = false;
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input, label')) return;

    const now = performance.now();
    const prev = lastTapRef.current;
    const dist = Math.hypot(e.clientX - prev.x, e.clientY - prev.y);

    if (now - prev.time < 300 && dist < 36) {
      lastTapRef.current = { time: 0, x: 0, y: 0 };
      const nextZoom = zoomScaleRef.current > 1.15 ? 1.0 : 1.8;
      commitZoomAnchored(nextZoom, e.clientX, e.clientY);
      return;
    }

    lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
  };

  const displayedZoomPct = Math.round((livePreviewZoom ?? zoomScale) * 100);
  const stageMinWidthPx = Math.ceil(
    pageLayoutMetrics.maxPageCssWidth + (isCompactViewport ? 0 : 16)
  );

  return (
    <div
      ref={rootContainerRef}
      className={cn(
        'relative flex flex-col w-full h-full overflow-hidden select-none',
        comfortTheme === 'light' && 'ed-reader-skin-light pdf-comfort-light',
        comfortTheme === 'sepia' && 'ed-reader-skin-sepia pdf-comfort-sepia',
        comfortTheme === 'dark' && 'ed-reader-skin-dark pdf-comfort-dark'
      )}
      style={{ backgroundColor: 'var(--reader-bg)', color: 'var(--reader-ink)' }}
    >
      {/* Bar 1: Title, PDF/Markdown Toggle, Cross Button */}
      {topBar && <ReaderTopBar {...topBar} />}

      {/* Bar 2: Minimal Single-Row Controls — Page Count, +/- Zoom, Light/Sepia/Dark */}
      <div
        data-nosnippet=""
        className="flex items-center justify-between gap-1.5 w-full px-2.5 sm:px-4 py-1.5 border-b border-[var(--reader-border)] bg-[var(--reader-bg)] text-[var(--reader-ink)] shrink-0"
      >
        {/* Minimal Page Count */}
        <span className="text-xs font-semibold tabular-nums whitespace-nowrap text-[var(--reader-muted)]">
          {pages.length > 0 ? currentPage : 0} / {pages.length}
        </span>

        {/* Minimal +/- Zoom */}
        <div
          role="group"
          aria-label="PDF zoom controls"
          className="inline-flex items-center rounded-md border border-[var(--reader-border)] bg-[var(--reader-surface)] p-0.5 tabular-nums"
        >
          <button
            type="button"
            disabled={zoomScale <= MIN_ZOOM}
            onClick={() => commitZoomAnchored(zoomScale - 0.25)}
            aria-label="Zoom out"
            className="inline-flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 rounded hover:bg-[var(--reader-elevated)] disabled:opacity-40 transition-colors"
          >
            <Minus className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => commitZoomAnchored(1.0)}
            aria-label="Reset zoom to fit width"
            className="h-8 sm:h-9 px-1.5 sm:px-2.5 text-[11px] sm:text-xs font-semibold hover:bg-[var(--reader-elevated)] rounded transition-colors whitespace-nowrap"
          >
            {displayedZoomPct}%
          </button>
          <button
            type="button"
            disabled={zoomScale >= MAX_ZOOM}
            onClick={() => commitZoomAnchored(zoomScale + 0.25)}
            aria-label="Zoom in"
            className="inline-flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 rounded hover:bg-[var(--reader-elevated)] disabled:opacity-40 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Minimal Light / Sepia / Dark Theme Modes */}
        <div
          role="group"
          aria-label="Reading theme mode"
          className="inline-flex items-center rounded-md border border-[var(--reader-border)] bg-[var(--reader-surface)] p-0.5"
        >
          <button
            type="button"
            aria-pressed={comfortTheme === 'light'}
            onClick={() => {
              setComfortTheme('light');
              scheduleProgressSave();
            }}
            aria-label="Light mode"
            className={cn(
              'inline-flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 rounded transition-colors',
              comfortTheme === 'light'
                ? 'bg-[var(--reader-accent)] text-[var(--reader-accent-ink)]'
                : 'hover:bg-[var(--reader-elevated)]'
            )}
          >
            <Sun className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-pressed={comfortTheme === 'sepia'}
            onClick={() => {
              setComfortTheme('sepia');
              scheduleProgressSave();
            }}
            aria-label="Sepia mode"
            className={cn(
              'inline-flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 rounded transition-colors',
              comfortTheme === 'sepia'
                ? 'bg-[var(--reader-accent)] text-[var(--reader-accent-ink)]'
                : 'hover:bg-[var(--reader-elevated)]'
            )}
          >
            <Sunset className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-pressed={comfortTheme === 'dark'}
            onClick={() => {
              setComfortTheme('dark');
              scheduleProgressSave();
            }}
            aria-label="Dark mode"
            className={cn(
              'inline-flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 rounded transition-colors',
              comfortTheme === 'dark'
                ? 'bg-[var(--reader-accent)] text-[var(--reader-accent-ink)]'
                : 'hover:bg-[var(--reader-elevated)]'
            )}
          >
            <Moon className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Full-Width 2D Native Overflow Viewport */}
      <div
        ref={viewportRef}
        onScroll={handleViewportScroll}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopMouseDrag}
        onMouseLeave={stopMouseDrag}
        onClick={handleStageClick}
        className={cn(
          'pdf-viewport relative flex-1 w-full',
          zoomScale > 1.01 &&
            (isDraggingMouse ? 'cursor-grabbing' : 'cursor-grab')
        )}
        style={{
          touchAction: zoomScale > 1.01 ? 'pan-x pan-y' : 'pan-y',
          paddingBottom: 'var(--safe-area-inset-bottom)',
        }}
      >
        {loadingState === 'loading' && (
          <div className="flex flex-col items-center justify-center h-full min-h-[320px] p-6 text-center text-[var(--reader-ink)]">
            <Loader2
              className="w-6 h-6 animate-spin text-[var(--reader-muted)] mb-2.5"
              aria-hidden="true"
            />
            <p className="text-sm font-semibold">Loading PDF...</p>
          </div>
        )}

        {loadingState === 'password' && (
          <div className="flex flex-col items-center justify-center h-full min-h-[320px] p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSubmittedPassword(passwordInput);
              }}
              className="w-full max-w-sm rounded-xl border border-[var(--reader-border-strong)] bg-[var(--reader-bg)] p-5 text-[var(--reader-ink)] space-y-4"
            >
              <div className="flex items-center gap-2.5">
                <Lock className="w-5 h-5 text-[var(--reader-muted)]" aria-hidden="true" />
                <h3 className="text-base font-bold">Password-Protected PDF</h3>
              </div>
              <p className="text-xs text-[var(--reader-muted)]">{errorMessage}</p>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter document password"
                autoComplete="off"
                className="w-full min-h-[48px] px-3.5 rounded-lg border border-[var(--reader-border-strong)] bg-[var(--reader-surface)] text-base text-[var(--reader-ink)]"
              />
              <button
                type="submit"
                className="w-full min-h-[48px] rounded-lg bg-[var(--reader-accent)] text-[var(--reader-accent-ink)] text-sm font-semibold"
              >
                Unlock PDF
              </button>
            </form>
          </div>
        )}

        {loadingState === 'error' && (
          <div className="flex flex-col items-center justify-center h-full min-h-[320px] p-6 text-center text-[var(--reader-ink)]">
            <AlertCircle
              className="w-6 h-6 text-[var(--status-danger)] mb-2.5"
              aria-hidden="true"
            />
            <h3 className="text-base font-bold">Unable to Render PDF</h3>
            <p className="mt-1.5 text-xs sm:text-sm text-[var(--reader-muted)] max-w-md">
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={() => {
                setLoadingState('loading');
                setErrorMessage('');
                setReloadNonce((n) => n + 1);
              }}
              className="mt-5 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg bg-[var(--reader-accent)] text-[var(--reader-accent-ink)] text-sm font-semibold"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              <span>Retry Loading</span>
            </button>
          </div>
        )}

        {loadingState === 'ready' && pageLayoutMetrics.items.length > 0 && (
          <div
            ref={stageRef}
            className="pdf-stage py-1 px-0 sm:py-2 sm:px-2"
            style={{
              width: `max(100%, ${stageMinWidthPx}px)`,
            }}
          >
            {pageLayoutMetrics.items.map((slot) => (
              <div
                key={slot.pageNumber}
                ref={(el) => {
                  if (el) {
                    pageSlotMapRef.current.set(slot.pageNumber, el);
                  } else {
                    pageSlotMapRef.current.delete(slot.pageNumber);
                  }
                }}
                data-pdf-page={slot.pageNumber}
                className="relative mx-auto mb-2 sm:mb-3 bg-white overflow-hidden"
                style={{
                  width: `${slot.cssWidth}px`,
                  height: `${slot.cssHeight}px`,
                }}
              >
                <canvas
                  ref={(el) => {
                    if (el) {
                      canvasMapRef.current.set(slot.pageNumber, el);
                    } else {
                      canvasMapRef.current.delete(slot.pageNumber);
                    }
                  }}
                  aria-label={`${book.title} page ${slot.pageNumber}`}
                  className="block w-full h-full"
                  style={{
                    width: `${slot.cssWidth}px`,
                    height: `${slot.cssHeight}px`,
                  }}
                />
              </div>
            ))}

            {isSample && (
              <div className="px-2.5 sm:px-4 pb-6">
                <SampleUnlockCard
                  book={book}
                  formatLabel="PDF"
                  onUnlocked={onSwitchToFullMode}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live Pinch Zoom Indicator */}
      {livePreviewZoom !== null && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute top-24 left-1/2 -translate-x-1/2 z-20 rounded-md border border-[var(--reader-border-strong)] bg-[var(--reader-bg)]/95 px-3 py-1 text-xs font-bold tabular-nums text-[var(--reader-ink)] shadow-sm"
        >
          {Math.round(livePreviewZoom * 100)}%
        </div>
      )}
    </div>
  );
}
