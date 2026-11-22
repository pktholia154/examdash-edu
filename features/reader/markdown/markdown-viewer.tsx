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
  Loader2,
  Menu,
  Minus,
  Moon,
  Plus,
  RefreshCw,
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

interface SanitizedSection {
  sectionId: string;
  headingTitle: string;
  safeHtml: string;
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

  const [sections, setSections] = useState<SanitizedSection[]>([]);
  const [toc, setToc] = useState<MarkdownTocItem[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState<string>('');
  const [tocOpen, setTocOpen] = useState(false);
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
  const workerRef = useRef<Worker | null>(null);

  const [reloadNonce, setReloadNonce] = useState(0);
  const mdScaleRef = useRef<number>(mdScale);
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
    if (sections.length === 0) return;
    const anchor = captureEyeLineAnchor();
    const payload: MarkdownReadingProgress = {
      blockId: anchor?.blockId ?? '',
      blockProgressRatio: anchor?.blockRatio ?? 0,
      mdScale: mdScaleRef.current,
      fontMode,
      theme: comfortTheme,
      updatedAt: Date.now(),
    };
    writeStoredJsonSync(progressKey, payload);
  }, [captureEyeLineAnchor, comfortTheme, fontMode, progressKey, sections.length]);

  const scheduleProgressSave = useCallback(() => {
    if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    progressTimerRef.current = setTimeout(() => {
      flushProgressNow();
    }, 1000);
  }, [flushProgressNow]);

  useEffect(() => {
    flushProgressRef.current = flushProgressNow;
    return registerLifecycleFlush(flushProgressNow);
  }, [flushProgressNow]);

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

  // Keyboard shortcuts: Cmd/Ctrl + +/-/0 (Zoom), Escape closes TOC drawer
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          applyScaleWithEyeLineLock(mdScaleRef.current + MD_SCALE_STEP);
        } else if (e.key === '-') {
          e.preventDefault();
          applyScaleWithEyeLineLock(mdScaleRef.current - MD_SCALE_STEP);
        } else if (e.key === '0') {
          e.preventDefault();
          applyScaleWithEyeLineLock(1.0);
        }
      }
      if (e.key === 'Escape' && tocOpen) {
        e.stopPropagation();
        setTocOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyScaleWithEyeLineLock, tocOpen]);

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

  // Fetch & Parse Markdown via Worker + Main-Thread DOMPurify + KaTeX Hydration
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

      if (resolvedUrl) {
        try {
          let res = await fetchWithToken(resolvedUrl);
          if (
            (res.status === 401 || res.status === 403) &&
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

          if (isSample || (!activeStoragePath && !activeDirectUrl)) {
            const errObj = (await res.json().catch(() => null)) as
              | { error?: string | { message?: string } }
              | null;
            const parsedErr =
              typeof errObj?.error === 'string'
                ? errObj.error
                : typeof errObj?.error?.message === 'string'
                ? errObj.error.message
                : '';
            throw new Error(
              parsedErr ||
                `Failed to load Markdown stream (HTTP ${res.status}).`
            );
          }
        } catch (streamErr) {
          if (
            abortController.signal.aborted ||
            isSample ||
            (!activeStoragePath && !activeDirectUrl)
          ) {
            throw streamErr;
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
          if (abortController.signal.aborted || !activeDirectUrl) {
            throw storageErr;
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

          const sanitized: SanitizedSection[] = data.sections.map((sec) => ({
            sectionId: sec.sectionId,
            headingTitle: sec.headingTitle,
            safeHtml: sanitizeAndHydrateMarkdownHtml(sec.rawHtml, data.mathMap),
          }));

          setSections(sanitized);
          setToc(data.toc);
          if (data.toc.length > 0) {
            setActiveHeadingId(data.toc[0].id);
          }
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

  // Restore saved [data-block-id] + blockProgressRatio once sections mount
  useEffect(() => {
    if (
      loadingState !== 'ready' ||
      sections.length === 0 ||
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
  }, [loadingState, savedInitial, sections.length]);

  // Scroll listener -> Active H1 tracking + Progress persistence
  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    const prose = proseRef.current;
    if (!scroller || !prose) return;

    if (toc.length > 0) {
      const scrollerTop = scroller.getBoundingClientRect().top;
      let currentToc = toc[0];
      for (let i = 0; i < toc.length; i++) {
        const el = prose.querySelector<HTMLElement>(
          `#${CSS.escape(toc[i].id)}`
        );
        if (el) {
          const topRel = el.getBoundingClientRect().top - scrollerTop;
          if (topRel <= 96) {
            currentToc = toc[i];
          } else {
            break;
          }
        }
      }
      setActiveHeadingId(currentToc.id);
    }

    scheduleProgressSave();
  }, [scheduleProgressSave, toc]);

  // Jump to Heading
  const jumpToHeading = useCallback((headingId: string) => {
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
    scroller.scrollTo({ top: destination, behavior: 'smooth' });
  }, []);

  // Delegated Click / Link / Image Lightbox Interceptor
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
          const slug = decodeURIComponent(rawHref.slice(1));
          jumpToHeading(slug);
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
    [book.title, jumpToHeading, router]
  );

  const displayedScalePct = Math.round((livePinchScale ?? mdScale) * 100);

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

        {/* Bar 2: Minimal Single-Row Controls — Menu (H1 TOC), Font Type, +/- Zoom, Light/Sepia/Dark */}
        <div
          data-nosnippet=""
          className="flex items-center justify-between gap-1.5 w-full px-2.5 sm:px-4 py-1.5 border-b border-[var(--reader-border)] bg-[var(--reader-bg)] text-[var(--reader-ink)] shrink-0"
        >
          {/* Left: Menu (H1 TOC) + Font Type */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setTocOpen(true)}
              aria-label="Open menu table of contents"
              className="inline-flex items-center justify-center gap-1.5 h-8 sm:h-9 px-2 sm:px-2.5 rounded-md border border-[var(--reader-border)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] transition-colors"
            >
              <Menu className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline text-xs font-semibold">Menu</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setFontMode((m) => (m === 'sans' ? 'serif' : 'sans'));
                scheduleProgressSave();
              }}
              aria-label={`Switch to ${fontMode === 'sans' ? 'Serif' : 'Sans'} font`}
              className="inline-flex items-center justify-center h-8 sm:h-9 px-2 sm:px-2.5 rounded-md border border-[var(--reader-border)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap"
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
        </div>

        {/* Slide-Over Menu (Strictly H1 Table of Contents) */}
        {tocOpen && (
          <div
            data-nosnippet=""
            className="absolute inset-0 z-30 flex bg-black/45 backdrop-blur-xs"
            onClick={() => setTocOpen(false)}
          >
            <aside
              aria-label="Table of contents"
              onClick={(e) => e.stopPropagation()}
              className="w-72 max-w-[85vw] h-full bg-[var(--reader-bg)] border-e border-[var(--reader-border-strong)] flex flex-col"
            >
              <div
                className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[var(--reader-border)]"
                style={{
                  paddingTop: 'calc(0.625rem + var(--safe-area-inset-top))',
                }}
              >
                <h2 className="text-sm font-bold truncate">Contents</h2>
                <button
                  type="button"
                  onClick={() => setTocOpen(false)}
                  aria-label="Close table of contents"
                  className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-[var(--reader-elevated)]"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {toc.length === 0 ? (
                  <p className="text-xs text-[var(--reader-muted)] p-3">
                    No chapters found in this document.
                  </p>
                ) : (
                  toc.map((entry) => {
                    const isActive = entry.id === activeHeadingId;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          setTocOpen(false);
                          jumpToHeading(entry.id);
                        }}
                        className={cn(
                          'w-full text-start min-h-[44px] px-3 py-2 rounded-md text-xs sm:text-sm transition-colors flex items-center',
                          isActive
                            ? 'bg-[var(--reader-elevated)] font-bold text-[var(--reader-ink)]'
                            : 'font-medium text-[var(--reader-muted)] hover:bg-[var(--reader-surface)] hover:text-[var(--reader-ink)]'
                        )}
                      >
                        <span className="line-clamp-2">{entry.text}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>
          </div>
        )}

        {/* Full-Width Scrollable Prose Stage with Minimal Mobile Margins */}
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overscroll-contain px-2.5 sm:px-6 lg:px-10 py-3 sm:py-5"
          style={{
            paddingBottom: 'calc(1.5rem + var(--safe-area-inset-bottom))',
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

          {loadingState === 'ready' && (
            <>
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
                {sections.map((sec) => (
                  <section
                    key={sec.sectionId}
                    data-sec-id={sec.sectionId}
                    aria-label={sec.headingTitle}
                    className="ed-md-section"
                    dangerouslySetInnerHTML={{ __html: sec.safeHtml }}
                  />
                ))}
              </article>

              {isSample && (
                <div className="mt-6">
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
