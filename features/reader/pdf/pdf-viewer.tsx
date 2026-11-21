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
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Minus,
  Moon,
  Plus,
  RefreshCw,
  RotateCw,
  Sun,
  Sunset,
  Trash2,
} from 'lucide-react';
import type { PublicBookDTO } from '../../../lib/types/catalog';
import {
  deleteBookFormatOffline,
  hasBookFormatOffline,
  OFFLINE_VAULT_UPDATED_EVENT,
  readBookFormatOffline,
  saveBookFormatOffline,
} from '../../../lib/offline/offline-vault';
import { cn } from '../../../lib/utils';
import { useToast } from '../../toast/toast-context';
import {
  getPdfCanvasWindowRadius,
  getPdfNeighborMaxDpr,
  hasOfflineAsset,
  readOfflineAsset,
  readStoredJsonSync,
  registerLifecycleFlush,
  removeOfflineAsset,
  saveOfflineAsset,
  setPlatformImmersiveMode,
  writeStoredJsonSync,
  type PdfReadingProgress,
  type ReaderComfortTheme,
} from '../shared/platform-adapter';
import { SampleUnlockCard } from '../shared/sample-unlock-card';
import type {
  PdfPageDimension,
  PdfWorkerRequest,
  PdfWorkerResponse,
} from './pdf-render.worker';

