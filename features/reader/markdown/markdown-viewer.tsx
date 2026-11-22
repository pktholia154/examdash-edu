'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Menu,
  Minus,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Sunset,
  X,
} from 'lucide-react';
import type { PublicBookDTO } from '../../../lib/types/catalog';
import { fetchClientStorageBytes } from '../../../lib/firebase/storage-client';
import { readBookFormatOffline } from '../../../lib/offline/offline-vault';
import { cn } from '../../../lib/utils';
import {
  DiagramLightbox,
  type LightboxPayload,
} from '../shared/diagram-lightbox';
import {
  isTallScriptLanguage,
  openExternalReaderUrl,
  readOfflineAsset,
  readStoredJsonSync,
  registerLifecycleFlush,
  writeStoredJsonSync,
  type MarkdownFontMode,
  type MarkdownReadingProgress,
  type ReaderComfortTheme,
} from '../shared/platform-adapter';
import {
  ReaderTopBar,
  type ReaderTopBarProps,
} from '../shared/reader-top-bar';
import { SampleUnlockCard } from '../shared/sample-unlock-card';
import type {
  MarkdownChapterChunk,
  MarkdownTocItem,
  MarkdownWorkerRequest,
  MarkdownWorkerResponse,
} from './markdown-parse.worker';

export interface MarkdownViewerProps {
  book: PublicBookDTO;
  streamUrl: string;
  fullStoragePath?: string;
  directStreamUrl?: string;
  initialMarkdownText?: string;
  isSample: boolean;
  userId?: string;
  preferOffline?: boolean;
  bearerTokenProvider?: () => Promise<string | null>;
  onRefreshSignedUrl?: () => Promise<string | null>;
  onSwitchToFullMode?: () => void;
  topBar?: ReaderTopBarProps;
}

const MIN_MD_SCALE = 0.8;
const MAX_MD_SCALE = 2.0;
const MD_SCALE_STEP = 0.1;
const PINCH_PROSE_DEADZONE_PX = 24;

function sanitizeAndHydrateMarkdownHtml(
  rawHtml: string,
  mathMap: Record<string, string>
): string {
  if (typeof window === 'undefined') return '';
  const sanitized = DOMPurify.sanitize(rawHtml, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'style'],
    FORBID_ATTR: [
      'onerror',
      'onload',
      'onclick',
      'onmouseover',
      'onfocus',
      'onblur',
      'style',
    ],
    ADD_ATTR: [
      'data-block-id',
      'data-sec-id',
      'data-katex-id',
      'data-md-lightbox',
      'loading',
      'decoding',
      'referrerpolicy',
      'aria-hidden',
    ],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|tel|blob):|data:image\/(?:png|jpe?g|webp|gif|avif);base64,|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });

  if (!mathMap || Object.keys(mathMap).length === 0) {
    return sanitized;
  }

  // Hydrate trusted KaTeX-rendered HTML (generated with trust: false) AFTER DOMPurify
  // so KaTeX layout styles, fractions, roots, and SVGs render intact without relaxing DOMPurify.
  return sanitized.replace(
    /<(div|span)([^>]*?)data-katex-id="(math_\d+)"([^>]*)><\/\1>/g,
    (fullMatch, tag: string, _before: string, mathId: string) => {
      const rendered = mathMap[mathId];
      if (!rendered) return fullMatch;
      const cls = tag === 'div' ? 'ed-md-math-block' : 'ed-md-math-inline';
      return `<${tag} class="${cls}">${rendered}</${tag}>`;
    }
  );
}

function resolveInitialChapterIndex(
  chapters: MarkdownChapterChunk[],
  saved: MarkdownReadingProgress | null
): number {
  if (chapters.length === 0 || !saved) return 0;

  if (saved.chapterHeadingId) {
    const byHeading = chapters.findIndex(
      (ch) => ch.headingId === saved.chapterHeadingId
    );
    if (byHeading >= 0) return byHeading;
  }

  if (saved.blockId) {
    const match = saved.blockId.match(/^blk_(\d+)$/);
    if (match) {
      const blockNum = Number(match[1]);
      const byBlock = chapters.findIndex(
        (ch) =>
          ch.startBlockNum > 0 &&
          blockNum >= ch.startBlockNum &&
          blockNum <= ch.endBlockNum
      );
      if (byBlock >= 0) return byBlock;
    }
  }

  if (
    typeof saved.chapterIndex === 'number' &&
    Number.isFinite(saved.chapterIndex)
  ) {
    return Math.min(
      chapters.length - 1,
      Math.max(0, Math.floor(saved.chapterIndex))
    );
  }

  return 0;
}

