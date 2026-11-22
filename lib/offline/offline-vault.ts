'use client';

import type { ExamSet } from '../exam/types';
import { fetchClientStorageBytes } from '../firebase/storage-client';
import { apiUrl } from '../platform/api-base';
import {
  createUuidV7,
  isCapacitorNative,
  requestPersistentWebStorage,
} from '../platform/capacitor-bridge';
import type { CollectionName, UserPurchaseRecord } from '../types/catalog';
import type {
  ExamShardWorkerRequest,
  ExamShardWorkerResponse,
  ShardedExamSetSlice,
} from './exam-shard.worker';

export type OfflineAssetFormat = 'pdf' | 'markdown' | 'exam_pack' | 'exam_set';

/**
 * Canonical `offline_assets` schema indexed in SQLite (Capacitor) & IndexedDB (Web).
 */
export interface OfflineAssetRecord {
  pk: string; // `${uid}::${itemId}::${format}::${setId}`
  uid: string;
  itemId: string;
  urlSlug: string;
  collectionName: CollectionName;
  format: OfflineAssetFormat;
  setId: string; // '' for books & pack manifest, or ExamSet.id for per-set shards
  setTitle?: string;
  duration?: number;
  totalQuestions?: number;
  totalMarks?: number;
  localUri: string;
  byteSize: number;
  remoteUpdatedAt: number; // epoch ms from Firestore updatedAt
  savedAt: number; // epoch ms when saved locally
}

export interface QueuedOfflineMutation {
  idempotencyKey: string;
  uid: string;
  schemaVersion: number;
  endpoint: string;
  payloadJson: string;
  createdAt: number;
}

export interface SignedUnlockGrant {
  itemId: string;
  collectionName: CollectionName;
  urlSlug: string;
  expiresAtIso: string;
  signature: string;
  remoteUpdatedAtIso?: string;
  hasFullPdf?: boolean;
  hasFullMarkdown?: boolean;
  hasFullJson?: boolean;
  assets: {
    pdfUrl?: string;
    markdownUrl?: string;
    jsonUrl?: string;
  };
  directUrls?: {
    pdfUrl?: string;
    markdownUrl?: string;
    jsonUrl?: string;
  };
  storagePaths?: {
    fullPdfStoragePath?: string;
    fullMarkdownStoragePath?: string;
    fullJsonStoragePath?: string;
  };
}

export interface StorageUsageSummary {
  vaultBytes: number;
  assetCount: number;
  browserUsageBytes: number | null;
  browserQuotaBytes: number | null;
}

export const OFFLINE_VAULT_UPDATED_EVENT = 'ed-offline-vault-updated';

const VAULT_IDB_NAME = 'examdash_offline_vault_v3';
const VAULT_IDB_VERSION = 1;
const STORE_ASSETS_META = 'offline_assets';
const STORE_ASSET_BLOBS = 'offline_blobs';
const STORE_MUTATION_QUEUE = 'offline_mutation_queue';
const OPFS_ROOT_DIR = 'examdash-vault-v3';
const SQLITE_DB_NAME = 'examdash_offline_vault_v3';
const MIN_FREE_HEADROOM_BYTES = 8 * 1024 * 1024; // 8 MB minimum safety headroom
const MAX_SINGLE_ASSET_BYTES = 64 * 1024 * 1024; // 64 MB cap
const GRANT_CACHE_PREFIX = 'ed_signed_grant_v5:';

function parseApiErrorText(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const errField = (payload as { error?: unknown }).error;
  if (typeof errField === 'string' && errField.trim()) {
    return errField.trim();
  }
  if (errField && typeof errField === 'object') {
    const nestedMsg = (errField as { message?: unknown }).message;
    if (typeof nestedMsg === 'string' && nestedMsg.trim()) {
      return nestedMsg.trim();
    }
  }
  const topMsg = (payload as { message?: unknown }).message;
  if (typeof topMsg === 'string' && topMsg.trim()) {
    return topMsg.trim();
  }
  return fallback;
}

interface CapacitorNativePlugins {
  Filesystem?: {
    writeFile?: (opts: {
      path: string;
      data: string;
      directory: string;
      recursive?: boolean;
      isExcludedFromBackup?: boolean;
    }) => Promise<{ uri?: string }>;
    readFile?: (opts: {
      path: string;
      directory: string;
    }) => Promise<{ data: string | Blob }>;
    deleteFile?: (opts: { path: string; directory: string }) => Promise<void>;
    rename?: (opts: {
      from: string;
      to: string;
      directory: string;
      toDirectory?: string;
    }) => Promise<void>;
    rmdir?: (opts: {
      path: string;
      directory: string;
      recursive?: boolean;
    }) => Promise<void>;
  };
  CapacitorSQLite?: {
    createConnection?: (opts: {
      database: string;
      version?: number;
      encrypted?: boolean;
      mode?: string;
      readonly?: boolean;
    }) => Promise<void>;
    open?: (opts: { database: string; readonly?: boolean }) => Promise<void>;
    execute?: (opts: {
      database: string;
      statements: string;
    }) => Promise<unknown>;
    run?: (opts: {
      database: string;
      statement: string;
      values?: unknown[];
    }) => Promise<unknown>;
    query?: (opts: {
      database: string;
      statement: string;
      values?: unknown[];
    }) => Promise<{ values?: Record<string, unknown>[] }>;
  };
}

function getCapacitorPlugins(): {
  platform: 'ios' | 'android' | 'web';
  plugins: CapacitorNativePlugins;
} {
  if (typeof window === 'undefined' || !isCapacitorNative()) {
    return { platform: 'web', plugins: {} };
  }
  const win = window as unknown as {
    Capacitor?: {
      getPlatform?: () => string;
      Plugins?: CapacitorNativePlugins;
    };
  };
  const rawPlat = win.Capacitor?.getPlatform?.()?.toLowerCase() || '';
  return {
    platform: rawPlat === 'ios' ? 'ios' : 'android',
    plugins: win.Capacitor?.Plugins ?? {},
  };
}

function getNativeVaultDirectory(): string {
  const { platform } = getCapacitorPlugins();
  // LibraryNoCloud on iOS prevents WKWebView OS eviction AND iCloud backup rejection
  return platform === 'ios' ? 'LIBRARY_NO_CLOUD' : 'DATA';
}

function sanitizeSegment(raw: string, maxLen: number = 80): string {
  const cleaned = (raw || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, maxLen);
  return cleaned || 'default';
}

function makeAssetPk(
  uid: string,
  itemId: string,
  format: OfflineAssetFormat,
  setId: string = ''
): string {
  return `${sanitizeSegment(uid, 64)}::${sanitizeSegment(
    itemId,
    80
  )}::${format}::${sanitizeSegment(setId || 'root', 80)}`;
}

