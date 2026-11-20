'use client';

import {
  isCapacitorNative,
  requestPersistentWebStorage,
} from '../../../lib/platform/capacitor-bridge';

export type ReaderPlatform = 'web' | 'capacitor-android' | 'capacitor-ios';
export type ReaderComfortTheme = 'light' | 'sepia' | 'dark';
export type MarkdownFontMode = 'sans' | 'serif';

export interface PdfReadingProgress {
  pageIndex: number; // 1-indexed (1..pageCount)
  scrollRatioX: number; // 0..1
  scrollRatioY: number; // 0..1
  zoomScale: number; // 1.0..3.5
  comfortTheme: ReaderComfortTheme;
  updatedAt: number;
}

export interface MarkdownReadingProgress {
  blockId: string;
  blockProgressRatio: number; // 0..1
  mdScale: number; // 0.80..2.00
  fontMode: MarkdownFontMode;
  theme: ReaderComfortTheme;
  updatedAt: number;
}

interface CapacitorPluginsRuntime {
  Filesystem?: {
    writeFile?: (opts: {
      path: string;
      data: string;
      directory: string;
      recursive?: boolean;
      isExcludedFromBackup?: boolean;
    }) => Promise<unknown>;
    readFile?: (opts: {
      path: string;
      directory: string;
    }) => Promise<{ data: string | Blob }>;
    stat?: (opts: { path: string; directory: string }) => Promise<unknown>;
    deleteFile?: (opts: { path: string; directory: string }) => Promise<unknown>;
  };
  Preferences?: {
    get?: (opts: { key: string }) => Promise<{ value: string | null }>;
    set?: (opts: { key: string; value: string }) => Promise<void>;
  };
  Browser?: {
    open?: (opts: { url: string }) => Promise<void>;
  };
  StatusBar?: {
    hide?: () => Promise<void>;
    show?: () => Promise<void>;
  };
  App?: {
    addListener?: (
      eventName: string,
      cb: (state: { isActive: boolean }) => void
    ) => Promise<{ remove: () => Promise<void> }>;
  };
}

function getCapacitorRuntime(): {
  getPlatform?: () => string;
  convertFileSrc?: (filePath: string) => string;
  Plugins?: CapacitorPluginsRuntime;
} | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    Capacitor?: {
      getPlatform?: () => string;
      convertFileSrc?: (filePath: string) => string;
      Plugins?: CapacitorPluginsRuntime;
    };
  };
  return win.Capacitor ?? null;
}

export function getReaderPlatform(): ReaderPlatform {
  if (typeof window === 'undefined') return 'web';
  if (isCapacitorNative()) {
    const plat = getCapacitorRuntime()?.getPlatform?.()?.toLowerCase() || '';
    if (plat === 'ios') return 'capacitor-ios';
    return 'capacitor-android';
  }
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) {
    return 'web';
  }
  return 'web';
}

export function isWebKitConstrainedDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    getReaderPlatform() === 'capacitor-ios' ||
    /iPad|iPhone|iPod/.test(ua) ||
    (/^((?!chrome|android).)*safari/i.test(ua) && navigator.maxTouchPoints > 1)
  );
}

export function getPdfCanvasWindowRadius(): number {
  const platform = getReaderPlatform();
  if (platform === 'capacitor-ios' || isWebKitConstrainedDevice()) return 2;
  if (platform === 'capacitor-android') return 3;
  return 4;
}

export function getPdfNeighborMaxDpr(): number {
  const platform = getReaderPlatform();
  if (platform === 'web' && !isWebKitConstrainedDevice()) return 2.0;
  return 1.75;
}

/**
 * Tall-glyph / Indic script detection so matras & diacritics never clip.
 */
const TALL_SCRIPT_LANGUAGES = new Set([
  'hindi',
  'bengali',
  'bangla',
  'tamil',
  'telugu',
  'marathi',
  'gujarati',
  'kannada',
  'malayalam',
  'punjabi',
  'odia',
  'oriya',
  'assamese',
  'sanskrit',
  'urdu',
  'arabic',
  'thai',
  'sinhala',
  'nepali',
  'bilingual',
]);

export function isTallScriptLanguage(language: string, sampleText?: string): boolean {
  const normalized = (language || '').trim().toLowerCase();
  for (const token of TALL_SCRIPT_LANGUAGES) {
    if (normalized.includes(token)) return true;
  }
  if (sampleText && /[\u0900-\u0DFF\u0E00-\u0E7F\u0600-\u06FF]/.test(sampleText.slice(0, 1200))) {
    return true;
  }
  return false;
}

