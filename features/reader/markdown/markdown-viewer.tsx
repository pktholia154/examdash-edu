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
import {
  AlertCircle,
  Check,
  Download,
  Eye,
  EyeOff,
  List,
  Loader2,
  Maximize2,
  Minimize2,
  Moon,
  RefreshCw,
  Search,
  Sun,
  Sunset,
  Trash2,
  X,
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
  DiagramLightbox,
  type LightboxPayload,
} from '../shared/diagram-lightbox';
import {
  hasOfflineAsset,
  isTallScriptLanguage,
  openExternalReaderUrl,
  readOfflineAsset,
  readStoredJsonSync,
  registerLifecycleFlush,
  removeOfflineAsset,
  saveOfflineAsset,
  setPlatformImmersiveMode,
  writeStoredJsonSync,
  type MarkdownFontMode,
  type MarkdownReadingProgress,
  type ReaderComfortTheme,
} from '../shared/platform-adapter';
import { SampleUnlockCard } from '../shared/sample-unlock-card';
import type {
  MarkdownSearchEntry,
  MarkdownTocItem,
  MarkdownWorkerRequest,
  MarkdownWorkerResponse,
} from './markdown-parse.worker';

export interface MarkdownViewerProps {
  book: PublicBookDTO;
  streamUrl: string;
  initialMarkdownText?: string;
  isSample: boolean;
  userId?: string;
  preferOffline?: boolean;
  bearerTokenProvider?: () => Promise<string | null>;
  onRefreshSignedUrl?: () => Promise<string | null>;
  onSwitchToFullMode?: () => void;
  embeddedHeightClass?: string;
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

function sanitizeMarkdownHtml(rawHtml: string): string {
  if (typeof window === 'undefined') return '';
  return DOMPurify.sanitize(rawHtml, {
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
    ADD_TAGS: [
      'details',
      'summary',
      'math',
      'semantics',
      'mrow',
      'mi',
      'mo',
      'mn',
      'msup',
      'msub',
      'mfrac',
      'msqrt',
      'mtext',
      'annotation',
    ],
    ADD_ATTR: [
      'open',
      'data-block-id',
      'data-sec-id',
      'data-code-copy',
      'data-table-expand',
      'data-md-lightbox',
      'loading',
      'decoding',
      'referrerpolicy',
      'aria-hidden',
    ],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|tel|blob):|data:image\/(?:png|jpe?g|webp|gif|avif);base64,|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}

export function MarkdownViewer({
  book,
  streamUrl,
  initialMarkdownText,
  isSample,
  userId,
  preferOffline = false,
  bearerTokenProvider,
  onRefreshSignedUrl,
  onSwitchToFullMode,
  embeddedHeightClass = 'h-[78svh] min-h-[520px]',
}: MarkdownViewerProps) {
  const router = useRouter();
  const { showToast } = useToast();

  const progressKey = `ed-md-prog-v1:${book.id}:${isSample ? 'sample' : 'full'}`;
  const vaultKey = `md_${book.id}_${isSample ? 'sample' : 'full'}.md`;

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
  const [searchIndex, setSearchIndex] = useState<MarkdownSearchEntry[]>([]);
  const [hasSolutions, setHasSolutions] = useState(false);
  const [allSolutionsOpen, setAllSolutionsOpen] = useState(false);

  const [activeHeadingTitle, setActiveHeadingTitle] = useState<string>(book.title);
  const [activeHeadingId, setActiveHeadingId] = useState<string>('');
  const [scrollProgressPct, setScrollProgressPct] = useState<number>(0);

  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(
    null
  );
  const [lightboxPayload, setLightboxPayload] =
    useState<LightboxPayload | null>(null);
  const [isImmersive, setIsImmersive] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);

  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [rawMarkdownSample, setRawMarkdownSample] = useState<string>(
    initialMarkdownText || ''
  );

  const [isSavedOffline, setIsSavedOffline] = useState(false);
  const [isSavingOffline, setIsSavingOffline] = useState(false);

  const rootContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const proseRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const codeMapRef = useRef<Record<string, string>>({});
  const tableMapRef = useRef<Record<string, string>>({});
  const rawMarkdownBytesRef = useRef<ArrayBuffer | null>(null);

  const [reloadNonce, setReloadNonce] = useState(0);
  const mdScaleRef = useRef<number>(mdScale);
  const bearerTokenProviderRef = useRef(bearerTokenProvider);
  const onRefreshSignedUrlRef = useRef(onRefreshSignedUrl);
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

  useEffect(() => {
    let active = true;
    const syncVaultState = async () => {
      const exists =
        !isSample && userId
          ? await hasBookFormatOffline(userId, book.id, 'markdown')
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

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && isImmersive) {
        setIsImmersive(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [isImmersive]);

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

  // Keyboard shortcuts: Cmd/Ctrl + F (In-Book Search), Cmd/Ctrl + +/-/0 (Zoom)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 40);
        return;
      }
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
      if (e.key === 'Escape') {
        if (tocOpen) setTocOpen(false);
        if (searchOpen) setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyScaleWithEyeLineLock, searchOpen, tocOpen]);

  // Mobile Two-Finger Pinch on Prose -> Live Floating "130%" Pill (24px deadzone), Commit on Lift
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

  // Fetch & Parse Markdown via Worker + Main-Thread DOMPurify Sanitization
  useEffect(() => {
    let cancelled = false;

    const readFromLocalVault = async (): Promise<ArrayBuffer | null> => {
      if (!isSample && userId) {
        const uidBuf = await readBookFormatOffline(userId, book.id, 'markdown');
        if (uidBuf) return uidBuf;
      }
      return readOfflineAsset(vaultKey);
    };

    const fetchOnlineMarkdownBuffer = async (): Promise<ArrayBuffer> => {
      let resolvedUrl = streamUrl;
      if (!resolvedUrl && !isSample && onRefreshSignedUrlRef.current) {
        resolvedUrl = (await onRefreshSignedUrlRef.current()) || '';
      }
      if (!resolvedUrl) {
        throw new Error('No Markdown stream URL configured for this book.');
      }

      const fetchWithToken = async (url: string): Promise<Response> => {
        const headers: Record<string, string> = {};
        const tokenProvider = bearerTokenProviderRef.current;
        if (tokenProvider) {
          const token = await tokenProvider();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        return fetch(url, { method: 'GET', headers });
      };

      let res = await fetchWithToken(resolvedUrl);
      if (
        (res.status === 401 || res.status === 403) &&
        !isSample &&
        onRefreshSignedUrlRef.current
      ) {
        const refreshed = await onRefreshSignedUrlRef.current();
        if (refreshed) {
          res = await fetchWithToken(refreshed);
        }
      }

      if (!res.ok) {
        const errObj = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errObj.error || `Failed to load Markdown stream (HTTP ${res.status}).`
        );
      }

      return res.arrayBuffer();
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
            rawMarkdownBytesRef.current = offlineBuf;
            markdownText = new TextDecoder('utf-8').decode(offlineBuf);
          } else if (initialMarkdownText && initialMarkdownText.trim().length > 0) {
            markdownText = initialMarkdownText;
            rawMarkdownBytesRef.current = new TextEncoder().encode(
              markdownText
            ).buffer;
          } else if (streamUrl) {
            const buf = await fetchOnlineMarkdownBuffer();
            rawMarkdownBytesRef.current = buf;
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
                'This Markdown edition is not saved offline on this device yet. Reconnect to read online or save offline.'
              );
            }
            rawMarkdownBytesRef.current = buf;
            markdownText = new TextDecoder('utf-8').decode(buf);
          } else {
            try {
              const buf = await fetchOnlineMarkdownBuffer();
              rawMarkdownBytesRef.current = buf;
              markdownText = new TextDecoder('utf-8').decode(buf);
            } catch (onlineErr) {
              if (cancelled) return;
              const vaultFallback = await readFromLocalVault();
              if (vaultFallback) {
                rawMarkdownBytesRef.current = vaultFallback;
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

        worker.onmessage = async (ev: MessageEvent<MarkdownWorkerResponse>) => {
          if (cancelled) return;
          const data = ev.data;
          if (!data || data.type !== 'PARSE_SUCCESS' || data.requestId !== reqId) {
            return;
          }

          if (data.hasMath) {
            await import('./katex-styles-loader').catch(() => {});
          }
          if (cancelled) return;

          codeMapRef.current = data.codeMap;
          tableMapRef.current = data.tableMap;

          const sanitized: SanitizedSection[] = data.sections.map((sec) => ({
            sectionId: sec.sectionId,
            headingTitle: sec.headingTitle,
            safeHtml: sanitizeMarkdownHtml(sec.rawHtml),
          }));

          setSections(sanitized);
          setToc(data.toc);
          setSearchIndex(data.searchIndex);
          setHasSolutions(data.hasSolutionAccordions);
          if (data.toc.length > 0) {
            setActiveHeadingTitle(data.toc[0].text);
            setActiveHeadingId(data.toc[0].id);
          } else {
            setActiveHeadingTitle(book.title);
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
          err instanceof Error ? err.message : 'Unable to load Markdown stream.'
        );
      }
    };

    void runLoad();
    return () => {
      cancelled = true;
    };
  }, [
    book.fullDescription,
    book.id,
    book.seoDescription,
    book.title,
    initialMarkdownText,
    isSample,
    preferOffline,
    reloadNonce,
    streamUrl,
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
          36;
        scroller.scrollTo({ top: Math.max(0, targetTop), behavior: 'instant' });
      }
    });
  }, [loadingState, savedInitial, sections.length]);

  // Scroll listener -> 2px progress hairline + Active Chapter/Heading tracking
  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    const prose = proseRef.current;
    if (!scroller || !prose) return;

    const maxScroll = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    const pct = Math.min(100, Math.max(0, (scroller.scrollTop / maxScroll) * 100));
    setScrollProgressPct(pct);

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
      setActiveHeadingTitle(currentToc.text);
      setActiveHeadingId(currentToc.id);
    }

    scheduleProgressSave();
  }, [scheduleProgressSave, toc]);

  // Jump to Heading or Search Match Block
  const jumpToBlockOrHeading = useCallback(
    (opts: { headingId?: string; blockId?: string; highlight?: boolean }) => {
      const scroller = scrollerRef.current;
      const prose = proseRef.current;
      if (!scroller || !prose) return;

      const selector = opts.headingId
        ? `#${CSS.escape(opts.headingId)}`
        : opts.blockId
        ? `[data-block-id="${CSS.escape(opts.blockId)}"]`
        : '';
      if (!selector) return;

      const targetEl = prose.querySelector<HTMLElement>(selector);
      if (!targetEl) return;

      const scrollerRect = scroller.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const destination = Math.max(
        0,
        scroller.scrollTop + (targetRect.top - scrollerRect.top) - 32
      );
      scroller.scrollTo({ top: destination, behavior: 'smooth' });

      if (opts.highlight && opts.blockId) {
        // Remove previous highlight class
        prose
          .querySelectorAll('.ed-md-block-highlight')
          .forEach((el) => el.classList.remove('ed-md-block-highlight'));
        targetEl.classList.add('ed-md-block-highlight');
        setHighlightedBlockId(opts.blockId);
      }
    },
    []
  );

  // Clear search highlight when search closes
  useEffect(() => {
    if (!searchOpen && highlightedBlockId && proseRef.current) {
      proseRef.current
        .querySelectorAll('.ed-md-block-highlight')
        .forEach((el) => el.classList.remove('ed-md-block-highlight'));
      setHighlightedBlockId(null);
    }
  }, [highlightedBlockId, searchOpen]);

  // Single Delegated Click / Link / Lightbox / Code-Copy Interceptor
  const handleProseClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // 1. 1-Tap Copy Code Button
      const copyBtn = target.closest<HTMLButtonElement>('[data-code-copy]');
      if (copyBtn) {
        e.preventDefault();
        const codeId = copyBtn.getAttribute('data-code-copy') || '';
        const rawCode = codeMapRef.current[codeId] ?? '';
        if (rawCode && navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(rawCode).then(() => {
            showToast('Code snippet copied to clipboard!', 'success');
          });
        }
        return;
      }

      // 2. Expand Wide Table into Pinch-Zoom Lightbox
      const expandTableBtn =
        target.closest<HTMLButtonElement>('[data-table-expand]');
      if (expandTableBtn) {
        e.preventDefault();
        const tableId = expandTableBtn.getAttribute('data-table-expand') || '';
        const rawTable = tableMapRef.current[tableId] ?? '';
        if (rawTable) {
          setLightboxPayload({
            kind: 'table',
            title: `${book.title} — Expanded Data Table`,
            sanitizedTableHtml: sanitizeMarkdownHtml(rawTable),
          });
        }
        return;
      }

      // 3. Tap-to-Expand Image / Diagram Lightbox
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

      // 4. Delegated Link Interceptor (#anchor, internal /books|/exams, external Capacitor Browser)
      const anchorEl = target.closest<HTMLAnchorElement>('a[href]');
      if (anchorEl) {
        const rawHref = anchorEl.getAttribute('href') || '';
        if (!rawHref) return;

        if (rawHref.startsWith('#')) {
          e.preventDefault();
          const slug = decodeURIComponent(rawHref.slice(1));
          jumpToBlockOrHeading({ headingId: slug });
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
    [book.title, jumpToBlockOrHeading, router, showToast]
  );

  // Reveal / Collapse All MCQ Solutions Toggle
  const handleToggleAllSolutions = () => {
    const next = !allSolutionsOpen;
    setAllSolutionsOpen(next);
    const prose = proseRef.current;
    if (!prose) return;
    prose.querySelectorAll<HTMLDetailsElement>('details').forEach((d) => {
      d.open = next;
    });
  };

  const handleToggleOfflineVault = async () => {
    if (isSavedOffline) {
      if (!isSample && userId) {
        await deleteBookFormatOffline(userId, book.id, 'markdown');
      } else {
        await removeOfflineAsset(vaultKey);
      }
      setIsSavedOffline(false);
      showToast('Removed offline Markdown copy from device vault.');
      return;
    }
    const buf = rawMarkdownBytesRef.current;
    if (!buf) return;
    setIsSavingOffline(true);
    try {
      if (!isSample && userId) {
        const ctrl = new AbortController();
        await saveBookFormatOffline({
          uid: userId,
          itemId: book.id,
          urlSlug: book.urlSlug,
          format: 'markdown',
          remoteUpdatedAtMs:
            new Date(book.updatedAtIso).getTime() || Date.now(),
          getIdToken: bearerTokenProviderRef.current || (async () => null),
          signal: ctrl.signal,
          prebuiltBuffer: buf.slice(0),
        });
        setIsSavedOffline(true);
        showToast('Saved Markdown book to offline study vault!', 'success');
      } else {
        const ok = await saveOfflineAsset(vaultKey, buf);
        if (ok) {
          setIsSavedOffline(true);
          showToast('Saved Markdown book to offline study vault!', 'success');
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

  const handleToggleImmersive = async () => {
    const next = !isImmersive;
    setIsImmersive(next);
    await setPlatformImmersiveMode(next, rootContainerRef.current);
  };

  // Filtered In-Book Search Results
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const matches: Array<{
      blockId: string;
      headingTitle: string;
      snippet: string;
    }> = [];

    for (const item of searchIndex) {
      const idx = item.text.toLowerCase().indexOf(q);
      if (idx !== -1) {
        const start = Math.max(0, idx - 42);
        const end = Math.min(item.text.length, idx + q.length + 68);
        const snippet =
          (start > 0 ? '…' : '') +
          item.text.slice(start, end) +
          (end < item.text.length ? '…' : '');
        matches.push({
          blockId: item.blockId,
          headingTitle: item.headingTitle,
          snippet,
        });
        if (matches.length >= 40) break;
      }
    }
    return matches;
  }, [searchIndex, searchQuery]);

  const displayedScalePct = Math.round((livePinchScale ?? mdScale) * 100);

  return (
    <>
      <div
        ref={rootContainerRef}
        className={cn(
          'relative flex flex-col rounded-xl border border-[var(--reader-border,var(--border-subtle))] overflow-hidden',
          comfortTheme === 'light' && 'ed-reader-skin-light',
          comfortTheme === 'sepia' && 'ed-reader-skin-sepia',
          comfortTheme === 'dark' && 'ed-reader-skin-dark',
          isImmersive
            ? 'fixed inset-0 z-50 h-[100dvh] w-screen rounded-none border-0'
            : embeddedHeightClass
        )}
        style={{ backgroundColor: 'var(--reader-bg)', color: 'var(--reader-ink)' }}
      >
        {/* 2px Top Reading-Progress Hairline */}
        <div
          aria-hidden="true"
          className="h-0.5 w-full bg-[var(--reader-border)] shrink-0 overflow-hidden"
        >
          <div
            className="h-full bg-[var(--reader-accent)] transition-transform duration-150 origin-left"
            style={{
              transform: `scaleX(${scrollProgressPct / 100})`,
            }}
          />
        </div>

        {/* Context Header & Study Controls */}
        {hudVisible && (
          <div
            data-nosnippet=""
            className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b border-[var(--reader-border)] bg-[var(--reader-bg)] shrink-0"
            style={{
              paddingTop: isImmersive
                ? 'calc(0.5rem + var(--safe-area-inset-top))'
                : undefined,
            }}
          >
            {/* Active Chapter / Slide-Over TOC Trigger */}
            <button
              type="button"
              onClick={() => setTocOpen(true)}
              aria-label="Open Table of Contents"
              className="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] transition-colors max-w-[220px] sm:max-w-xs"
            >
              <List className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="text-xs sm:text-sm font-semibold truncate">
                {activeHeadingTitle}
              </span>
            </button>

            {/* Typography, Scale, Search, Solutions, Skin & Vault Controls */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* In-Book Search Trigger */}
              <button
                type="button"
                aria-pressed={searchOpen}
                onClick={() => {
                  setSearchOpen((v) => !v);
                  setTimeout(() => searchInputRef.current?.focus(), 40);
                }}
                aria-label="Search inside book"
                className={cn(
                  'inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-[var(--reader-border)] transition-colors',
                  searchOpen
                    ? 'bg-[var(--reader-accent)] text-[var(--reader-accent-ink)]'
                    : 'bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)]'
                )}
              >
                <Search className="w-4 h-4" aria-hidden="true" />
              </button>

              {/* Reveal / Hide All Solutions (shown automatically for Question Banks) */}
              {hasSolutions && (
                <button
                  type="button"
                  onClick={handleToggleAllSolutions}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  {allSolutionsOpen ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                      <span className="hidden md:inline">Hide Answers</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                      <span className="hidden md:inline">Show Answers</span>
                    </>
                  )}
                </button>
              )}

              {/* 1-Tap Sans <-> Serif Reader Toggle */}
              <button
                type="button"
                onClick={() => {
                  setFontMode((m) => (m === 'sans' ? 'serif' : 'sans'));
                  scheduleProgressSave();
                }}
                aria-label={`Switch to ${fontMode === 'sans' ? 'Serif' : 'Sans'} font`}
                className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] text-xs font-semibold transition-colors whitespace-nowrap"
              >
                {fontMode === 'sans' ? 'Sans' : 'Serif'}
              </button>

              {/* Synchronous Eye-Line Lock A- / 100% / A+ Controls */}
              <div
                role="group"
                aria-label="Text size controls"
                className="inline-flex items-center rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] p-0.5 tabular-nums"
              >
                <button
                  type="button"
                  disabled={mdScale <= MIN_MD_SCALE}
                  onClick={() => applyScaleWithEyeLineLock(mdScale - MD_SCALE_STEP)}
                  aria-label="Decrease text size"
                  className="min-h-[40px] px-2.5 text-xs font-bold rounded-md hover:bg-[var(--reader-elevated)] disabled:opacity-40 transition-colors"
                >
                  A−
                </button>
                <button
                  type="button"
                  onClick={() => applyScaleWithEyeLineLock(1.0)}
                  aria-label="Reset text size to 100%"
                  className="min-h-[40px] px-2 text-xs font-semibold rounded-md hover:bg-[var(--reader-elevated)] transition-colors whitespace-nowrap"
                >
                  {displayedScalePct}%
                </button>
                <button
                  type="button"
                  disabled={mdScale >= MAX_MD_SCALE}
                  onClick={() => applyScaleWithEyeLineLock(mdScale + MD_SCALE_STEP)}
                  aria-label="Increase text size"
                  className="min-h-[40px] px-2.5 text-xs font-bold rounded-md hover:bg-[var(--reader-elevated)] disabled:opacity-40 transition-colors"
                >
                  A+
                </button>
              </div>

              {/* Comfort Skins (Light / Warm Sepia / True Dark) */}
              <div
                role="group"
                aria-label="Reading comfort theme"
                className="inline-flex items-center rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] p-0.5"
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
                  onClick={() => {
                    setComfortTheme('sepia');
                    scheduleProgressSave();
                  }}
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
                  onClick={() => {
                    setComfortTheme('dark');
                    scheduleProgressSave();
                  }}
                  aria-label="True dark mode"
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

              {/* Offline Study Vault Toggle */}
              <button
                type="button"
                disabled={isSavingOffline || loadingState !== 'ready'}
                onClick={() => void handleToggleOfflineVault()}
                aria-label={
                  isSavedOffline
                    ? 'Remove offline Markdown copy'
                    : 'Save Markdown book for offline study'
                }
                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] hover:bg-[var(--reader-elevated)] disabled:opacity-40 text-xs font-semibold transition-colors whitespace-nowrap"
              >
                {isSavedOffline ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[var(--status-success)]" aria-hidden="true" />
                    <span className="hidden sm:inline">Offline</span>
                    <Trash2 className="w-3 h-3 opacity-60" aria-hidden="true" />
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

        {/* Lightweight In-Book Search Panel */}
        {searchOpen && (
          <div
            data-nosnippet=""
            className="border-b border-[var(--reader-border)] bg-[var(--reader-surface)] p-3 space-y-2.5 shrink-0"
          >
            <div className="flex items-center gap-2 max-w-2xl mx-auto">
              <div className="relative flex-1">
                <Search
                  className="w-4 h-4 text-[var(--reader-muted)] absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search terms, concepts, or question numbers..."
                  className="w-full min-h-[44px] ps-9 pe-3 rounded-lg border border-[var(--reader-border-strong)] bg-[var(--reader-bg)] text-base text-[var(--reader-ink)]"
                />
              </div>
              <span className="text-xs font-semibold text-[var(--reader-muted)] tabular-nums whitespace-nowrap">
                {searchQuery.trim().length >= 2
                  ? `${searchResults.length} hits`
                  : 'Min 2 chars'}
              </span>
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                aria-label="Close in-book search"
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-[var(--reader-border)] bg-[var(--reader-bg)]"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {searchResults.length > 0 && (
              <div className="max-h-48 overflow-y-auto max-w-2xl mx-auto divide-y divide-[var(--reader-border)] rounded-lg border border-[var(--reader-border)] bg-[var(--reader-bg)]">
                {searchResults.map((hit, idx) => (
                  <button
                    key={`${hit.blockId}-${idx}`}
                    type="button"
                    onClick={() =>
                      jumpToBlockOrHeading({
                        blockId: hit.blockId,
                        highlight: true,
                      })
                    }
                    className="w-full text-start px-3.5 py-2.5 hover:bg-[var(--reader-elevated)] transition-colors block"
                  >
                    <p className="text-[11px] font-semibold text-[var(--reader-muted)] truncate">
                      {hit.headingTitle}
                    </p>
                    <p className="text-xs text-[var(--reader-ink)] line-clamp-2 mt-0.5">
                      {hit.snippet}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Slide-Over Table of Contents Drawer */}
        {tocOpen && (
          <div
            data-nosnippet=""
            className="absolute inset-0 z-30 flex bg-black/45 backdrop-blur-xs"
            onClick={() => setTocOpen(false)}
          >
            <aside
              aria-label="Table of contents"
              onClick={(e) => e.stopPropagation()}
              className="w-80 max-w-[86vw] h-full bg-[var(--reader-bg)] border-e border-[var(--reader-border-strong)] flex flex-col"
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-[var(--reader-border)]">
                <h2 className="text-sm font-bold truncate">Table of Contents</h2>
                <button
                  type="button"
                  onClick={() => setTocOpen(false)}
                  aria-label="Close Table of Contents"
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg hover:bg-[var(--reader-elevated)]"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-1">
                {toc.length === 0 ? (
                  <p className="text-xs text-[var(--reader-muted)] p-3">
                    No chapter headings detected in this document.
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
                          jumpToBlockOrHeading({ headingId: entry.id });
                        }}
                        className={cn(
                          'w-full text-start min-h-[44px] px-3 py-2 rounded-lg text-xs sm:text-sm transition-colors flex items-center',
                          entry.level === 2 && 'ps-6',
                          entry.level === 3 && 'ps-9 text-xs',
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

        {/* Main Scrollable Reflowable Prose Stage */}
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-8 py-6 sm:py-10"
          style={{
            paddingBottom: isImmersive
              ? 'calc(2.5rem + var(--safe-area-inset-bottom))'
              : undefined,
          }}
        >
          {loadingState === 'loading' && (
            <div className="flex flex-col items-center justify-center h-full min-h-[320px] text-center">
              <Loader2
                className="w-7 h-7 animate-spin text-[var(--reader-muted)] mb-3"
                aria-hidden="true"
              />
              <p className="text-sm font-semibold">
                Chunking & Sanitizing Study Sections...
              </p>
            </div>
          )}

          {loadingState === 'error' && (
            <div className="flex flex-col items-center justify-center h-full min-h-[320px] text-center p-6">
              <AlertCircle
                className="w-7 h-7 text-[var(--status-danger)] mb-3"
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
                className="mt-5 inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-[var(--reader-accent)] text-[var(--reader-accent-ink)] text-sm font-semibold"
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

              {/* End-of-Sample Native Unlock Card */}
              {isSample && (
                <div className="mt-8">
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

        {/* Live Mobile Pinch Scale Pill */}
        {livePinchScale !== null && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 z-20 rounded-lg border border-[var(--reader-border-strong)] bg-[var(--reader-bg)]/95 px-3.5 py-1.5 text-xs font-bold tabular-nums text-[var(--reader-ink)] shadow-sm"
          >
            {Math.round(livePinchScale * 100)}%
          </div>
        )}

        {/* Footer Progress Summary & Focus Mode Toggle */}
        {hudVisible && loadingState === 'ready' && (
          <div
            data-nosnippet=""
            className="flex items-center justify-between gap-3 px-4 py-2 border-t border-[var(--reader-border)] bg-[var(--reader-bg)] text-xs text-[var(--reader-muted)] tabular-nums shrink-0"
          >
            <span>{Math.round(scrollProgressPct)}% read</span>
            <button
              type="button"
              onClick={() => setHudVisible(false)}
              className="min-h-[36px] px-2 font-semibold hover:text-[var(--reader-ink)]"
            >
              Focus Mode
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

      {/* Full-Screen Pinch-Zoom Lightbox for Diagrams & Expanded Tables */}
      <DiagramLightbox
        payload={lightboxPayload}
        onClose={() => setLightboxPayload(null)}
      />
    </>
  );
}