function buildLocalFileName(
  itemId: string,
  format: OfflineAssetFormat,
  setId: string = ''
): string {
  const safeItem = sanitizeSegment(itemId, 64);
  if (format === 'pdf') return `book_${safeItem}.pdf`;
  if (format === 'markdown') return `book_${safeItem}.md`;
  if (format === 'exam_set') {
    return `exam_${safeItem}_set_${sanitizeSegment(setId, 64)}.json`;
  }
  return `exam_${safeItem}_manifest.json`;
}

function notifyOfflineVaultUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OFFLINE_VAULT_UPDATED_EVENT));
  }
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

/* ==========================================================================
   1. IndexedDB & Capacitor SQLite Metadata + Queue Layer
   ========================================================================== */

let sqliteReadyPromise: Promise<boolean> | null = null;

async function ensureNativeSqliteReady(): Promise<boolean> {
  if (!isCapacitorNative()) return false;
  const { plugins } = getCapacitorPlugins();
  const sqlite = plugins.CapacitorSQLite;
  if (!sqlite?.execute || !sqlite?.run || !sqlite?.query) return false;

  if (!sqliteReadyPromise) {
    sqliteReadyPromise = (async () => {
      try {
        await sqlite
          .createConnection?.({
            database: SQLITE_DB_NAME,
            version: 1,
            encrypted: false,
            mode: 'no-encryption',
            readonly: false,
          })
          .catch(() => {});
        await sqlite.open?.({ database: SQLITE_DB_NAME, readonly: false }).catch(() => {});
        await sqlite.execute!({
          database: SQLITE_DB_NAME,
          statements: `
            CREATE TABLE IF NOT EXISTS offline_assets (
              pk TEXT PRIMARY KEY NOT NULL,
              uid TEXT NOT NULL,
              itemId TEXT NOT NULL,
              urlSlug TEXT NOT NULL,
              collectionName TEXT NOT NULL,
              format TEXT NOT NULL,
              setId TEXT NOT NULL,
              setTitle TEXT,
              duration INTEGER,
              totalQuestions INTEGER,
              totalMarks INTEGER,
              localUri TEXT NOT NULL,
              byteSize INTEGER NOT NULL,
              remoteUpdatedAt INTEGER NOT NULL,
              savedAt INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_offline_assets_uid ON offline_assets(uid);
            CREATE TABLE IF NOT EXISTS offline_mutation_queue (
              idempotencyKey TEXT PRIMARY KEY NOT NULL,
              uid TEXT NOT NULL,
              schemaVersion INTEGER NOT NULL,
              endpoint TEXT NOT NULL,
              payloadJson TEXT NOT NULL,
              createdAt INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_entitlements (
              uid TEXT PRIMARY KEY NOT NULL,
              payloadJson TEXT NOT NULL,
              updatedAt INTEGER NOT NULL
            );
          `,
        });
        return true;
      } catch {
        return false;
      }
    })();
  }
  return sqliteReadyPromise;
}

function openVaultIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VAULT_IDB_NAME, VAULT_IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ASSETS_META)) {
        const metaStore = db.createObjectStore(STORE_ASSETS_META, {
          keyPath: 'pk',
        });
        metaStore.createIndex('by_uid', 'uid', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_ASSET_BLOBS)) {
        db.createObjectStore(STORE_ASSET_BLOBS);
      }
      if (!db.objectStoreNames.contains(STORE_MUTATION_QUEUE)) {
        const queueStore = db.createObjectStore(STORE_MUTATION_QUEUE, {
          keyPath: 'idempotencyKey',
        });
        queueStore.createIndex('by_uid', 'uid', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function upsertOfflineAssetMeta(record: OfflineAssetRecord): Promise<void> {
  if (await ensureNativeSqliteReady()) {
    const { plugins } = getCapacitorPlugins();
    await plugins.CapacitorSQLite
      ?.run?.({
        database: SQLITE_DB_NAME,
        statement: `
          INSERT OR REPLACE INTO offline_assets (
            pk, uid, itemId, urlSlug, collectionName, format, setId,
            setTitle, duration, totalQuestions, totalMarks,
            localUri, byteSize, remoteUpdatedAt, savedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `,
        values: [
          record.pk,
          record.uid,
          record.itemId,
          record.urlSlug,
          record.collectionName,
          record.format,
          record.setId,
          record.setTitle ?? null,
          record.duration ?? null,
          record.totalQuestions ?? null,
          record.totalMarks ?? null,
          record.localUri,
          record.byteSize,
          record.remoteUpdatedAt,
          record.savedAt,
        ],
      })
      .catch(() => {});
  }

  try {
    const db = await openVaultIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS_META, 'readwrite');
      tx.objectStore(STORE_ASSETS_META).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore IDB unavailable in private/sandboxed mode
  }
}

async function deleteOfflineAssetMetaByPk(pk: string): Promise<void> {
  if (await ensureNativeSqliteReady()) {
    const { plugins } = getCapacitorPlugins();
    await plugins.CapacitorSQLite
      ?.run?.({
        database: SQLITE_DB_NAME,
        statement: 'DELETE FROM offline_assets WHERE pk = ?;',
        values: [pk],
      })
      .catch(() => {});
  }

  try {
    const db = await openVaultIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_ASSETS_META, 'readwrite');
      tx.objectStore(STORE_ASSETS_META).delete(pk);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Ignore
  }
}

export async function listUserOfflineAssets(
  uid: string
): Promise<OfflineAssetRecord[]> {
  if (typeof window === 'undefined' || !uid) return [];
  const safeUid = sanitizeSegment(uid, 64);

  if (await ensureNativeSqliteReady()) {
    const { plugins } = getCapacitorPlugins();
    try {
      const res = await plugins.CapacitorSQLite?.query?.({
        database: SQLITE_DB_NAME,
        statement:
          'SELECT * FROM offline_assets WHERE uid = ? ORDER BY savedAt DESC;',
        values: [safeUid],
      });
      if (Array.isArray(res?.values) && res.values.length > 0) {
        return res.values.map((r) => ({
          pk: String(r.pk),
          uid: String(r.uid),
          itemId: String(r.itemId),
          urlSlug: String(r.urlSlug || ''),
          collectionName:
            r.collectionName === 'ExamPackDocument'
              ? 'ExamPackDocument'
              : 'books',
          format: (r.format as OfflineAssetFormat) || 'pdf',
          setId: String(r.setId || ''),
          setTitle: typeof r.setTitle === 'string' ? r.setTitle : undefined,
          duration: typeof r.duration === 'number' ? r.duration : undefined,
          totalQuestions:
            typeof r.totalQuestions === 'number' ? r.totalQuestions : undefined,
          totalMarks:
            typeof r.totalMarks === 'number' ? r.totalMarks : undefined,
          localUri: String(r.localUri || ''),
          byteSize: Number(r.byteSize) || 0,
          remoteUpdatedAt: Number(r.remoteUpdatedAt) || 0,
          savedAt: Number(r.savedAt) || 0,
        }));
      }
    } catch {
      // Fall through to IDB mirror
    }
  }

  try {
    const db = await openVaultIdb();
    const rows = await new Promise<OfflineAssetRecord[]>((resolve) => {
      const tx = db.transaction(STORE_ASSETS_META, 'readonly');
      const idx = tx.objectStore(STORE_ASSETS_META).index('by_uid');
      const req = idx.getAll(safeUid);
      req.onsuccess = () =>
        resolve(Array.isArray(req.result) ? (req.result as OfflineAssetRecord[]) : []);
      req.onerror = () => resolve([]);
    });
    db.close();
    return rows;
  } catch {
    return [];
  }
}