export function MarkdownViewer({
  book,
  streamUrl,
  fullStoragePath,
  directStreamUrl,
  initialMarkdownText,
  isSample,
  userId,
  preferOffline = false,
  bearerTokenProvider,
  onRefreshSignedUrl,
  onSwitchToFullMode,
  topBar,
}: MarkdownViewerProps) {
  const router = useRouter();

  const progressKey = `ed-md-prog-v1:${book.id}:${isSample ? 'sample' : 'full'}`;
  const vaultKey = `md_${book.id}_sample.md`;

  const savedInitial = useMemo(
    () => readStoredJsonSync<MarkdownReadingProgress>(progressKey),
    [progressKey]
  );

  const [mdScale, setMdScale] = useState<number>(() => {
    const s = savedInitial?.mdScale ?? 1.0;
    return Math.min(MAX_MD_SCALE, Math.max(MIN_MD_SCALE, Math.round(s * 10) / 10));
  });
  const [livePinchScale, setLivePinchScale] = useState<number | null>(null);
  const [fontMode, setFontMode] = useState<MarkdownFontMode>(
    savedInitial?.fontMode ?? 'sans'
  );
  const [comfortTheme, setComfortTheme] = useState<ReaderComfortTheme>(
    savedInitial?.theme ?? 'light'
  );

  const [chapters, setChapters] = useState<MarkdownChapterChunk[]>([]);
  const [toc, setToc] = useState<MarkdownTocItem[]>([]);
  const [mathMap, setMathMap] = useState<Record<string, string>>({});
  const [activeChapterIndex, setActiveChapterIndex] = useState<number>(0);
  const [activeSubheadingId, setActiveSubheadingId] = useState<string>('');
  const [chapterScrollRatio, setChapterScrollRatio] = useState<number>(0);

  const [tocOpen, setTocOpen] = useState(false);
  const [tocQuery, setTocQuery] = useState('');
  const [lightboxPayload, setLightboxPayload] =
    useState<LightboxPayload | null>(null);

  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [rawMarkdownSample, setRawMarkdownSample] = useState<string>(
    initialMarkdownText || ''
  );

  const rootContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const proseRef = useRef<HTMLElement | null>(null);
  const tocListRef = useRef<HTMLDivElement | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const pendingAnchorRef = useRef<string | null>(null);
  const skipNextChapterResetScrollRef = useRef<boolean>(true);

  const [reloadNonce, setReloadNonce] = useState(0);
  const mdScaleRef = useRef<number>(mdScale);
  const activeChapterIndexRef = useRef<number>(activeChapterIndex);
  const chaptersRef = useRef<MarkdownChapterChunk[]>(chapters);
  const savedInitialRef = useRef<MarkdownReadingProgress | null>(savedInitial);
  const bearerTokenProviderRef = useRef(bearerTokenProvider);
  const onRefreshSignedUrlRef = useRef(onRefreshSignedUrl);
  const streamUrlRef = useRef(streamUrl);
  const fullStoragePathRef = useRef(fullStoragePath);
  const directStreamUrlRef = useRef(directStreamUrl);
  const flushProgressRef = useRef<() => void>(() => {});
  const restoredAnchorRef = useRef<boolean>(false);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mdScaleRef.current = mdScale;
  }, [mdScale]);

  useEffect(() => {
    activeChapterIndexRef.current = activeChapterIndex;
  }, [activeChapterIndex]);

  useEffect(() => {
    chaptersRef.current = chapters;
  }, [chapters]);

  useEffect(() => {
    savedInitialRef.current = savedInitial;
  }, [savedInitial]);

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

  const pinchRef = useRef<{
    active: boolean;
    deadzonePassed: boolean;
    startDist: number;
    startScale: number;
    targetScale: number;
  } | null>(null);

  const tallScript = useMemo(
    () => isTallScriptLanguage(book.language, rawMarkdownSample),
    [book.language, rawMarkdownSample]
  );

  // Fast O(1) lookup from any #heading-slug to its owning chapter index
  const anchorToChapterMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      for (const anchor of ch.anchorIds) {
        if (!map.has(anchor)) {
          map.set(anchor, i);
        }
      }
    }
    return map;
  }, [chapters]);

  const safeChapterIndex =
    chapters.length > 0
      ? Math.min(chapters.length - 1, Math.max(0, activeChapterIndex))
      : 0;
  const activeChapter: MarkdownChapterChunk | null =
    chapters[safeChapterIndex] ?? null;
  const prevChapter: MarkdownChapterChunk | null =
    safeChapterIndex > 0 ? chapters[safeChapterIndex - 1] ?? null : null;
  const nextChapter: MarkdownChapterChunk | null =
    safeChapterIndex < chapters.length - 1
      ? chapters[safeChapterIndex + 1] ?? null
      : null;

  const [sanitizedByChapterId, setSanitizedByChapterId] = useState<
    Record<string, string>
  >({});

  const activeChapterSafeHtml = useMemo(() => {
    if (!activeChapter) return '';
    const cached = sanitizedByChapterId[activeChapter.chapterId];
    if (cached !== undefined) return cached;
    return sanitizeAndHydrateMarkdownHtml(activeChapter.rawHtml, mathMap);
  }, [activeChapter, mathMap, sanitizedByChapterId]);

  // Persist active chapter HTML in state cache & pre-warm next chapter during idle time
  useEffect(() => {
    if (loadingState !== 'ready' || !activeChapter) return;

    const needsActive =
      sanitizedByChapterId[activeChapter.chapterId] === undefined;
    const needsNext =
      Boolean(nextChapter) &&
      sanitizedByChapterId[nextChapter!.chapterId] === undefined;

    if (!needsActive && !needsNext) return;

    const warmChapters = () => {
      setSanitizedByChapterId((prev) => {
        let nextState: Record<string, string> | null = null;
        if (prev[activeChapter.chapterId] === undefined) {
          nextState = {
            ...(nextState ?? prev),
            [activeChapter.chapterId]: sanitizeAndHydrateMarkdownHtml(
              activeChapter.rawHtml,
              mathMap
            ),
          };
        }
        if (nextChapter && prev[nextChapter.chapterId] === undefined) {
          nextState = {
            ...(nextState ?? prev),
            [nextChapter.chapterId]: sanitizeAndHydrateMarkdownHtml(
              nextChapter.rawHtml,
              mathMap
            ),
          };
        }
        return nextState ?? prev;
      });
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(warmChapters, { timeout: 500 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timer = setTimeout(warmChapters, 100);
    return () => clearTimeout(timer);
  }, [activeChapter, loadingState, mathMap, nextChapter, sanitizedByChapterId]);

  // Capture current top-quarter [data-block-id] anchor for Zoom-Proof Persistence & Eye-Line Lock
  const captureEyeLineAnchor = useCallback((): {
    blockId: string;
    offsetFromTop: number;
    blockRatio: number;
  } | null => {
    const scroller = scrollerRef.current;
    const prose = proseRef.current;
    if (!scroller || !prose) return null;

    const scrollerRect = scroller.getBoundingClientRect();
    const eyeLineY = scrollerRect.top + Math.min(120, scrollerRect.height * 0.25);
    const blocks = prose.querySelectorAll<HTMLElement>('[data-block-id]');
    if (blocks.length === 0) return null;

    let chosen: HTMLElement = blocks[0];
    for (let i = 0; i < blocks.length; i++) {
      const rect = blocks[i].getBoundingClientRect();
      if (rect.bottom >= scrollerRect.top + 8) {
        chosen = blocks[i];
        if (rect.top <= eyeLineY) {
          continue;
        }
        break;
      }
    }

    const rect = chosen.getBoundingClientRect();
    const blockId = chosen.getAttribute('data-block-id') || '';
    if (!blockId) return null;

    const offsetFromTop = rect.top - scrollerRect.top;
    const progressedPx = Math.max(0, scrollerRect.top + 48 - rect.top);
    const blockRatio =
      rect.height > 0 ? Math.min(1, Math.max(0, progressedPx / rect.height)) : 0;

    return { blockId, offsetFromTop, blockRatio };
  }, []);

  const flushProgressNow = useCallback(() => {
    const list = chaptersRef.current;
    if (list.length === 0) return;
    const idx = Math.min(
      list.length - 1,
      Math.max(0, activeChapterIndexRef.current)
    );
    const currentChapter = list[idx];
    const anchor = captureEyeLineAnchor();

    const payload: MarkdownReadingProgress = {
      chapterIndex: idx,
      chapterHeadingId: currentChapter?.headingId ?? '',
      blockId: anchor?.blockId || currentChapter?.firstBlockId || '',
      blockProgressRatio: anchor?.blockRatio ?? 0,
      mdScale: mdScaleRef.current,
      fontMode,
      theme: comfortTheme,
      updatedAt: Date.now(),
    };
    writeStoredJsonSync(progressKey, payload);
  }, [captureEyeLineAnchor, comfortTheme, fontMode, progressKey]);

  const scheduleProgressSave = useCallback(() => {
    if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    progressTimerRef.current = setTimeout(() => {
      flushProgressNow();
    }, 800);
  }, [flushProgressNow]);

  useEffect(() => {
    flushProgressRef.current = flushProgressNow;
    return registerLifecycleFlush(flushProgressNow);
  }, [flushProgressNow]);

  // Jump to an in-chapter heading by slug
  const scrollToHeadingInCurrentChapter = useCallback(
    (headingId: string, behavior: ScrollBehavior = 'smooth') => {
      const scroller = scrollerRef.current;
      const prose = proseRef.current;
      if (!scroller || !prose || !headingId) return;

      const targetEl = prose.querySelector<HTMLElement>(
        `#${CSS.escape(headingId)}`
      );
      if (!targetEl) return;

      const scrollerRect = scroller.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const destination = Math.max(
        0,
        scroller.scrollTop + (targetRect.top - scrollerRect.top) - 16
      );
      scroller.scrollTo({ top: destination, behavior });
    },
    []
  );

  // Switch active chapter (renders strictly one chapter at a time)
  const selectChapter = useCallback(
    (
      nextIndexRaw: number,
      options?: { anchorId?: string; closeToc?: boolean }
    ) => {
      const total = chaptersRef.current.length;
      if (total === 0) return;
      const nextIdx = Math.min(total - 1, Math.max(0, nextIndexRaw));

      if (options?.closeToc) {
        setTocOpen(false);
      }

      const targetChapter = chaptersRef.current[nextIdx];
      const anchorId = options?.anchorId?.trim() || '';

      if (nextIdx === activeChapterIndexRef.current) {
        if (anchorId && anchorId !== targetChapter?.headingId) {
          setActiveSubheadingId(anchorId);
          scrollToHeadingInCurrentChapter(anchorId, 'smooth');
        } else {
          setActiveSubheadingId('');
          setChapterScrollRatio(0);
          scrollerRef.current?.scrollTo({ top: 0, behavior: 'instant' });
        }
        scheduleProgressSave();
        return;
      }

      skipNextChapterResetScrollRef.current = false;
      pendingAnchorRef.current =
        anchorId && anchorId !== targetChapter?.headingId ? anchorId : null;
      setActiveSubheadingId(pendingAnchorRef.current || '');
      setChapterScrollRatio(0);
      activeChapterIndexRef.current = nextIdx;
      setActiveChapterIndex(nextIdx);
    },
    [scheduleProgressSave, scrollToHeadingInCurrentChapter]
  );

  // After switching chapters, scroll to top (or to pending cross-chapter #anchor) and save progress
  useEffect(() => {
    if (loadingState !== 'ready' || chapters.length === 0) return;

    if (skipNextChapterResetScrollRef.current) {
      return;
    }

    const pendingAnchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;

    requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      if (pendingAnchor) {
        scrollToHeadingInCurrentChapter(pendingAnchor, 'instant');
      } else {
        scroller.scrollTo({ top: 0, behavior: 'instant' });
      }
      scheduleProgressSave();
    });
  }, [
    activeChapterIndex,
    chapters.length,
    loadingState,
    scheduleProgressSave,
    scrollToHeadingInCurrentChapter,
  ]);

  // Auto-scroll active chapter entry into view when opening the TOC drawer
  useEffect(() => {
    if (!tocOpen) return;
    requestAnimationFrame(() => {
      const activeBtn = tocListRef.current?.querySelector<HTMLElement>(
        '[data-toc-active="true"]'
      );
      activeBtn?.scrollIntoView({ block: 'nearest' });
    });
  }, [tocOpen]);

  // Synchronous Eye-Line Lock Reflow Zoom (--md-scale)
  const applyScaleWithEyeLineLock = useCallback(
    (nextScaleRaw: number) => {
      const clamped = Math.min(
        MAX_MD_SCALE,
        Math.max(MIN_MD_SCALE, Math.round(nextScaleRaw * 10) / 10)
      );
      if (Math.abs(clamped - mdScaleRef.current) < 0.01) return;

      const scroller = scrollerRef.current;
      const prose = proseRef.current;
      const anchor = captureEyeLineAnchor();

      mdScaleRef.current = clamped;
      setMdScale(clamped);

      if (scroller && prose && anchor) {
        requestAnimationFrame(() => {
          prose.style.setProperty('--md-scale', String(clamped));
          const targetBlock = prose.querySelector<HTMLElement>(
            `[data-block-id="${CSS.escape(anchor.blockId)}"]`
          );
          if (targetBlock) {
            const scrollerRect = scroller.getBoundingClientRect();
            const newOffset =
              targetBlock.getBoundingClientRect().top - scrollerRect.top;
            scroller.scrollTop += newOffset - anchor.offsetFromTop;
          }
        });
      }
      scheduleProgressSave();
    },
    [captureEyeLineAnchor, scheduleProgressSave]
  );

  // Keyboard shortcuts: Cmd/Ctrl + +/-/0 (Zoom), Alt + Left/Right (Prev/Next Chapter), Escape closes TOC drawer
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          applyScaleWithEyeLineLock(mdScaleRef.current + MD_SCALE_STEP);
          return;
        }
        if (e.key === '-') {
          e.preventDefault();
          applyScaleWithEyeLineLock(mdScaleRef.current - MD_SCALE_STEP);
          return;
        }
        if (e.key === '0') {
          e.preventDefault();
          applyScaleWithEyeLineLock(1.0);
          return;
        }
      }

      if (e.key === 'Escape' && tocOpen) {
        e.stopPropagation();
        setTocOpen(false);
        return;
      }

      if (!isEditable && !tocOpen && e.altKey && !e.metaKey && !e.ctrlKey) {
        if (e.key === 'ArrowLeft' && activeChapterIndexRef.current > 0) {
          e.preventDefault();
          selectChapter(activeChapterIndexRef.current - 1);
        } else if (
          e.key === 'ArrowRight' &&
          activeChapterIndexRef.current < chaptersRef.current.length - 1
        ) {
          e.preventDefault();
          selectChapter(activeChapterIndexRef.current + 1);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyScaleWithEyeLineLock, selectChapter, tocOpen]);

  // Mobile Two-Finger Pinch on Prose -> Live Floating Scale Indicator, Commit on Lift
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchRef.current = {
          active: true,
          deadzonePassed: false,
          startDist: Math.hypot(dx, dy),
          startScale: mdScaleRef.current,
          targetScale: mdScaleRef.current,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const p = pinchRef.current;
      if (!p?.active || e.touches.length < 2) return;

      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);

      if (!p.deadzonePassed) {
        if (Math.abs(dist - p.startDist) < PINCH_PROSE_DEADZONE_PX) return;
        p.deadzonePassed = true;
      }

      e.preventDefault();
      const ratio = dist / Math.max(1, p.startDist);
      const damped = 1 + (ratio - 1) * 0.8;
      const snapped = Math.min(
        MAX_MD_SCALE,
        Math.max(MIN_MD_SCALE, Math.round(p.startScale * damped * 10) / 10)
      );
      p.targetScale = snapped;
      setLivePinchScale(snapped);
    };

    const onTouchEnd = (e: TouchEvent) => {
      const p = pinchRef.current;
      if (!p?.active) return;
      if (e.touches.length < 2) {
        p.active = false;
        setLivePinchScale(null);
        if (p.deadzonePassed) {
          applyScaleWithEyeLineLock(p.targetScale);
        }
        pinchRef.current = null;
      }
    };

    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    scroller.addEventListener('touchend', onTouchEnd, { passive: true });
    scroller.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [applyScaleWithEyeLineLock]);

  // Fetch & Parse Markdown into Chapters via Web Worker
  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 30_000);

    const readFromLocalVault = async (): Promise<ArrayBuffer | null> => {
      if (!isSample) {
        if (!userId) return null;
        return readBookFormatOffline(userId, book.id, 'markdown');
      }
      return readOfflineAsset(vaultKey);
    };

    const fetchOnlineMarkdownBuffer = async (): Promise<ArrayBuffer> => {
      let resolvedUrl = streamUrlRef.current;
      const activeStoragePath = fullStoragePathRef.current;
      const activeDirectUrl = directStreamUrlRef.current;

      if (!resolvedUrl && !isSample && onRefreshSignedUrlRef.current) {
        resolvedUrl = (await onRefreshSignedUrlRef.current()) || '';
      }

      const fetchWithToken = async (url: string): Promise<Response> => {
        const headers: Record<string, string> = {};
        const tokenProvider = bearerTokenProviderRef.current;
        if (tokenProvider) {
          const token = await tokenProvider();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        return fetch(url, {
          method: 'GET',
          headers,
          signal: abortController.signal,
        });
      };

      let primaryError: Error | null = null;

      if (resolvedUrl) {
        try {
          let res = await fetchWithToken(resolvedUrl);
          if (
            res.status === 401 &&
            !isSample &&
            onRefreshSignedUrlRef.current
          ) {
            const refreshed = await onRefreshSignedUrlRef.current();
            if (refreshed) {
              streamUrlRef.current = refreshed;
              res = await fetchWithToken(refreshed);
            }
          }

          if (res.ok) {
            return await res.arrayBuffer();
          }

          const errObj = (await res.json().catch(() => null)) as
            | { error?: string | { message?: string } }
            | null;
          const parsedErr =
            typeof errObj?.error === 'string'
              ? errObj.error
              : typeof errObj?.error?.message === 'string'
              ? errObj.error.message
              : '';
          primaryError = new Error(
            parsedErr || `Failed to load Markdown stream (HTTP ${res.status}).`
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
              : new Error('Failed to load Markdown stream.'));
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
              : new Error('Unable to access Markdown in Firebase Storage.'));
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

      throw new Error('No Markdown stream URL configured for this book.');
    };

    const runLoad = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoadingState('loading');
      setErrorMessage('');

      try {
        let markdownText = '';

        if (isSample) {
          const offlineBuf = await readFromLocalVault();
          if (offlineBuf) {
            markdownText = new TextDecoder('utf-8').decode(offlineBuf);
          } else if (initialMarkdownText && initialMarkdownText.trim().length > 0) {
            markdownText = initialMarkdownText;
          } else if (streamUrlRef.current) {
            const buf = await fetchOnlineMarkdownBuffer();
            markdownText = new TextDecoder('utf-8').decode(buf);
          } else {
            markdownText = `# ${book.title}\n\n${
              book.fullDescription ||
              book.seoDescription ||
              'No Markdown content attached.'
            }`;
          }
        } else {
          const offlineFirst =
            preferOffline ||
            (typeof navigator !== 'undefined' && !navigator.onLine);

          if (offlineFirst) {
            let buf = await readFromLocalVault();
            if (!buf && (typeof navigator === 'undefined' || navigator.onLine)) {
              buf = await fetchOnlineMarkdownBuffer();
            }
            if (!buf) {
              throw new Error(
                'This Markdown edition is not saved offline on this device yet. Reconnect to read online.'
              );
            }
            markdownText = new TextDecoder('utf-8').decode(buf);
          } else {
            try {
              const buf = await fetchOnlineMarkdownBuffer();
              markdownText = new TextDecoder('utf-8').decode(buf);
            } catch (onlineErr) {
              if (cancelled) return;
              const vaultFallback = await readFromLocalVault();
              if (vaultFallback) {
                markdownText = new TextDecoder('utf-8').decode(vaultFallback);
              } else {
                throw onlineErr;
              }
            }
          }
        }

        if (cancelled) return;
        setRawMarkdownSample(markdownText.slice(0, 1500));

        if (!workerRef.current) {
          workerRef.current = new Worker(
            new URL('./markdown-parse.worker.ts', import.meta.url)
          );
        }

        const worker = workerRef.current;
        const reqId = `md_${Date.now()}`;

        worker.onmessage = (ev: MessageEvent<MarkdownWorkerResponse>) => {
          if (cancelled) return;
          const data = ev.data;
          if (!data || data.type !== 'PARSE_SUCCESS' || data.requestId !== reqId) {
            return;
          }

          setSanitizedByChapterId({});
          restoredAnchorRef.current = false;
          skipNextChapterResetScrollRef.current = true;

          const initialIdx = resolveInitialChapterIndex(
            data.chapters,
            savedInitialRef.current
          );

          chaptersRef.current = data.chapters;
          activeChapterIndexRef.current = initialIdx;

          setMathMap(data.mathMap);
          setChapters(data.chapters);
          setToc(data.toc);
          setActiveChapterIndex(initialIdx);
          setActiveSubheadingId('');
          setChapterScrollRatio(0);
          setLoadingState('ready');
        };

        worker.onerror = () => {
          if (cancelled) return;
          setLoadingState('error');
          setErrorMessage(
            'Markdown study worker encountered an unexpected parsing error.'
          );
        };

        worker.postMessage({
          type: 'PARSE_MARKDOWN',
          requestId: reqId,
          markdown: markdownText,
          bookTitle: book.title,
          assetBaseUrl:
            typeof window !== 'undefined' ? window.location.origin : undefined,
        } satisfies MarkdownWorkerRequest);
      } catch (err) {
        if (cancelled) return;
        setLoadingState('error');
        setErrorMessage(
          abortController.signal.aborted
            ? 'Timed out loading Markdown stream. Check your connection and retry.'
            : err instanceof Error
            ? err.message
            : 'Unable to load Markdown stream.'
        );
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
    book.fullDescription,
    book.id,
    book.seoDescription,
    book.title,
    hasStreamTarget,
    initialMarkdownText,
    isSample,
    preferOffline,
    reloadNonce,
    userId,
    vaultKey,
  ]);

  useEffect(() => {
    return () => {
      flushProgressRef.current();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Restore saved [data-block-id] + blockProgressRatio inside the restored chapter on initial mount
  useEffect(() => {
    if (
      loadingState !== 'ready' ||
      chapters.length === 0 ||
      restoredAnchorRef.current
    ) {
      return;
    }
    restoredAnchorRef.current = true;
    if (!savedInitial?.blockId) return;

    requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      const prose = proseRef.current;
      if (!scroller || !prose) return;
      const blockEl = prose.querySelector<HTMLElement>(
        `[data-block-id="${CSS.escape(savedInitial.blockId)}"]`
      );
      if (blockEl) {
        const scrollerRect = scroller.getBoundingClientRect();
        const blockRect = blockEl.getBoundingClientRect();
        const targetTop =
          scroller.scrollTop +
          (blockRect.top - scrollerRect.top) +
          blockRect.height * (savedInitial.blockProgressRatio || 0) -
          24;
        scroller.scrollTo({ top: Math.max(0, targetTop), behavior: 'instant' });
      }
    });
  }, [chapters.length, loadingState, savedInitial]);

  // Scroll listener -> Subheading tracking within active chapter + Scroll progress + Persistence
  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    const prose = proseRef.current;
    if (!scroller || !prose) return;

    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    const ratio =
      maxScroll > 4 ? Math.min(1, Math.max(0, scroller.scrollTop / maxScroll)) : 1;
    setChapterScrollRatio(ratio);

    const subs = activeChapter?.subheadings;
    if (subs && subs.length > 0) {
      const scrollerTop = scroller.getBoundingClientRect().top;
      let currentSub = '';
      for (let i = 0; i < subs.length; i++) {
        const el = prose.querySelector<HTMLElement>(
          `#${CSS.escape(subs[i].id)}`
        );
        if (el) {
          const topRel = el.getBoundingClientRect().top - scrollerTop;
          if (topRel <= 108) {
            currentSub = subs[i].id;
          } else {
            break;
          }
        }
      }
      setActiveSubheadingId(currentSub);
    }

    scheduleProgressSave();
  }, [activeChapter, scheduleProgressSave]);

  // Delegated Click / Cross-Chapter Anchor / Image Lightbox Interceptor
  const handleProseClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const imgEl = target.closest<HTMLImageElement>('img');
      if (imgEl && imgEl.src) {
        e.preventDefault();
        setLightboxPayload({
          kind: 'image',
          title: imgEl.alt || `${book.title} — Diagram`,
          imageSrc: imgEl.src,
          imageAlt: imgEl.alt,
        });
        return;
      }

      const anchorEl = target.closest<HTMLAnchorElement>('a[href]');
      if (anchorEl) {
        const rawHref = anchorEl.getAttribute('href') || '';
        if (!rawHref) return;

        if (rawHref.startsWith('#')) {
          e.preventDefault();
          const slug = decodeURIComponent(rawHref.slice(1)).trim();
          if (!slug) return;
          const ownerIdx = anchorToChapterMap.get(slug);
          if (ownerIdx !== undefined && ownerIdx !== safeChapterIndex) {
            selectChapter(ownerIdx, { anchorId: slug });
          } else {
            scrollToHeadingInCurrentChapter(slug, 'smooth');
          }
          return;
        }

        if (rawHref.startsWith('/books/') || rawHref.startsWith('/exams/')) {
          e.preventDefault();
          router.push(rawHref);
          return;
        }

        if (rawHref.startsWith('http://') || rawHref.startsWith('https://')) {
          e.preventDefault();
          void openExternalReaderUrl(rawHref);
        }
      }
    },
    [
      anchorToChapterMap,
      book.title,
      router,
      safeChapterIndex,
      scrollToHeadingInCurrentChapter,
      selectChapter,
    ]
  );

  const normalizedTocQuery = tocQuery.trim().toLowerCase();
  const showTocSearch = useMemo(() => {
    if (toc.length >= 5) return true;
    const totalSubs = toc.reduce((acc, item) => acc + item.subheadings.length, 0);
    return totalSubs >= 6;
  }, [toc]);

  const filteredToc = useMemo(() => {
    if (!normalizedTocQuery) {
      return toc.map((entry) => ({
        entry,
        matchingSubs: entry.subheadings,
      }));
    }

    const results: Array<{
      entry: MarkdownTocItem;
      matchingSubs: MarkdownTocItem['subheadings'];
    }> = [];

    for (const entry of toc) {
      const titleMatches = entry.text.toLowerCase().includes(normalizedTocQuery);
      const subMatches = entry.subheadings.filter((sub) =>
        sub.text.toLowerCase().includes(normalizedTocQuery)
      );
      if (titleMatches || subMatches.length > 0) {
        results.push({
          entry,
          matchingSubs: titleMatches && subMatches.length === 0 ? entry.subheadings : subMatches,
        });
      }
    }

    return results;
  }, [normalizedTocQuery, toc]);

  const displayedScalePct = Math.round((livePinchScale ?? mdScale) * 100);
  const overallProgressRatio =
    chapters.length <= 1
      ? chapterScrollRatio
      : Math.min(1, Math.max(0, (safeChapterIndex + chapterScrollRatio) / chapters.length));

  const proseColumnMaxWidth = `min(100%, calc(48rem * ${mdScale}))`;

  return (
    <>
      <div
        ref={rootContainerRef}
        className={cn(
          'relative flex flex-col w-full h-full overflow-hidden',
          comfortTheme === 'light' && 'ed-reader-skin-light',
          comfortTheme === 'sepia' && 'ed-reader-skin-sepia',
          comfortTheme === 'dark' && 'ed-reader-skin-dark'
        )}
        style={{ backgroundColor: 'var(--reader-bg)', color: 'var(--reader-ink)' }}
      >
        {/* Bar 1: Title, PDF/Markdown Toggle, Cross Button */}
        {topBar && <ReaderTopBar {...topBar} />}

        {/* Bar 2: Single-Row Reader Controls — Chapter Menu, Prev/Next (Desktop), Font Type, +/- Zoom, Comfort Skin */}
        <div
          data-nosnippet=""
          className="relative flex items-center justify-between gap-1.5 w-full px-2.5 sm:px-4 py-1.5 border-b border-[var(--reader-border)] bg-[var(--reader-bg)] text-[var(--reader-ink)] shrink-0"
        >
          {/* Left: Chapter TOC Menu + Compact Desktop Chapter Stepper + Font Type */}
          <div className="flex items-center gap-1.5 shrink-0 min-w-0">
            <button
              type="button"
              onClick={() => setTocOpen(true)}
              aria-label={
                chapters.length > 1
                  ? `Open chapters menu, chapter ${safeChapterIndex + 1} of ${chapters.length}`
                  : 'Open table of contents'
              }
              className="inline-flex items-center justify-center gap-1.5 h-8 sm:h-9 px-2 sm:px-2.5 rounded-md border border-[var(--reader-border)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] transition-colors whitespace-nowrap shrink-0"
            >
              <Menu className="w-4 h-4 shrink-0" aria-hidden="true" />
              {chapters.length > 1 ? (
                <>
                  <span className="sm:hidden text-[11px] font-semibold tabular-nums">
                    {safeChapterIndex + 1}/{chapters.length}
                  </span>
                  <span className="hidden sm:inline text-xs font-semibold tabular-nums">
                    Chapter {safeChapterIndex + 1} / {chapters.length}
                  </span>
                </>
              ) : (
                <span className="hidden sm:inline text-xs font-semibold">
                  Contents
                </span>
              )}
            </button>

            {chapters.length > 1 && (
              <div
                role="group"
                aria-label="Chapter step navigation"
                className="hidden md:inline-flex items-center rounded-md border border-[var(--reader-border)] bg-[var(--reader-surface)] p-0.5 shrink-0"
              >
                <button
                  type="button"
                  disabled={!prevChapter}
                  onClick={() => selectChapter(safeChapterIndex - 1)}
                  aria-label={
                    prevChapter
                      ? `Previous chapter: ${prevChapter.title}`
                      : 'Previous chapter'
                  }
                  className="inline-flex items-center justify-center h-8 w-8 rounded hover:bg-[var(--reader-elevated)] disabled:opacity-35 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={!nextChapter}
                  onClick={() => selectChapter(safeChapterIndex + 1)}
                  aria-label={
                    nextChapter
                      ? `Next chapter: ${nextChapter.title}`
                      : 'Next chapter'
                  }
                  className="inline-flex items-center justify-center h-8 w-8 rounded hover:bg-[var(--reader-elevated)] disabled:opacity-35 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setFontMode((m) => (m === 'sans' ? 'serif' : 'sans'));
                scheduleProgressSave();
              }}
              aria-label={`Switch to ${fontMode === 'sans' ? 'Serif' : 'Sans'} font`}
              className="inline-flex items-center justify-center h-8 sm:h-9 px-2 sm:px-2.5 rounded-md border border-[var(--reader-border)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              {fontMode === 'sans' ? 'Sans' : 'Serif'}
            </button>
          </div>

          {/* Right: +/- Zoom + Light/Sepia/Dark */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div
              role="group"
              aria-label="Text zoom controls"
              className="inline-flex items-center rounded-md border border-[var(--reader-border)] bg-[var(--reader-surface)] p-0.5 tabular-nums"
            >
              <button
                type="button"
                disabled={mdScale <= MIN_MD_SCALE}
                onClick={() => applyScaleWithEyeLineLock(mdScale - MD_SCALE_STEP)}
                aria-label="Decrease text size"
                className="inline-flex items-center justify-center h-7 w-7 sm:h-8 sm:w-8 rounded hover:bg-[var(--reader-elevated)] disabled:opacity-40 transition-colors"
              >
                <Minus className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => applyScaleWithEyeLineLock(1.0)}
                aria-label="Reset text size to 100%"
                className="h-7 sm:h-8 px-1.5 sm:px-2 text-[11px] sm:text-xs font-semibold rounded hover:bg-[var(--reader-elevated)] transition-colors whitespace-nowrap"
              >
                {displayedScalePct}%
              </button>
              <button
                type="button"
                disabled={mdScale >= MAX_MD_SCALE}
                onClick={() => applyScaleWithEyeLineLock(mdScale + MD_SCALE_STEP)}
                aria-label="Increase text size"
                className="inline-flex items-center justify-center h-7 w-7 sm:h-8 sm:w-8 rounded hover:bg-[var(--reader-elevated)] disabled:opacity-40 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

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
                  'inline-flex items-center justify-center h-7 w-7 sm:h-8 sm:w-8 rounded transition-colors',
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
                  'inline-flex items-center justify-center h-7 w-7 sm:h-8 sm:w-8 rounded transition-colors',
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
                  'inline-flex items-center justify-center h-7 w-7 sm:h-8 sm:w-8 rounded transition-colors',
                  comfortTheme === 'dark'
                    ? 'bg-[var(--reader-accent)] text-[var(--reader-accent-ink)]'
                    : 'hover:bg-[var(--reader-elevated)]'
                )}
              >
                <Moon className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Hairline GPU-composited reading progress indicator */}
          {loadingState === 'ready' && chapters.length > 0 && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-transparent overflow-hidden"
            >
              <div
                className="h-full w-full origin-left bg-[var(--reader-accent)] opacity-75 transition-transform duration-150"
                style={{ transform: `scaleX(${overallProgressRatio})` }}
              />
            </div>
          )}
        </div>

        {/* Slide-Over Table of Contents Drawer (Switches Active Chapter 1-by-1) */}
        {tocOpen && (
          <div
            data-nosnippet=""
            className="absolute inset-0 z-30 flex bg-black/50"
            onClick={() => setTocOpen(false)}
          >
            <aside
              aria-label="Book chapters and table of contents"
              onClick={(e) => e.stopPropagation()}
              className="w-80 sm:w-96 max-w-[88vw] h-full bg-[var(--reader-bg)] border-e border-[var(--reader-border-strong)] flex flex-col"
            >
              <div
                className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-[var(--reader-border)]"
                style={{
                  paddingTop: 'calc(0.625rem + var(--safe-area-inset-top))',
                }}
              >
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-[var(--reader-ink)] truncate">
                    Contents
                  </h2>
                  {toc.length > 0 && (
                    <p className="text-xs text-[var(--reader-muted)] tabular-nums">
                      {toc.length} {toc.length === 1 ? 'chapter' : 'chapters'}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setTocOpen(false)}
                  aria-label="Close table of contents"
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] -me-2 rounded-md hover:bg-[var(--reader-elevated)] transition-colors shrink-0"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              {showTocSearch && (
                <div className="px-3 py-2.5 border-b border-[var(--reader-border)]">
                  <div className="relative flex items-center">
                    <Search
                      className="pointer-events-none absolute start-3 w-4 h-4 text-[var(--reader-muted)]"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={tocQuery}
                      onChange={(e) => setTocQuery(e.target.value)}
                      placeholder="Filter chapters or topics..."
                      aria-label="Filter chapters or topics"
                      className="w-full h-10 ps-9 pe-9 rounded-md border border-[var(--reader-border)] bg-[var(--reader-surface)] text-base sm:text-sm text-[var(--reader-ink)] placeholder:text-[var(--reader-muted)] focus:outline-none focus:border-[var(--reader-border-strong)]"
                    />
                    {tocQuery && (
                      <button
                        type="button"
                        onClick={() => setTocQuery('')}
                        aria-label="Clear chapter filter"
                        className="absolute end-1 inline-flex items-center justify-center h-8 w-8 rounded text-[var(--reader-muted)] hover:text-[var(--reader-ink)]"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div
                ref={tocListRef}
                className="flex-1 overflow-y-auto p-2.5 space-y-1"
                style={{
                  paddingBottom: 'calc(1rem + var(--safe-area-inset-bottom))',
                }}
              >
                {toc.length === 0 ? (
                  <p className="text-xs text-[var(--reader-muted)] p-3">
                    No chapters found in this document.
                  </p>
                ) : filteredToc.length === 0 ? (
                  <p className="text-xs text-[var(--reader-muted)] p-3">
                    No chapters match &ldquo;{tocQuery.trim()}&rdquo;.
                  </p>
                ) : (
                  filteredToc.map(({ entry, matchingSubs }) => {
                    const isActive = entry.chapterIndex === safeChapterIndex;
                    const showSubs =
                      matchingSubs.length > 0 &&
                      (isActive || Boolean(normalizedTocQuery));
                    const chapterNumLabel = String(entry.chapterIndex + 1).padStart(
                      2,
                      '0'
                    );

                    return (
                      <div key={entry.chapterId} className="space-y-0.5">
                        <button
                          type="button"
                          data-toc-active={isActive ? 'true' : undefined}
                          aria-current={isActive ? 'true' : undefined}
                          onClick={() =>
                            selectChapter(entry.chapterIndex, { closeToc: true })
                          }
                          className={cn(
                            'w-full text-start min-h-[44px] px-3 py-2 rounded-md text-xs sm:text-sm transition-colors flex items-baseline justify-between gap-2.5',
                            isActive
                              ? 'bg-[var(--reader-elevated)] font-bold text-[var(--reader-ink)]'
                              : 'font-medium text-[var(--reader-muted)] hover:bg-[var(--reader-surface)] hover:text-[var(--reader-ink)]'
                          )}
                        >
                          <span className="flex items-baseline gap-2 min-w-0 flex-1">
                            {toc.length > 1 && (
                              <span className="text-[11px] tabular-nums text-[var(--reader-muted)] shrink-0">
                                {chapterNumLabel}.
                              </span>
                            )}
                            <span className="line-clamp-2">{entry.text}</span>
                          </span>
                          <span className="text-[11px] tabular-nums text-[var(--reader-muted)] shrink-0">
                            {entry.estimatedReadMinutes}m
                          </span>
                        </button>

                        {showSubs && (
                          <div className="ps-6 pe-1 py-0.5 space-y-0.5">
                            {matchingSubs.map((sub) => {
                              const isSubActive =
                                isActive && activeSubheadingId === sub.id;
                              return (
                                <button
                                  key={sub.id}
                                  type="button"
                                  onClick={() =>
                                    selectChapter(entry.chapterIndex, {
                                      anchorId: sub.id,
                                      closeToc: true,
                                    })
                                  }
                                  className={cn(
                                    'w-full text-start min-h-[38px] px-2.5 py-1.5 rounded-md text-xs transition-colors flex items-center',
                                    sub.level >= 4 && 'ps-5',
                                    isSubActive
                                      ? 'bg-[var(--reader-surface)] font-semibold text-[var(--reader-ink)]'
                                      : 'text-[var(--reader-muted)] hover:bg-[var(--reader-surface)] hover:text-[var(--reader-ink)]'
                                  )}
                                >
                                  <span className="line-clamp-1">{sub.text}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </aside>
          </div>
        )}

        {/* Scrollable Single-Chapter Prose Stage */}
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-6 lg:px-10 py-4 sm:py-6"
          style={{
            paddingBottom: 'calc(2rem + var(--safe-area-inset-bottom))',
          }}
        >
          {loadingState === 'loading' && (
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center">
              <Loader2
                className="w-6 h-6 animate-spin text-[var(--reader-muted)] mb-2.5"
                aria-hidden="true"
              />
              <p className="text-sm font-semibold">Loading content...</p>
            </div>
          )}

          {loadingState === 'error' && (
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center p-6">
              <AlertCircle
                className="w-6 h-6 text-[var(--status-danger)] mb-2.5"
                aria-hidden="true"
              />
              <h3 className="text-base font-bold">Unable to Load Markdown</h3>
              <p className="mt-1 text-xs sm:text-sm text-[var(--reader-muted)] max-w-md">
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
                <span>Retry</span>
              </button>
            </div>
          )}

          {loadingState === 'ready' && activeChapter && (
            <>
              {/* Quiet Unboxed Chapter Position Kicker */}
              {chapters.length > 1 && (
                <div
                  data-nosnippet=""
                  className="mx-auto mb-3 flex items-center justify-between gap-3 text-xs text-[var(--reader-muted)] tabular-nums"
                  style={{ maxWidth: proseColumnMaxWidth }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span>
                      Chapter {safeChapterIndex + 1} of {chapters.length}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{activeChapter.estimatedReadMinutes} min read</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTocOpen(true)}
                    className="text-xs font-medium text-[var(--reader-muted)] hover:text-[var(--reader-ink)] underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
                  >
                    All chapters
                  </button>
                </div>
              )}

              {/* Active Chapter Only — Keeps DOM Lean on Long Purchased Books */}
              <article
                ref={proseRef}
                onClick={handleProseClick}
                className={cn(
                  'ed-md-prose',
                  fontMode === 'serif' ? 'ed-md-font-serif' : 'ed-md-font-sans',
                  tallScript && 'ed-md-tall-script',
                  !isSample && book.buyPrice > 0 && 'ed-md-paid-guard'
                )}
                style={
                  {
                    '--md-scale': mdScale,
                  } as React.CSSProperties
                }
              >
                <section
                  key={activeChapter.chapterId}
                  data-sec-id={activeChapter.chapterId}
                  aria-label={activeChapter.title}
                  className="ed-md-section"
                  dangerouslySetInnerHTML={{ __html: activeChapterSafeHtml }}
                />
              </article>

              {/* End-of-Chapter Previous / Next Chapter Pagination */}
              {chapters.length > 1 && (
                <nav
                  data-nosnippet=""
                  aria-label="Chapter pagination"
                  className="mx-auto mt-10 pt-6 border-t border-[var(--reader-border)] grid grid-cols-1 sm:grid-cols-2 gap-3"
                  style={{ maxWidth: proseColumnMaxWidth }}
                >
                  {prevChapter ? (
                    <button
                      type="button"
                      onClick={() => selectChapter(safeChapterIndex - 1)}
                      className="group flex flex-col justify-center min-h-[56px] px-4 py-3 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] text-start transition-colors"
                    >
                      <span className="inline-flex items-center gap-1 text-xs text-[var(--reader-muted)] tabular-nums">
                        <ChevronLeft
                          className="w-3.5 h-3.5 shrink-0 transition-transform duration-150 group-hover:-translate-x-0.5"
                          aria-hidden="true"
                        />
                        <span>
                          Previous · Chapter {prevChapter.chapterIndex + 1}
                        </span>
                      </span>
                      <span className="mt-1 text-sm font-semibold text-[var(--reader-ink)] truncate w-full">
                        {prevChapter.title}
                      </span>
                    </button>
                  ) : (
                    <div className="hidden sm:block" aria-hidden="true" />
                  )}

                  {nextChapter && (
                    <button
                      type="button"
                      onClick={() => selectChapter(safeChapterIndex + 1)}
                      className="group flex flex-col justify-center sm:items-end min-h-[56px] px-4 py-3 rounded-lg border border-[var(--reader-border-strong)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] text-start sm:text-end transition-colors"
                    >
                      <span className="inline-flex items-center gap-1 text-xs text-[var(--reader-muted)] tabular-nums">
                        <span>
                          Next · Chapter {nextChapter.chapterIndex + 1}
                        </span>
                        <ChevronRight
                          className="w-3.5 h-3.5 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </span>
                      <span className="mt-1 text-sm font-semibold text-[var(--reader-ink)] truncate w-full">
                        {nextChapter.title}
                      </span>
                    </button>
                  )}
                </nav>
              )}

              {isSample && (
                <div
                  className="mx-auto mt-6"
                  style={{ maxWidth: proseColumnMaxWidth }}
                >
                  <SampleUnlockCard
                    book={book}
                    formatLabel="Markdown"
                    onUnlocked={onSwitchToFullMode}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Live Mobile Pinch Scale Indicator */}
        {livePinchScale !== null && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute top-24 left-1/2 -translate-x-1/2 z-20 rounded-md border border-[var(--reader-border-strong)] bg-[var(--reader-bg)]/95 px-3 py-1 text-xs font-bold tabular-nums text-[var(--reader-ink)] shadow-sm"
          >
            {Math.round(livePinchScale * 100)}%
          </div>
        )}
      </div>

      {/* Full-Screen Pinch-Zoom Lightbox for Diagrams */}
      <DiagramLightbox
        payload={lightboxPayload}
        onClose={() => setLightboxPayload(null)}
      />
    </>
  );
}