/**
 * Capacitor-safe external link opener (avoids window.open popup blockers inside iframes/WebViews).
 */
export async function openExternalReaderUrl(url: string): Promise<void> {
  if (!url || typeof window === 'undefined') return;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;

    if (isCapacitorNative()) {
      const browserPlugin = getCapacitorRuntime()?.Plugins?.Browser;
      if (browserPlugin?.open) {
        await browserPlugin.open({ url: parsed.href });
        return;
      }
    }

    const anchor = document.createElement('a');
    anchor.href = parsed.href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } catch {
    // Ignore malformed URLs
  }
}

/**
 * Platform-aware Immersive Reader Toggle (Fullscreen API on Web; StatusBar + Safe-Area CSS on Native).
 */
export async function setPlatformImmersiveMode(
  enable: boolean,
  containerEl?: HTMLElement | null
): Promise<void> {
  if (typeof window === 'undefined') return;

  if (isCapacitorNative()) {
    const statusBar = getCapacitorRuntime()?.Plugins?.StatusBar;
    try {
      if (enable) {
        await statusBar?.hide?.();
      } else {
        await statusBar?.show?.();
      }
    } catch {
      // Ignore if plugin unavailable
    }
    return;
  }

  try {
    if (enable && containerEl && typeof containerEl.requestFullscreen === 'function') {
      if (!document.fullscreenElement) {
        await containerEl.requestFullscreen();
      }
    } else if (!enable && document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      await document.exitFullscreen();
    }
  } catch {
    // Iframes or iOS Safari without Fullscreen API gracefully rely on the CSS 100dvh overlay
  }
}

/* ==========================================================================
   Eviction-Safe Offline Vault (OPFS -> IndexedDB on Web; Filesystem on Native)
   ========================================================================== */

const IDB_NAME = 'examdash_reader_vault_v1';
const IDB_STORE = 'offline_assets';
const OPFS_DIR = 'examdash-vault-v1';

function sanitizeVaultKey(rawKey: string): string {
  return rawKey.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(
      String.fromCharCode.apply(
        null,
        Array.from(bytes.subarray(i, i + chunkSize))
      )
    );
  }
  return btoa(chunks.join(''));
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function openVaultIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getOpfsDirHandle(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return null;
  }
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(OPFS_DIR, { create });
  } catch {
    return null;
  }
}