export interface PdfViewerProps {
  book: PublicBookDTO;
  streamUrl: string;
  isSample: boolean;
  userId?: string;
  preferOffline?: boolean;
  bearerTokenProvider?: () => Promise<string | null>;
  onRefreshSignedUrl?: () => Promise<string | null>;
  onSwitchToFullMode?: () => void;
  embeddedHeightClass?: string;
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
  isSample,
  userId,
  preferOffline = false,
  bearerTokenProvider,
  onRefreshSignedUrl,
  onSwitchToFullMode,
  embeddedHeightClass = 'h-[78svh] min-h-[520px]',
}: PdfViewerProps) {
  const { showToast } = useToast();

  const progressKey = `ed-pdf-prog-v1:${book.id}:${isSample ? 'sample' : 'full'}`;
  const vaultKey = `pdf_${book.id}_${isSample ? 'sample' : 'full'}.pdf`;

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
  const [extraRotate, setExtraRotate] = useState<0 | 90 | 180 | 270>(0);
  const [comfortTheme, setComfortTheme] = useState<ReaderComfortTheme>(
    savedInitial?.comfortTheme ?? 'light'
  );
  const [hudVisible, setHudVisible] = useState(true);
  const [isImmersive, setIsImmersive] = useState(false);

  const [loadingState, setLoadingState] = useState<
    'loading' | 'ready' | 'password' | 'error'
  >('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [submittedPassword, setSubmittedPassword] = useState<string | undefined>(
    undefined
  );

  const [isSavedOffline, setIsSavedOffline] = useState(false);
  const [isSavingOffline, setIsSavingOffline] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(780);
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
  const extraRotateRef = useRef<0 | 90 | 180 | 270>(extraRotate);
  const submittedPasswordRef = useRef<string | undefined>(submittedPassword);
  const bearerTokenProviderRef = useRef(bearerTokenProvider);
  const onRefreshSignedUrlRef = useRef(onRefreshSignedUrl);
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
    extraRotateRef.current = extraRotate;
  }, [extraRotate]);

  useEffect(() => {
    submittedPasswordRef.current = submittedPassword;
  }, [submittedPassword]);

  useEffect(() => {
    bearerTokenProviderRef.current = bearerTokenProvider;
  }, [bearerTokenProvider]);

  useEffect(() => {
    onRefreshSignedUrlRef.current = onRefreshSignedUrl;
  }, [onRefreshSignedUrl]);

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

  // Base fit-to-width CSS width (at 1.0x zoom)
  const baseFitCssWidth = useMemo(() => {
    return Math.max(260, Math.min(920, Math.floor(viewportWidth - 24)));
  }, [viewportWidth]);

  // Compute CSS dimensions per 1-indexed page
  const pageLayoutMetrics = useMemo(() => {
    let currentTop = 12;
    let maxCssW = 0;
    const list: Array<{
      pageNumber: number;
      cssWidth: number;
      cssHeight: number;
      top: number;
    }> = [];

    for (const pg of pages) {
      const totalRot = (pg.rotation + extraRotate) % 360;
      const swapped = totalRot === 90 || totalRot === 270;
      const intrinsicW = Math.max(1, swapped ? pg.height : pg.width);
      const intrinsicH = Math.max(1, swapped ? pg.width : pg.height);
      const aspect = intrinsicH / intrinsicW;

      const cssWidth = Math.round(baseFitCssWidth * zoomScale);
      const cssHeight = Math.max(1, Math.round(cssWidth * aspect));
      if (cssWidth > maxCssW) maxCssW = cssWidth;

      const top = currentTop;
      currentTop += cssHeight + 16;

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
  }, [baseFitCssWidth, extraRotate, pages, zoomScale]);

  useEffect(() => {
    pageLayoutItemsRef.current = pageLayoutMetrics.items;
  }, [pageLayoutMetrics.items]);

  // Check offline vault status on mount & vault updates
  useEffect(() => {
    let active = true;
    const syncVaultState = async () => {
      const exists =
        !isSample && userId
          ? await hasBookFormatOffline(userId, book.id, 'pdf')
          : await hasOfflineAsset(vaultKey);
      if (active) setIsSavedOffline(exists);
    };
    void syncVaultState();
    window.addEventListener(OFFLINE_VAULT_UPDATED_EVENT, syncVaultState);
    return () => {
      active = false;
      window.removeEventListener(OFFLINE_VAULT_UPDATED_EVENT, syncVaultState);
    };
  }, [book.id, isSample, userId, vaultKey]);

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

  // Sync fullscreen exits initiated by browser Escape key
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && isImmersive) {
        setIsImmersive(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [isImmersive]);

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

      // 2. Center-Out Dispatch (enqueue outer neighbors first, then active center last for LIFO priority!)
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
          existing.extraRotate === extraRotateRef.current &&
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
          extraRotate: extraRotateRef.current,
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
        // Auto-respawn Worker on unexpected WASM OOM crash (up to 2 times)
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
      if (!isSample && userId) {
        const uidBuf = await readBookFormatOffline(userId, book.id, 'pdf');
        if (uidBuf) return uidBuf;
      }
      return readOfflineAsset(vaultKey);
    };

    const fetchOnlinePdfStream = async (): Promise<ArrayBuffer> => {
      let resolvedUrl = streamUrl;
      if (!resolvedUrl && !isSample && onRefreshSignedUrlRef.current) {
        resolvedUrl = (await onRefreshSignedUrlRef.current()) || '';
      }
      if (!resolvedUrl) {
        throw new Error('No PDF stream URL configured for this book.');
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

      let res = await fetchWithUrl(resolvedUrl);

      // Silent 401/403 expired signed-URL refresh retry before surfacing errors
      if (
        (res.status === 401 || res.status === 403) &&
        !isSample &&
        onRefreshSignedUrlRef.current
      ) {
        const refreshedUrl = await onRefreshSignedUrlRef.current();
        if (refreshedUrl) {
          res = await fetchWithUrl(refreshedUrl);
        }
      }

      if (!res.ok) {
        const errPayload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errPayload.error || `Failed to load PDF stream (HTTP ${res.status}).`
        );
      }

      const contentLen = Number(res.headers.get('content-length') || '0');
      if (contentLen > FETCH_MAX_BYTES) {
        throw new Error('PDF file exceeds the 64 MB safe download budget.');
      }

      return res.arrayBuffer();
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
              'This PDF is not saved offline on this device yet. Reconnect to read online or save offline.'
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
    isSample,
    preferOffline,
    reloadNonce,
    streamUrl,
    submittedPassword,
    userId,
    vaultKey,
  ]);

  // Strict Unmount Cleanup (pdf.destroy() & engine.destroy()) — ONLY on true component unmount
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

  // Commit Pending Focal Scroll Coordinates Synchronously After Zoom Commit (Zero Visual Snap!)
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

  // Re-trigger renders when currentPage, zoomScale, extraRotate, or baseFitCssWidth changes
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
    extraRotate,
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
      // 140ms Finger-Lift Cooldown prevents single-finger jump right after 2 -> 1 lift
      if (
        e.touches.length === 1 &&
        performance.now() < fingerLiftCooldownUntilRef.current
      ) {
        e.preventDefault();
        return;
      }

      if (e.touches.length < 2 || !pinchStateRef.current?.active) return;

      // Intercept ONLY 2+ fingers so 1-finger panning stays 100% OS-native
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
      // Soft rubber-band down to 0.92x during live gesture, snapping cleanly to 1.0x on commit
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

  // Smart Double-Tap (1.0x <-> 1.8x anchored to tapped column) & Single-Tap HUD Toggle
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

  // Fast Scrubber & Jump (instant scrollTo for jumps > 5 pages to prevent observer storms)
  const jumpToPage = useCallback(
    (targetPage: number) => {
      const vp = viewportRef.current;
      if (!vp || pageLayoutMetrics.items.length === 0) return;
      const clampedPage = Math.min(
        pageLayoutMetrics.items.length,
        Math.max(1, targetPage)
      );
      const slot = pageLayoutMetrics.items[clampedPage - 1];
      if (!slot) return;

      const distance = Math.abs(clampedPage - currentPageRef.current);
      currentPageRef.current = clampedPage;
      setCurrentPage(clampedPage);

      vp.scrollTo({
        top: Math.max(0, slot.top - 8),
        behavior: distance > 5 ? 'instant' : 'smooth',
      });
      scheduleProgressSave();
    },
    [pageLayoutMetrics.items, scheduleProgressSave]
  );

  const handleToggleImmersive = async () => {
    const next = !isImmersive;
    setIsImmersive(next);
    await setPlatformImmersiveMode(next, rootContainerRef.current);
  };

  const handleToggleOfflineVault = async () => {
    if (isSavedOffline) {
      if (!isSample && userId) {
        await deleteBookFormatOffline(userId, book.id, 'pdf');
      } else {
        await removeOfflineAsset(vaultKey);
      }
      setIsSavedOffline(false);
      showToast('Removed offline PDF copy from device vault.');
      return;
    }
    const buffer = pdfBytesCacheRef.current;
    if (!buffer) {
      showToast('Wait for the PDF stream to finish loading first.', 'danger');
      return;
    }
    setIsSavingOffline(true);
    try {
      if (!isSample && userId) {
        const ctrl = new AbortController();
        await saveBookFormatOffline({
          uid: userId,
          itemId: book.id,
          urlSlug: book.urlSlug,
          format: 'pdf',
          remoteUpdatedAtMs:
            new Date(book.updatedAtIso).getTime() || Date.now(),
          getIdToken: bearerTokenProviderRef.current || (async () => null),
          signal: ctrl.signal,
          prebuiltBuffer: buffer.slice(0),
        });
        setIsSavedOffline(true);
        showToast('Saved PDF to private offline study vault!', 'success');
      } else {
        const ok = await saveOfflineAsset(vaultKey, buffer);
        if (ok) {
          setIsSavedOffline(true);
          showToast('Saved PDF to private offline study vault!', 'success');
        } else {
          showToast('Unable to save offline copy on this browser.', 'danger');
        }
      }
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Unable to save offline copy on this device.',
        'danger'
      );
    } finally {
      setIsSavingOffline(false);
    }
  };

  const displayedZoomPct = Math.round((livePreviewZoom ?? zoomScale) * 100);
  const stageMinWidthPx = Math.ceil(pageLayoutMetrics.maxPageCssWidth + 24);

  return (
    <div
      ref={rootContainerRef}
      className={cn(
        'relative flex flex-col rounded-xl border border-[var(--reader-border,var(--border-subtle))] overflow-hidden select-none',
        comfortTheme === 'light' && 'ed-reader-skin-light pdf-comfort-light',
        comfortTheme === 'sepia' && 'ed-reader-skin-sepia pdf-comfort-sepia',
        comfortTheme === 'dark' && 'ed-reader-skin-dark pdf-comfort-dark',
        isImmersive
          ? 'fixed inset-0 z-50 h-[100dvh] w-screen rounded-none border-0'
          : embeddedHeightClass
      )}
      style={{ backgroundColor: 'var(--reader-bg)' }}
    >
      {/* Top Minimal HUD */}
      {hudVisible && (
        <div
          data-nosnippet=""
          className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b border-[var(--reader-border)] bg-[var(--reader-bg)] text-[var(--reader-ink)] shrink-0"
          style={{
            paddingTop: isImmersive
              ? 'calc(0.5rem + var(--safe-area-inset-top))'
              : undefined,
          }}
        >
          {/* Page Counter & Step Controls */}
          <div className="flex items-center gap-1.5 tabular-nums">
            <button
              type="button"
              disabled={currentPage <= 1 || pages.length === 0}
              onClick={() => jumpToPage(currentPage - 1)}
              aria-label="Previous page"
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="px-2 text-xs sm:text-sm font-semibold whitespace-nowrap">
              Page {pages.length > 0 ? currentPage : 0} / {pages.length}
            </span>
            <button
              type="button"
              disabled={currentPage >= pages.length || pages.length === 0}
              onClick={() => jumpToPage(currentPage + 1)}
              aria-label="Next page"
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Deterministic - | 100% | + Zoom Bar & Comfort Controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div
              role="group"
              aria-label="PDF zoom controls"
              className="inline-flex items-center rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] p-0.5 tabular-nums"
            >
              <button
                type="button"
                disabled={zoomScale <= MIN_ZOOM}
                onClick={() => commitZoomAnchored(zoomScale - 0.25)}
                aria-label="Zoom out"
                className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded-md hover:bg-[var(--reader-elevated)] disabled:opacity-40 transition-colors"
              >
                <Minus className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => commitZoomAnchored(1.0)}
                aria-label="Reset zoom to fit width"
                className="min-h-[40px] px-2.5 text-xs font-semibold hover:bg-[var(--reader-elevated)] rounded-md transition-colors whitespace-nowrap"
              >
                {displayedZoomPct}%
              </button>
              <button
                type="button"
                disabled={zoomScale >= MAX_ZOOM}
                onClick={() => commitZoomAnchored(zoomScale + 0.25)}
                aria-label="Zoom in"
                className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded-md hover:bg-[var(--reader-elevated)] disabled:opacity-40 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            {/* Rotate 90° */}
            <button
              type="button"
              onClick={() =>
                setExtraRotate(
                  (r) => (((r + 90) % 360) as 0 | 90 | 180 | 270)
                )
              }
              aria-label="Rotate pages 90 degrees"
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] transition-colors"
            >
              <RotateCw className="w-4 h-4" aria-hidden="true" />
            </button>

            {/* Zero-Cost Comfort Filter Switcher (Light / Sepia / Dark) */}
            <div
              role="group"
              aria-label="Reading comfort theme"
              className="inline-flex items-center rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] p-0.5"
            >
              <button
                type="button"
                aria-pressed={comfortTheme === 'light'}
                onClick={() => setComfortTheme('light')}
                aria-label="Light paper mode"
                className={cn(
                  'inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded-md transition-colors',
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
                onClick={() => setComfortTheme('sepia')}
                aria-label="Warm sepia mode"
                className={cn(
                  'inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded-md transition-colors',
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
                onClick={() => setComfortTheme('dark')}
                aria-label="Dark night mode"
                className={cn(
                  'inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded-md transition-colors',
                  comfortTheme === 'dark'
                    ? 'bg-[var(--reader-accent)] text-[var(--reader-accent-ink)]'
                    : 'hover:bg-[var(--reader-elevated)]'
                )}
              >
                <Moon className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            {/* Offline Vault Toggle */}
            <button
              type="button"
              disabled={isSavingOffline || loadingState !== 'ready'}
              onClick={() => void handleToggleOfflineVault()}
              aria-label={
                isSavedOffline
                  ? 'Remove offline PDF copy'
                  : 'Save PDF for offline reading'
              }
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] disabled:opacity-40 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              {isSavedOffline ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[var(--status-success)]" aria-hidden="true" />
                  <span className="hidden sm:inline">Offline Ready</span>
                  <Trash2 className="w-3 h-3 opacity-60 ms-0.5" aria-hidden="true" />
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {isSavingOffline ? 'Saving...' : 'Offline'}
                  </span>
                </>
              )}
            </button>

            {/* Fullscreen / Immersive Toggle */}
            <button
              type="button"
              onClick={() => void handleToggleImmersive()}
              aria-label={isImmersive ? 'Exit full screen' : 'Full screen reader'}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] transition-colors"
            >
              {isImmersive ? (
                <Minimize2 className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Maximize2 className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* 2D Native Overflow Viewport */}
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
        }}
      >
        {loadingState === 'loading' && (
          <div className="flex flex-col items-center justify-center h-full min-h-[360px] p-8 text-center text-[var(--reader-ink)]">
            <Loader2
              className="w-7 h-7 animate-spin text-[var(--reader-muted)] mb-3"
              aria-hidden="true"
            />
            <p className="text-sm font-semibold">
              Initializing PDFium WASM Engine & Streaming Pages...
            </p>
            <p className="mt-1 text-xs text-[var(--reader-muted)]">
              {isSample ? 'Loading sample extract' : 'Loading verified full edition'}
            </p>
          </div>
        )}

        {loadingState === 'password' && (
          <div className="flex flex-col items-center justify-center h-full min-h-[360px] p-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSubmittedPassword(passwordInput);
              }}
              className="w-full max-w-sm rounded-xl border border-[var(--reader-border-strong)] bg-[var(--reader-bg)] p-6 text-[var(--reader-ink)] space-y-4"
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
          <div className="flex flex-col items-center justify-center h-full min-h-[360px] p-8 text-center text-[var(--reader-ink)]">
            <AlertCircle
              className="w-7 h-7 text-[var(--status-danger)] mb-3"
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
              className="mt-5 inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--reader-accent)] text-[var(--reader-accent-ink)] text-sm font-semibold"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              <span>Retry Loading</span>
            </button>
          </div>
        )}

        {loadingState === 'ready' && pageLayoutMetrics.items.length > 0 && (
          <div
            ref={stageRef}
            className="pdf-stage py-3 px-3"
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
                className="relative mx-auto mb-4 rounded-sm bg-white shadow-xs overflow-hidden"
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
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-2 end-2.5 text-[11px] font-mono tabular-nums text-slate-500/80"
                >
                  {slot.pageNumber}
                </span>
              </div>
            ))}

            {/* Store-Safe End-of-Sample Unlock Card */}
            {isSample && (
              <div className="px-2 pb-6">
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

      {/* Live Pinch Zoom HUD Indicator */}
      {livePreviewZoom !== null && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 z-20 rounded-lg border border-[var(--reader-border-strong)] bg-[var(--reader-bg)]/95 px-3 py-1.5 text-xs font-bold tabular-nums text-[var(--reader-ink)] shadow-sm"
        >
          {Math.round(livePreviewZoom * 100)}%
        </div>
      )}

      {/* Fast Bottom Scrubber */}
      {hudVisible && loadingState === 'ready' && pages.length > 1 && (
        <div
          data-nosnippet=""
          className="flex items-center gap-3 px-4 py-2.5 border-t border-[var(--reader-border)] bg-[var(--reader-bg)] text-[var(--reader-ink)] shrink-0 tabular-nums"
          style={{
            paddingBottom: isImmersive
              ? 'calc(0.625rem + var(--safe-area-inset-bottom))'
              : undefined,
          }}
        >
          <label
            htmlFor={`pdf-scrubber-${book.id}`}
            className="text-xs font-semibold text-[var(--reader-muted)] whitespace-nowrap"
          >
            Jump
          </label>
          <input
            id={`pdf-scrubber-${book.id}`}
            type="range"
            min={1}
            max={pages.length}
            value={currentPage}
            onChange={(e) => jumpToPage(Number(e.target.value))}
            aria-label="Scrub through PDF pages"
            className="flex-1 h-2 accent-[var(--reader-accent)] cursor-pointer"
          />
          <button
            type="button"
            onClick={() => setHudVisible((v) => !v)}
            className="text-xs font-semibold text-[var(--reader-muted)] hover:text-[var(--reader-ink)] px-2 min-h-[36px] whitespace-nowrap"
          >
            Hide Bar
          </button>
        </div>
      )}

      {!hudVisible && (
        <button
          type="button"
          onClick={() => setHudVisible(true)}
          aria-label="Show reader controls"
          className="absolute top-3 end-3 z-20 min-h-[44px] px-3 rounded-lg border border-[var(--reader-border-strong)] bg-[var(--reader-bg)]/90 backdrop-blur-xs text-xs font-semibold text-[var(--reader-ink)]"
        >
          Controls
        </button>
      )}
    </div>
  );
}