/* ==========================================================================
   2. Atomic Binary / JSON File Storage (OPFS -> IDB on Web; LibraryNoCloud on Native)
   ========================================================================== */

async function getUserOpfsDir(
  uid: string,
  create: boolean
): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return null;
  }
  try {
    const root = await navigator.storage.getDirectory();
    const vaultDir = await root.getDirectoryHandle(OPFS_ROOT_DIR, { create });
    return await vaultDir.getDirectoryHandle(sanitizeSegment(uid, 64), {
      create,
    });
  } catch {
    return null;
  }
}

async function writeBinaryFileAtomic(params: {
  uid: string;
  fileName: string;
  buffer: ArrayBuffer;
  blobStoreKey: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { uid, fileName, buffer, blobStoreKey, signal } = params;
  if (signal?.aborted) return null;

  const safeUid = sanitizeSegment(uid, 64);
  const safeFile = sanitizeSegment(fileName, 120);

  // 1. Capacitor Native (`LibraryNoCloud` / `Data`, `isExcludedFromBackup: true` + atomic temp rename)
  if (isCapacitorNative()) {
    const { plugins } = getCapacitorPlugins();
    const fs = plugins.Filesystem;
    if (fs?.writeFile) {
      const directory = getNativeVaultDirectory();
      const targetPath = `vault/${safeUid}/${safeFile}`;
      const tempPath = `vault/${safeUid}/.tmp_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}_${safeFile}`;
      try {
        await fs.writeFile({
          path: tempPath,
          data: arrayBufferToBase64(buffer),
          directory,
          recursive: true,
          isExcludedFromBackup: true,
        });

        if (signal?.aborted) {
          await fs.deleteFile?.({ path: tempPath, directory }).catch(() => {});
          return null;
        }

        if (fs.rename) {
          await fs.deleteFile?.({ path: targetPath, directory }).catch(() => {});
          await fs.rename({
            from: tempPath,
            to: targetPath,
            directory,
            toDirectory: directory,
          });
        } else {
          await fs.writeFile({
            path: targetPath,
            data: arrayBufferToBase64(buffer),
            directory,
            recursive: true,
            isExcludedFromBackup: true,
          });
          await fs.deleteFile?.({ path: tempPath, directory }).catch(() => {});
        }
        return `capacitor://${directory}/${targetPath}`;
      } catch {
        await fs.deleteFile?.({ path: tempPath, directory }).catch(() => {});
        return null;
      }
    }
  }

  await requestPersistentWebStorage();

  // 2. Web Primary: Origin Private File System (OPFS)
  // FileSystemWritableFileStream writes to an isolated swap buffer and commits atomically on close()
  const opfsUserDir = await getUserOpfsDir(safeUid, true);
  if (opfsUserDir) {
    let writable: FileSystemWritableFileStream | null = null;
    try {
      const fileHandle = await opfsUserDir.getFileHandle(safeFile, {
        create: true,
      });
      writable = await fileHandle.createWritable();
      await writable.write(buffer.slice(0));
      if (signal?.aborted) {
        await writable.abort().catch(() => {});
        return null;
      }
      await writable.close();
      return `opfs://${OPFS_ROOT_DIR}/${safeUid}/${safeFile}`;
    } catch {
      if (writable) {
        await writable.abort().catch(() => {});
      }
      // Fall through to IndexedDB blob store
    }
  }

  // 3. Web Fallback: IndexedDB Atomic Transaction
  if (signal?.aborted) return null;
  try {
    const db = await openVaultIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ASSET_BLOBS, 'readwrite');
      tx.objectStore(STORE_ASSET_BLOBS).put(buffer.slice(0), blobStoreKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return `idb://${VAULT_IDB_NAME}/${blobStoreKey}`;
  } catch {
    return null;
  }
}

async function readBinaryFile(params: {
  uid: string;
  fileName: string;
  blobStoreKey: string;
}): Promise<ArrayBuffer | null> {
  const safeUid = sanitizeSegment(params.uid, 64);
  const safeFile = sanitizeSegment(params.fileName, 120);

  if (isCapacitorNative()) {
    const { plugins } = getCapacitorPlugins();
    const fs = plugins.Filesystem;
    if (fs?.readFile) {
      const directory = getNativeVaultDirectory();
      try {
        const res = await fs.readFile({
          path: `vault/${safeUid}/${safeFile}`,
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

  const opfsUserDir = await getUserOpfsDir(safeUid, false);
  if (opfsUserDir) {
    try {
      const fh = await opfsUserDir.getFileHandle(safeFile);
      const file = await fh.getFile();
      return await file.arrayBuffer();
    } catch {
      // Check IDB fallback
    }
  }

  try {
    const db = await openVaultIdb();
    const result = await new Promise<ArrayBuffer | null>((resolve) => {
      const tx = db.transaction(STORE_ASSET_BLOBS, 'readonly');
      const req = tx.objectStore(STORE_ASSET_BLOBS).get(params.blobStoreKey);
      req.onsuccess = () =>
        resolve(req.result instanceof ArrayBuffer ? req.result : null);
      req.onerror = () => resolve(null);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

async function deleteBinaryFile(params: {
  uid: string;
  fileName: string;
  blobStoreKey: string;
}): Promise<void> {
  const safeUid = sanitizeSegment(params.uid, 64);
  const safeFile = sanitizeSegment(params.fileName, 120);

  if (isCapacitorNative()) {
    const { plugins } = getCapacitorPlugins();
    const directory = getNativeVaultDirectory();
    await plugins.Filesystem
      ?.deleteFile?.({
        path: `vault/${safeUid}/${safeFile}`,
        directory,
      })
      .catch(() => {});
  }

  const opfsUserDir = await getUserOpfsDir(safeUid, false);
  if (opfsUserDir) {
    await opfsUserDir.removeEntry(safeFile).catch(() => {});
  }

  try {
    const db = await openVaultIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_ASSET_BLOBS, 'readwrite');
      tx.objectStore(STORE_ASSET_BLOBS).delete(params.blobStoreKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Ignore
  }
}

/* ==========================================================================
   3. Quota Check, Streaming Progress & Authenticated Signed Unlock
   ========================================================================== */

export async function verifyStorageQuotaAvailable(
  expectedBytes: number = 0
): Promise<{ ok: boolean; reason?: string }> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { ok: true };
  }
  try {
    const est = await navigator.storage.estimate();
    if (
      typeof est.quota === 'number' &&
      est.quota > 0 &&
      typeof est.usage === 'number'
    ) {
      const freeBytes = Math.max(0, est.quota - est.usage);
      const requiredBytes = Math.max(
        MIN_FREE_HEADROOM_BYTES,
        Math.ceil(expectedBytes * 1.15) + 2 * 1024 * 1024
      );
      if (freeBytes < requiredBytes) {
        return {
          ok: false,
          reason:
            'Insufficient local device storage. Clear cached offline files and retry.',
        };
      }
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

function getGrantCacheKey(
  uid: string,
  collectionName: CollectionName,
  urlSlug: string
): string {
  return `${GRANT_CACHE_PREFIX}${sanitizeSegment(uid, 64)}:${collectionName}:${urlSlug}`;
}

export function getCachedSignedGrant(
  uid: string,
  collectionName: CollectionName,
  urlSlug: string
): SignedUnlockGrant | null {
  if (typeof window === 'undefined' || !uid || !urlSlug) return null;
  try {
    const raw = sessionStorage.getItem(
      getGrantCacheKey(uid, collectionName, urlSlug)
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SignedUnlockGrant;
    const expMs = new Date(parsed.expiresAtIso).getTime();
    if (!Number.isFinite(expMs) || Date.now() > expMs - 60_000) {
      sessionStorage.removeItem(getGrantCacheKey(uid, collectionName, urlSlug));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function requestSignedAssetUnlock(params: {
  uid: string;
  collectionName: CollectionName;
  urlSlug: string;
  getIdToken: () => Promise<string | null>;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<SignedUnlockGrant> {
  if (!params.forceRefresh) {
    const cached = getCachedSignedGrant(
      params.uid,
      params.collectionName,
      params.urlSlug
    );
    if (cached) return cached;
  }

  const token = await params.getIdToken();
  if (!token) {
    throw new Error('Authentication session expired. Please sign in again.');
  }

  const res = await fetch(apiUrl('/api/v1/library/unlock'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': createUuidV7(),
    },
    body: JSON.stringify({
      collectionName: params.collectionName,
      urlSlug: params.urlSlug,
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(
      parseApiErrorText(
        errBody,
        `Unable to verify purchase entitlement (HTTP ${res.status}).`
      )
    );
  }

  const grant = (await res.json()) as SignedUnlockGrant;
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(
        getGrantCacheKey(params.uid, params.collectionName, params.urlSlug),
        JSON.stringify(grant)
      );
    } catch {
      // Ignore sessionStorage quota
    }
  }
  return grant;
}

async function streamDownloadBytesWithProgress(params: {
  url: string;
  bearerToken?: string | null;
  signal: AbortSignal;
  onProgress?: (pct: number) => void;
}): Promise<ArrayBuffer> {
  const preQuota = await verifyStorageQuotaAvailable(0);
  if (!preQuota.ok) {
    throw new Error(preQuota.reason);
  }

  params.onProgress?.(4);

  const headers: Record<string, string> = {};
  if (params.bearerToken) {
    headers.Authorization = `Bearer ${params.bearerToken}`;
  }

  const res = await fetch(apiUrl(params.url), {
    method: 'GET',
    headers,
    signal: params.signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(
      parseApiErrorText(errBody, `Download failed with HTTP ${res.status}.`)
    );
  }

  const totalHeader = Number(res.headers.get('content-length') || '0');
  if (totalHeader > MAX_SINGLE_ASSET_BYTES) {
    throw new Error('Asset exceeds the 64 MB safe offline storage budget.');
  }

  if (totalHeader > 0) {
    const headerQuota = await verifyStorageQuotaAvailable(totalHeader);
    if (!headerQuota.ok) {
      throw new Error(headerQuota.reason);
    }
  }

  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = await res.arrayBuffer();
    params.onProgress?.(95);
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    while (true) {
      if (params.signal.aborted) {
        await reader.cancel().catch(() => {});
        throw new DOMException('Download cancelled', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > MAX_SINGLE_ASSET_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error('Asset exceeded 64 MB byte limit during download.');
        }
        chunks.push(value);
        if (totalHeader > 0) {
          const pct = Math.min(
            94,
            Math.max(5, Math.round((received / totalHeader) * 90) + 4)
          );
          params.onProgress?.(pct);
        } else {
          // Smooth asymptotic progress when Content-Length is chunked
          const approx = Math.min(
            90,
            Math.round(90 * (1 - Math.exp(-received / (1.5 * 1024 * 1024))))
          );
          params.onProgress?.(Math.max(8, approx));
        }
      }
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  params.onProgress?.(96);
  return merged.buffer;
}

async function downloadGrantedAssetBytes(params: {
  streamUrl?: string;
  directUrl?: string;
  storagePath?: string;
  bearerToken?: string | null;
  signal: AbortSignal;
  onProgress?: (pct: number) => void;
}): Promise<ArrayBuffer> {
  let primaryError: unknown = null;

  if (params.streamUrl) {
    try {
      return await streamDownloadBytesWithProgress({
        url: params.streamUrl,
        bearerToken: params.bearerToken,
        signal: params.signal,
        onProgress: params.onProgress,
      });
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === 'AbortError') ||
        params.signal.aborted
      ) {
        throw err;
      }
      primaryError = err;
    }
  }

  if (params.storagePath) {
    try {
      params.onProgress?.(25);
      const buf = await fetchClientStorageBytes(
        params.storagePath,
        params.signal
      );
      params.onProgress?.(95);
      return buf;
    } catch (storageErr) {
      if (
        (storageErr instanceof DOMException &&
          storageErr.name === 'AbortError') ||
        params.signal.aborted
      ) {
        throw storageErr;
      }
      primaryError = primaryError ?? storageErr;
    }
  }

  if (params.directUrl && params.directUrl.startsWith('https://')) {
    try {
      return await streamDownloadBytesWithProgress({
        url: params.directUrl,
        bearerToken: null,
        signal: params.signal,
        onProgress: params.onProgress,
      });
    } catch (directErr) {
      if (
        (directErr instanceof DOMException &&
          directErr.name === 'AbortError') ||
        params.signal.aborted
      ) {
        throw directErr;
      }
      primaryError = primaryError ?? directErr;
    }
  }

  throw primaryError instanceof Error
    ? primaryError
    : new Error('Unable to download full edition file from storage.');
}

/* ==========================================================================
   4. Book Offline Operations (PDF & Markdown — Single & Combined Full Bundle)
   ========================================================================== */

export async function saveBookFormatOffline(params: {
  uid: string;
  itemId: string;
  urlSlug: string;
  format: 'pdf' | 'markdown';
  remoteUpdatedAtMs?: number;
  getIdToken: () => Promise<string | null>;
  signal: AbortSignal;
  onProgress?: (pct: number) => void;
  prebuiltBuffer?: ArrayBuffer;
  prebuiltGrant?: SignedUnlockGrant;
}): Promise<OfflineAssetRecord> {
  const safeUid = sanitizeSegment(params.uid, 64);
  const pk = makeAssetPk(safeUid, params.itemId, params.format, '');
  const fileName = buildLocalFileName(params.itemId, params.format, '');

  let buffer = params.prebuiltBuffer;
  let authoritativeRemoteMs = params.remoteUpdatedAtMs || Date.now();

  if (!buffer) {
    const grant =
      params.prebuiltGrant ??
      (await requestSignedAssetUnlock({
        uid: params.uid,
        collectionName: 'books',
        urlSlug: params.urlSlug,
        getIdToken: params.getIdToken,
        forceRefresh: true,
        signal: params.signal,
      }));

    if (grant.remoteUpdatedAtIso) {
      const parsedMs = new Date(grant.remoteUpdatedAtIso).getTime();
      if (Number.isFinite(parsedMs) && parsedMs > 0) {
        authoritativeRemoteMs = parsedMs;
      }
    }

    const streamUrl =
      params.format === 'pdf'
        ? grant.assets.pdfUrl
        : grant.assets.markdownUrl;
    const directUrl =
      params.format === 'pdf'
        ? grant.directUrls?.pdfUrl
        : grant.directUrls?.markdownUrl;
    const storagePath =
      params.format === 'pdf'
        ? grant.storagePaths?.fullPdfStoragePath
        : grant.storagePaths?.fullMarkdownStoragePath;

    if (!streamUrl && !storagePath && !directUrl) {
      throw new Error(
        `No full ${params.format.toUpperCase()} file is configured for this book.`
      );
    }

    const token = await params.getIdToken();
    buffer = await downloadGrantedAssetBytes({
      streamUrl,
      directUrl,
      storagePath,
      bearerToken: token,
      signal: params.signal,
      onProgress: params.onProgress,
    });
  }

  const localUri = await writeBinaryFileAtomic({
    uid: safeUid,
    fileName,
    buffer,
    blobStoreKey: pk,
    signal: params.signal,
  });

  if (!localUri) {
    if (params.signal.aborted) {
      throw new DOMException('Download cancelled', 'AbortError');
    }
    throw new Error('Failed to write offline file to device storage.');
  }

  const now = Date.now();
  const record: OfflineAssetRecord = {
    pk,
    uid: safeUid,
    itemId: params.itemId,
    urlSlug: params.urlSlug,
    collectionName: 'books',
    format: params.format,
    setId: '',
    localUri,
    byteSize: buffer.byteLength,
    remoteUpdatedAt: authoritativeRemoteMs,
    savedAt: now,
  };

  await upsertOfflineAssetMeta(record);
  params.onProgress?.(100);
  notifyOfflineVaultUpdated();
  return record;
}

/**
 * Downloads and saves ALL available full formats (fullPdfStoragePath & fullMarkdownStoragePath)
 * for a purchased book in a single atomic operation so the reader's PDF/Markdown toggle works
 * seamlessly offline.
 */
export async function saveBookAllFormatsOffline(params: {
  uid: string;
  itemId: string;
  urlSlug: string;
  remoteUpdatedAtMs?: number;
  getIdToken: () => Promise<string | null>;
  signal: AbortSignal;
  onProgress?: (pct: number) => void;
}): Promise<OfflineAssetRecord[]> {
  const grant = await requestSignedAssetUnlock({
    uid: params.uid,
    collectionName: 'books',
    urlSlug: params.urlSlug,
    getIdToken: params.getIdToken,
    forceRefresh: true,
    signal: params.signal,
  });

  const formatsToSave: Array<'pdf' | 'markdown'> = [];
  if (
    grant.hasFullPdf ||
    Boolean(grant.assets.pdfUrl) ||
    Boolean(grant.storagePaths?.fullPdfStoragePath)
  ) {
    formatsToSave.push('pdf');
  }
  if (
    grant.hasFullMarkdown ||
    Boolean(grant.assets.markdownUrl) ||
    Boolean(grant.storagePaths?.fullMarkdownStoragePath)
  ) {
    formatsToSave.push('markdown');
  }

  if (formatsToSave.length === 0) {
    throw new Error(
      'Full edition files (fullPdfStoragePath / fullMarkdownStoragePath) are not configured for this book yet.'
    );
  }

  const savedRecords: OfflineAssetRecord[] = [];
  const totalFormats = formatsToSave.length;

  try {
    for (let idx = 0; idx < totalFormats; idx++) {
      const fmt = formatsToSave[idx];
      const basePct = Math.round((idx / totalFormats) * 100);
      const spanPct = Math.round(100 / totalFormats);

      const rec = await saveBookFormatOffline({
        uid: params.uid,
        itemId: params.itemId,
        urlSlug: params.urlSlug,
        format: fmt,
        remoteUpdatedAtMs: params.remoteUpdatedAtMs,
        getIdToken: params.getIdToken,
        signal: params.signal,
        prebuiltGrant: grant,
        onProgress: (fmtPct) => {
          const combined = Math.min(
            99,
            Math.max(2, basePct + Math.round((fmtPct / 100) * spanPct))
          );
          params.onProgress?.(combined);
        },
      });
      savedRecords.push(rec);
    }

    params.onProgress?.(100);
    notifyOfflineVaultUpdated();
    return savedRecords;
  } catch (err) {
    if (params.signal.aborted) {
      for (const rec of savedRecords) {
        if (rec.format === 'pdf' || rec.format === 'markdown') {
          await deleteBookFormatOffline(params.uid, params.itemId, rec.format);
        }
      }
    }
    throw err;
  }
}

export async function readBookFormatOffline(
  uid: string,
  itemId: string,
  format: 'pdf' | 'markdown'
): Promise<ArrayBuffer | null> {
  if (!uid || !itemId) return null;
  const safeUid = sanitizeSegment(uid, 64);
  const pk = makeAssetPk(safeUid, itemId, format, '');
  const fileName = buildLocalFileName(itemId, format, '');
  return readBinaryFile({ uid: safeUid, fileName, blobStoreKey: pk });
}

export async function hasBookFormatOffline(
  uid: string,
  itemId: string,
  format: 'pdf' | 'markdown'
): Promise<boolean> {
  if (!uid || !itemId) return false;
  const assets = await listUserOfflineAssets(uid);
  const pk = makeAssetPk(sanitizeSegment(uid, 64), itemId, format, '');
  return assets.some((a) => a.pk === pk);
}

export async function deleteBookFormatOffline(
  uid: string,
  itemId: string,
  format: 'pdf' | 'markdown'
): Promise<void> {
  if (!uid || !itemId) return;
  const safeUid = sanitizeSegment(uid, 64);
  const pk = makeAssetPk(safeUid, itemId, format, '');
  const fileName = buildLocalFileName(itemId, format, '');
  await deleteBinaryFile({ uid: safeUid, fileName, blobStoreKey: pk });
  await deleteOfflineAssetMetaByPk(pk);
  notifyOfflineVaultUpdated();
}

export async function deleteBookAllFormatsOffline(
  uid: string,
  itemId: string
): Promise<void> {
  if (!uid || !itemId) return;
  const safeUid = sanitizeSegment(uid, 64);
  for (const fmt of ['pdf', 'markdown'] as const) {
    const pk = makeAssetPk(safeUid, itemId, fmt, '');
    const fileName = buildLocalFileName(itemId, fmt, '');
    await deleteBinaryFile({ uid: safeUid, fileName, blobStoreKey: pk });
    await deleteOfflineAssetMetaByPk(pk);
  }
  notifyOfflineVaultUpdated();
}

/* ==========================================================================
   5. Per-Set Exam JSON Sharding in Web Worker (`exam_set:{packId}:{set.id}`)
   ========================================================================== */

function extractExamSetsFallback(parsed: unknown): ExamSet[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(
      (item): item is ExamSet => Boolean(item && typeof item === 'object')
    );
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const arr = obj.sets ?? obj.examSets ?? obj.mocktests ?? obj.data;
    if (Array.isArray(arr)) {
      return arr.filter(
        (item): item is ExamSet => Boolean(item && typeof item === 'object')
      );
    }
    if (Array.isArray(obj.sections)) {
      return [parsed as ExamSet];
    }
  }
  return [];
}

function shardExamPackInWorker(
  buffer: ArrayBuffer,
  signal: AbortSignal,
  expectedSetIds?: string[]
): Promise<ShardedExamSetSlice[]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Download cancelled', 'AbortError'));
      return;
    }

    // Fallback if Web Worker is unavailable in test runner
    if (typeof Worker === 'undefined') {
      try {
        const text = new TextDecoder('utf-8').decode(buffer);
        const parsed = extractExamSetsFallback(JSON.parse(text));
        if (parsed.length === 0) {
          reject(new Error('Invalid ExamSet[] JSON payload.'));
          return;
        }
        const encoder = new TextEncoder();
        const slices: ShardedExamSetSlice[] = parsed.map((set, idx) => {
          const rawId = set.id?.trim() || '';
          const setId =
            rawId &&
            (!expectedSetIds ||
              expectedSetIds.length === 0 ||
              expectedSetIds.includes(rawId))
              ? rawId
              : expectedSetIds?.[idx] || rawId || `exam_set_${idx + 1}`;
          const bytes = encoder.encode(JSON.stringify({ ...set, id: setId }));
          const sliceBuf = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          );
          return {
            setId,
            title: set.title || `Mock Set ${idx + 1}`,
            duration: Number(set.duration) || 60,
            totalQuestions: Number(set.totalQuestions) || 0,
            totalMarks: Number(set.totalMarks) || 0,
            byteSize: sliceBuf.byteLength,
            buffer: sliceBuf,
          };
        });
        resolve(slices);
      } catch (e) {
        reject(e);
      }
      return;
    }

    const worker = new Worker(
      new URL('./exam-shard.worker.ts', import.meta.url)
    );
    const requestId = `shard_${Date.now()}`;

    const onAbort = () => {
      worker.terminate();
      reject(new DOMException('Download cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (ev: MessageEvent<ExamShardWorkerResponse>) => {
      const msg = ev.data;
      if (!msg || msg.requestId !== requestId) return;
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      if (msg.type === 'SHARD_SUCCESS') {
        resolve(msg.slices);
      } else {
        reject(new Error(msg.message));
      }
    };

    worker.onerror = () => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      reject(new Error('Exam pack sharding worker failed.'));
    };

    const transferable = buffer.slice(0);
    worker.postMessage(
      {
        type: 'SHARD_EXAM_PACK',
        requestId,
        buffer: transferable,
        expectedSetIds,
      } satisfies ExamShardWorkerRequest,
      [transferable]
    );
  });
}

export async function saveExamPackShardedOffline(params: {
  uid: string;
  packId: string;
  urlSlug: string;
  remoteUpdatedAtMs?: number;
  expectedSetIds?: string[];
  getIdToken: () => Promise<string | null>;
  signal: AbortSignal;
  onProgress?: (pct: number) => void;
  prebuiltSets?: ExamSet[];
}): Promise<OfflineAssetRecord[]> {
  const safeUid = sanitizeSegment(params.uid, 64);
  let authoritativeRemoteMs = params.remoteUpdatedAtMs || Date.now();
  let rawBuffer: ArrayBuffer;

  if (params.prebuiltSets && params.prebuiltSets.length > 0) {
    rawBuffer = new TextEncoder().encode(JSON.stringify(params.prebuiltSets))
      .buffer;
  } else {
    const grant = await requestSignedAssetUnlock({
      uid: params.uid,
      collectionName: 'ExamPackDocument',
      urlSlug: params.urlSlug,
      getIdToken: params.getIdToken,
      forceRefresh: true,
      signal: params.signal,
    });

    if (grant.remoteUpdatedAtIso) {
      const parsedMs = new Date(grant.remoteUpdatedAtIso).getTime();
      if (Number.isFinite(parsedMs) && parsedMs > 0) {
        authoritativeRemoteMs = parsedMs;
      }
    }

    const jsonUrl =
      grant.assets.jsonUrl ||
      `/api/v1/exams/${encodeURIComponent(params.urlSlug)}?mode=full`;

    const token = await params.getIdToken();
    rawBuffer = await downloadGrantedAssetBytes({
      streamUrl: jsonUrl,
      directUrl: grant.directUrls?.jsonUrl,
      storagePath: grant.storagePaths?.fullJsonStoragePath,
      bearerToken: token,
      signal: params.signal,
      onProgress: (dlPct) => {
        params.onProgress?.(Math.min(82, dlPct));
      },
    });
  }

  // Parse once in Web Worker & shard into individual set_{id}.json files
  const slices = await shardExamPackInWorker(
    rawBuffer,
    params.signal,
    params.expectedSetIds
  );
  const writtenRecords: OfflineAssetRecord[] = [];
  const writtenCleanupTargets: Array<{
    pk: string;
    fileName: string;
  }> = [];

  try {
    for (let i = 0; i < slices.length; i++) {
      if (params.signal.aborted) {
        throw new DOMException('Download cancelled', 'AbortError');
      }
      const slice = slices[i];
      const pk = makeAssetPk(safeUid, params.packId, 'exam_set', slice.setId);
      const fileName = buildLocalFileName(
        params.packId,
        'exam_set',
        slice.setId
      );
      const localUri = await writeBinaryFileAtomic({
        uid: safeUid,
        fileName,
        buffer: slice.buffer,
        blobStoreKey: pk,
        signal: params.signal,
      });

      if (!localUri) {
        throw new Error(`Failed to write offline shard for ${slice.setId}.`);
      }

      writtenCleanupTargets.push({ pk, fileName });

      const now = Date.now();
      const rec: OfflineAssetRecord = {
        pk,
        uid: safeUid,
        itemId: params.packId,
        urlSlug: params.urlSlug,
        collectionName: 'ExamPackDocument',
        format: 'exam_set',
        setId: slice.setId,
        setTitle: slice.title,
        duration: slice.duration,
        totalQuestions: slice.totalQuestions,
        totalMarks: slice.totalMarks,
        localUri,
        byteSize: slice.byteSize,
        remoteUpdatedAt: authoritativeRemoteMs,
        savedAt: now,
      };
      await upsertOfflineAssetMeta(rec);
      writtenRecords.push(rec);

      const shardPct = 84 + Math.round(((i + 1) / slices.length) * 15);
      params.onProgress?.(Math.min(99, shardPct));
    }

    // Write pack-level index marker so pack-level Offline Ready & byte totals resolve in O(1)
    const totalBytes = slices.reduce((acc, s) => acc + s.byteSize, 0);
    const packManifestPk = makeAssetPk(safeUid, params.packId, 'exam_pack', '');
    const manifestRec: OfflineAssetRecord = {
      pk: packManifestPk,
      uid: safeUid,
      itemId: params.packId,
      urlSlug: params.urlSlug,
      collectionName: 'ExamPackDocument',
      format: 'exam_pack',
      setId: '',
      localUri: `exam_pack://${params.packId}`,
      byteSize: totalBytes,
      remoteUpdatedAt: authoritativeRemoteMs,
      savedAt: Date.now(),
    };
    await upsertOfflineAssetMeta(manifestRec);

    params.onProgress?.(100);
    notifyOfflineVaultUpdated();
    return writtenRecords;
  } catch (err) {
    // Atomic rollback if cancelled or failed mid-pack so zero partial shards remain
    for (const target of writtenCleanupTargets) {
      await deleteBinaryFile({
        uid: safeUid,
        fileName: target.fileName,
        blobStoreKey: target.pk,
      });
      await deleteOfflineAssetMetaByPk(target.pk);
    }
    throw err;
  }
}

/**
 * Reads ONLY a single `set_{id}.json` shard (< 200 KB) into ExamEngine in < 10ms
 * without loading the entire ExamPack into WebView RAM.
 */
export async function readExamSetShardOffline(
  uid: string,
  packId: string,
  setId: string
): Promise<ExamSet | null> {
  if (!uid || !packId || !setId) return null;
  const safeUid = sanitizeSegment(uid, 64);
  const pk = makeAssetPk(safeUid, packId, 'exam_set', setId);
  const fileName = buildLocalFileName(packId, 'exam_set', setId);
  const buf = await readBinaryFile({
    uid: safeUid,
    fileName,
    blobStoreKey: pk,
  });
  if (!buf) return null;
  try {
    const json = new TextDecoder('utf-8').decode(buf);
    const parsed = JSON.parse(json) as ExamSet;
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.sections)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export async function deleteExamPackOffline(
  uid: string,
  packId: string
): Promise<void> {
  if (!uid || !packId) return;
  const safeUid = sanitizeSegment(uid, 64);
  const all = await listUserOfflineAssets(uid);
  const packAssets = all.filter(
    (a) => a.collectionName === 'ExamPackDocument' && a.itemId === packId
  );

  for (const asset of packAssets) {
    if (asset.format === 'exam_set') {
      const fileName = buildLocalFileName(packId, 'exam_set', asset.setId);
      await deleteBinaryFile({
        uid: safeUid,
        fileName,
        blobStoreKey: asset.pk,
      });
    }
    await deleteOfflineAssetMetaByPk(asset.pk);
  }

  // Ensure manifest record is deleted even if no shards matched
  await deleteOfflineAssetMetaByPk(makeAssetPk(safeUid, packId, 'exam_pack', ''));
  notifyOfflineVaultUpdated();
}

/* ==========================================================================
   6. Pillar 4 SQLite / IndexedDB Mutation Queue (Idempotency-Key UUIDv7)
   ========================================================================== */

export async function enqueueOfflineVaultMutation(
  mutation: QueuedOfflineMutation
): Promise<void> {
  if (typeof window === 'undefined') return;
  const safeUid = sanitizeSegment(mutation.uid || 'anon', 64);
  const record: QueuedOfflineMutation = {
    ...mutation,
    uid: safeUid,
  };

  if (await ensureNativeSqliteReady()) {
    const { plugins } = getCapacitorPlugins();
    await plugins.CapacitorSQLite
      ?.run?.({
        database: SQLITE_DB_NAME,
        statement: `
          INSERT OR REPLACE INTO offline_mutation_queue
          (idempotencyKey, uid, schemaVersion, endpoint, payloadJson, createdAt)
          VALUES (?, ?, ?, ?, ?, ?);
        `,
        values: [
          record.idempotencyKey,
          record.uid,
          record.schemaVersion,
          record.endpoint,
          record.payloadJson,
          record.createdAt,
        ],
      })
      .catch(() => {});
  }

  try {
    const db = await openVaultIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_MUTATION_QUEUE, 'readwrite');
      tx.objectStore(STORE_MUTATION_QUEUE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Ignore
  }
}

export async function listQueuedOfflineMutations(
  uid?: string
): Promise<QueuedOfflineMutation[]> {
  if (typeof window === 'undefined') return [];
  const safeUid = uid ? sanitizeSegment(uid, 64) : null;

  if (await ensureNativeSqliteReady()) {
    const { plugins } = getCapacitorPlugins();
    try {
      const res = await plugins.CapacitorSQLite?.query?.({
        database: SQLITE_DB_NAME,
        statement: safeUid
          ? 'SELECT * FROM offline_mutation_queue WHERE uid = ? ORDER BY createdAt ASC;'
          : 'SELECT * FROM offline_mutation_queue ORDER BY createdAt ASC;',
        values: safeUid ? [safeUid] : [],
      });
      if (Array.isArray(res?.values) && res.values.length > 0) {
        return res.values.map((r) => ({
          idempotencyKey: String(r.idempotencyKey),
          uid: String(r.uid),
          schemaVersion: Number(r.schemaVersion) || 1,
          endpoint: String(r.endpoint || '/api/v1/exams/attempts'),
          payloadJson: String(r.payloadJson || '{}'),
          createdAt: Number(r.createdAt) || Date.now(),
        }));
      }
    } catch {
      // Fall through to IDB
    }
  }

  try {
    const db = await openVaultIdb();
    const list = await new Promise<QueuedOfflineMutation[]>((resolve) => {
      const tx = db.transaction(STORE_MUTATION_QUEUE, 'readonly');
      const store = tx.objectStore(STORE_MUTATION_QUEUE);
      const req = safeUid
        ? store.index('by_uid').getAll(safeUid)
        : store.getAll();
      req.onsuccess = () =>
        resolve(
          Array.isArray(req.result) ? (req.result as QueuedOfflineMutation[]) : []
        );
      req.onerror = () => resolve([]);
    });
    db.close();
    return list;
  } catch {
    return [];
  }
}

export async function removeQueuedOfflineMutation(
  idempotencyKey: string
): Promise<void> {
  if (typeof window === 'undefined' || !idempotencyKey) return;

  if (await ensureNativeSqliteReady()) {
    const { plugins } = getCapacitorPlugins();
    await plugins.CapacitorSQLite
      ?.run?.({
        database: SQLITE_DB_NAME,
        statement:
          'DELETE FROM offline_mutation_queue WHERE idempotencyKey = ?;',
        values: [idempotencyKey],
      })
      .catch(() => {});
  }

  try {
    const db = await openVaultIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_MUTATION_QUEUE, 'readwrite');
      tx.objectStore(STORE_MUTATION_QUEUE).delete(idempotencyKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Ignore
  }
}

/* ==========================================================================
   7. Storage Usage Telemetry, Cache Management & Sign-Out Auth Isolation
   ========================================================================== */

export async function getStorageUsageSummary(
  uid: string
): Promise<StorageUsageSummary> {
  const assets = await listUserOfflineAssets(uid);
  // Sum actual stored files (books + exam_set shards; avoid double-counting exam_pack manifest)
  let vaultBytes = 0;
  let assetCount = 0;
  for (const a of assets) {
    if (a.format === 'pdf' || a.format === 'markdown') {
      vaultBytes += a.byteSize;
      assetCount += 1;
    } else if (a.format === 'exam_pack') {
      assetCount += 1;
    } else if (a.format === 'exam_set') {
      vaultBytes += a.byteSize;
    }
  }

  let browserUsageBytes: number | null = null;
  let browserQuotaBytes: number | null = null;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      browserUsageBytes = typeof est.usage === 'number' ? est.usage : null;
      browserQuotaBytes = typeof est.quota === 'number' ? est.quota : null;
    } catch {
      // Ignore
    }
  }

  return {
    vaultBytes,
    assetCount,
    browserUsageBytes,
    browserQuotaBytes,
  };
}

export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Clears all cached offline books and exam shards for the active user ("Clear Cache").
 */
export async function clearAllUserOfflineAssets(uid: string): Promise<void> {
  if (typeof window === 'undefined' || !uid) return;
  const safeUid = sanitizeSegment(uid, 64);
  const assets = await listUserOfflineAssets(uid);

  for (const a of assets) {
    if (a.format !== 'exam_pack') {
      const fileName = buildLocalFileName(a.itemId, a.format, a.setId);
      await deleteBinaryFile({
        uid: safeUid,
        fileName,
        blobStoreKey: a.pk,
      });
    }
    await deleteOfflineAssetMetaByPk(a.pk);
  }

  if (isCapacitorNative()) {
    const { plugins } = getCapacitorPlugins();
    const directory = getNativeVaultDirectory();
    await plugins.Filesystem
      ?.rmdir?.({
        path: `vault/${safeUid}`,
        directory,
        recursive: true,
      })
      .catch(() => {});
  }

  if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const vaultDir = await root.getDirectoryHandle(OPFS_ROOT_DIR, {
        create: false,
      });
      await vaultDir.removeEntry(safeUid, { recursive: true }).catch(() => {});
    } catch {
      // Ignore if directory didn't exist
    }
  }

  notifyOfflineVaultUpdated();
}

/**
 * Auth Isolation Mandate: Purges & locks all UID-scoped offline vault files,
 * SQLite rows, and ephemeral signed URL grants on explicit Sign-Out or Account Deletion.
 */
export async function purgeOfflineVaultForUser(uid: string): Promise<void> {
  if (typeof window === 'undefined' || !uid) return;
  const safeUid = sanitizeSegment(uid, 64);

  await clearAllUserOfflineAssets(uid);

  // Clear queued offline mutations for signed-out UID
  if (await ensureNativeSqliteReady()) {
    const { plugins } = getCapacitorPlugins();
    await plugins.CapacitorSQLite
      ?.run?.({
        database: SQLITE_DB_NAME,
        statement: 'DELETE FROM offline_mutation_queue WHERE uid = ?;',
        values: [safeUid],
      })
      .catch(() => {});
    await plugins.CapacitorSQLite
      ?.run?.({
        database: SQLITE_DB_NAME,
        statement: 'DELETE FROM user_entitlements WHERE uid = ?;',
        values: [safeUid],
      })
      .catch(() => {});
  }

  try {
    localStorage.removeItem(`ed-entitlements-v1:${safeUid}`);
  } catch {
    // Ignore
  }

  try {
    const db = await openVaultIdb();
    const existingQueue = await listQueuedOfflineMutations(uid);
    if (existingQueue.length > 0) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_MUTATION_QUEUE, 'readwrite');
        const store = tx.objectStore(STORE_MUTATION_QUEUE);
        for (const item of existingQueue) {
          store.delete(item.idempotencyKey);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    db.close();
  } catch {
    // Ignore
  }

  // Purge sessionStorage short-lived signed URL grants
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(`${GRANT_CACHE_PREFIX}${safeUid}:`)) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      sessionStorage.removeItem(k);
    }
  } catch {
    // Ignore
  }

  notifyOfflineVaultUpdated();
}

const ENTITLEMENTS_LS_PREFIX = 'ed-entitlements-v1:';

/**
 * Reads cached owned item entitlements from SQLite (Capacitor Native) or localStorage (Web)
 * so `/purchased` boots instantaneously even when offline.
 */
export async function readCachedUserEntitlements(
  uid: string
): Promise<UserPurchaseRecord[]> {
  if (typeof window === 'undefined' || !uid) return [];
  const safeUid = sanitizeSegment(uid, 64);

  if (await ensureNativeSqliteReady()) {
    const { plugins } = getCapacitorPlugins();
    try {
      const res = await plugins.CapacitorSQLite?.query?.({
        database: SQLITE_DB_NAME,
        statement: 'SELECT payloadJson FROM user_entitlements WHERE uid = ? LIMIT 1;',
        values: [safeUid],
      });
      const rawJson = res?.values?.[0]?.payloadJson;
      if (typeof rawJson === 'string' && rawJson) {
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed)) {
          return parsed as UserPurchaseRecord[];
        }
      }
    } catch {
      // Fall through to localStorage
    }
  }

  try {
    const raw = localStorage.getItem(`${ENTITLEMENTS_LS_PREFIX}${safeUid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UserPurchaseRecord[]) : [];
  } catch {
    return [];
  }
}

export async function writeCachedUserEntitlements(
  uid: string,
  records: UserPurchaseRecord[]
): Promise<void> {
  if (typeof window === 'undefined' || !uid) return;
  const safeUid = sanitizeSegment(uid, 64);
  const payloadJson = JSON.stringify(records);

  if (await ensureNativeSqliteReady()) {
    const { plugins } = getCapacitorPlugins();
    await plugins.CapacitorSQLite
      ?.run?.({
        database: SQLITE_DB_NAME,
        statement: `
          INSERT OR REPLACE INTO user_entitlements (uid, payloadJson, updatedAt)
          VALUES (?, ?, ?);
        `,
        values: [safeUid, payloadJson, Date.now()],
      })
      .catch(() => {});
  }

  try {
    localStorage.setItem(`${ENTITLEMENTS_LS_PREFIX}${safeUid}`, payloadJson);
  } catch {
    // Ignore quota errors
  }
}