export async function saveOfflineAsset(
  vaultKey: string,
  buffer: ArrayBuffer
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const safeKey = sanitizeVaultKey(vaultKey);

  if (isCapacitorNative()) {
    const fsPlugin = getCapacitorRuntime()?.Plugins?.Filesystem;
    if (fsPlugin?.writeFile) {
      const platform = getReaderPlatform();
      const directory =
        platform === 'capacitor-ios' ? 'LIBRARY_NO_CLOUD' : 'DATA';
      try {
        await fsPlugin.writeFile({
          path: `vault/${safeKey}`,
          data: arrayBufferToBase64(buffer),
          directory,
          recursive: true,
          isExcludedFromBackup: true,
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  await requestPersistentWebStorage();

  // 1. Primary Web Vault: Origin Private File System (OPFS)
  const opfsDir = await getOpfsDirHandle(true);
  if (opfsDir) {
    try {
      const fileHandle = await opfsDir.getFileHandle(safeKey, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(buffer.slice(0));
      await writable.close();
      return true;
    } catch {
      // Fall through to IndexedDB
    }
  }

  // 2. Fallback Web Vault: IndexedDB
  try {
    const db = await openVaultIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(buffer.slice(0), safeKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function readOfflineAsset(
  vaultKey: string
): Promise<ArrayBuffer | null> {
  if (typeof window === 'undefined') return null;
  const safeKey = sanitizeVaultKey(vaultKey);

  if (isCapacitorNative()) {
    const fsPlugin = getCapacitorRuntime()?.Plugins?.Filesystem;
    if (fsPlugin?.readFile) {
      const platform = getReaderPlatform();
      const directory =
        platform === 'capacitor-ios' ? 'LIBRARY_NO_CLOUD' : 'DATA';
      try {
        const res = await fsPlugin.readFile({
          path: `vault/${safeKey}`,
          directory,
        });
        if (typeof res.data === 'string') {
          return base64ToArrayBuffer(res.data);
        }
        if (res.data instanceof Blob) {
          return await res.data.arrayBuffer();
        }
      } catch {
        return null;
      }
    }
  }

  const opfsDir = await getOpfsDirHandle(false);
  if (opfsDir) {
    try {
      const fileHandle = await opfsDir.getFileHandle(safeKey);
      const file = await fileHandle.getFile();
      return await file.arrayBuffer();
    } catch {
      // Check IndexedDB fallback
    }
  }

  try {
    const db = await openVaultIdb();
    const result = await new Promise<ArrayBuffer | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(safeKey);
      req.onsuccess = () => {
        resolve(req.result instanceof ArrayBuffer ? req.result : null);
      };
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function hasOfflineAsset(vaultKey: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const safeKey = sanitizeVaultKey(vaultKey);

  if (isCapacitorNative()) {
    const fsPlugin = getCapacitorRuntime()?.Plugins?.Filesystem;
    if (fsPlugin?.stat) {
      const directory =
        getReaderPlatform() === 'capacitor-ios' ? 'LIBRARY_NO_CLOUD' : 'DATA';
      try {
        await fsPlugin.stat({ path: `vault/${safeKey}`, directory });
        return true;
      } catch {
        return false;
      }
    }
  }

  const opfsDir = await getOpfsDirHandle(false);
  if (opfsDir) {
    try {
      await opfsDir.getFileHandle(safeKey);
      return true;
    } catch {
      // Check IndexedDB
    }
  }

  try {
    const db = await openVaultIdb();
    const exists = await new Promise<boolean>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getKey(safeKey);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => resolve(false);
    });
    db.close();
    return exists;
  } catch {
    return false;
  }
}

export async function removeOfflineAsset(vaultKey: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const safeKey = sanitizeVaultKey(vaultKey);

  if (isCapacitorNative()) {
    const fsPlugin = getCapacitorRuntime()?.Plugins?.Filesystem;
    const directory =
      getReaderPlatform() === 'capacitor-ios' ? 'LIBRARY_NO_CLOUD' : 'DATA';
    await fsPlugin?.deleteFile?.({ path: `vault/${safeKey}`, directory }).catch(() => {});
  }

  const opfsDir = await getOpfsDirHandle(false);
  if (opfsDir) {
    await opfsDir.removeEntry(safeKey).catch(() => {});
  }

  try {
    const db = await openVaultIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(safeKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Ignore
  }
}

/* ==========================================================================
   Reader Progress & Preferences Sync (localStorage + @capacitor/preferences)
   ========================================================================== */

export function readStoredJsonSync<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function readStoredJson<T>(key: string): Promise<T | null> {
  if (typeof window === 'undefined') return null;
  if (isCapacitorNative()) {
    const prefs = getCapacitorRuntime()?.Plugins?.Preferences;
    if (prefs?.get) {
      try {
        const { value } = await prefs.get({ key });
        if (value) return JSON.parse(value) as T;
      } catch {
        // Fall through to localStorage
      }
    }
  }
  return readStoredJsonSync<T>(key);
}

export function writeStoredJsonSync<T>(key: string, payload: T): void {
  if (typeof window === 'undefined') return;
  const serialized = JSON.stringify(payload);
  try {
    localStorage.setItem(key, serialized);
  } catch {
    // Ignore quota errors
  }
  if (isCapacitorNative()) {
    const prefs = getCapacitorRuntime()?.Plugins?.Preferences;
    void prefs?.set?.({ key, value: serialized }).catch(() => {});
  }
}

/**
 * Attaches visibilitychange + Capacitor appStateChange lifecycle flush listeners.
 */
export function registerLifecycleFlush(flushFn: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      flushFn();
    }
  };
  const onPageHide = () => flushFn();

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);

  let nativeHandle: { remove: () => Promise<void> } | null = null;
  if (isCapacitorNative()) {
    const appPlugin = getCapacitorRuntime()?.Plugins?.App;
    void appPlugin
      ?.addListener?.('appStateChange', (state) => {
        if (!state.isActive) {
          flushFn();
        }
      })
      .then((h) => {
        nativeHandle = h;
      })
      .catch(() => {});
  }

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    if (nativeHandle) {
      void nativeHandle.remove().catch(() => {});
    }
  };
}
