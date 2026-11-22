'use client';

import firebaseConfig from '../../firebase-applet-config.json';
import { getFirebaseApp } from './client';

const MAX_STORAGE_DOWNLOAD_BYTES = 64 * 1024 * 1024; // 64 MB cap

function extractCleanObjectPath(rawPathOrUrl: string): {
  bucketUrl?: string;
  objectPath: string;
} | null {
  const trimmed = (rawPathOrUrl || '').trim();
  if (!trimmed || trimmed.includes('..') || /[\u0000-\u001f]/.test(trimmed)) {
    return null;
  }

  if (trimmed.startsWith('gs://')) {
    const withoutScheme = trimmed.slice(5);
    const slashIdx = withoutScheme.indexOf('/');
    if (slashIdx <= 0) return null;
    const bucket = withoutScheme.slice(0, slashIdx).trim();
    const obj = withoutScheme.slice(slashIdx + 1).trim();
    if (!bucket || !obj || obj.includes('..')) return null;
    return { bucketUrl: `gs://${bucket}`, objectPath: obj };
  }

  if (trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.hostname === 'firebasestorage.googleapis.com') {
        const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
        if (!match) return null;
        const bucket = decodeURIComponent(match[1]);
        const obj = decodeURIComponent(match[2]);
        if (!bucket || !obj || obj.includes('..')) return null;
        return { bucketUrl: `gs://${bucket}`, objectPath: obj };
      }
      if (parsed.hostname === 'storage.googleapis.com') {
        const parts = parsed.pathname.replace(/^\/+/, '').split('/');
        if (parts.length < 2) return null;
        const bucket = decodeURIComponent(parts[0]);
        const obj = decodeURIComponent(parts.slice(1).join('/'));
        if (!bucket || !obj || obj.includes('..')) return null;
        return { bucketUrl: `gs://${bucket}`, objectPath: obj };
      }
    } catch {
      return null;
    }
    return null;
  }

  const normalized = trimmed.replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) return null;
  const configuredBucket = (firebaseConfig.storageBucket || '').trim();
  return {
    bucketUrl: configuredBucket ? `gs://${configuredBucket}` : undefined,
    objectPath: normalized,
  };
}

/**
 * Lazily loads `firebase/storage` ONLY for authenticated paid users when direct
 * Firebase Storage byte retrieval is required by Storage Security Rules.
 */
export async function fetchClientStorageBytes(
  storagePathOrUrl: string,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  if (signal?.aborted) {
    throw new DOMException('Download cancelled', 'AbortError');
  }

  const target = extractCleanObjectPath(storagePathOrUrl);
  if (!target) {
    throw new Error('Invalid Firebase Storage path.');
  }

  const { getStorage, ref, getBytes, getDownloadURL } = await import(
    'firebase/storage'
  );
  const app = getFirebaseApp();
  const storage = target.bucketUrl
    ? getStorage(app, target.bucketUrl)
    : getStorage(app);
  const objectRef = ref(storage, target.objectPath);

  try {
    let bytes: ArrayBuffer;
    try {
      bytes = await getBytes(objectRef, MAX_STORAGE_DOWNLOAD_BYTES);
    } catch (firstErr) {
      if (signal?.aborted) {
        throw new DOMException('Download cancelled', 'AbortError');
      }
      const code = (firstErr as { code?: string } | null)?.code || '';
      if (code.includes('unauthorized') || code.includes('unauthenticated')) {
        await new Promise<void>((r) => setTimeout(r, 250));
        bytes = await getBytes(objectRef, MAX_STORAGE_DOWNLOAD_BYTES);
      } else {
        throw firstErr;
      }
    }
    if (signal?.aborted) {
      throw new DOMException('Download cancelled', 'AbortError');
    }
    return bytes;
  } catch (sdkErr) {
    if (signal?.aborted) {
      throw new DOMException('Download cancelled', 'AbortError');
    }
    // Secondary fallback via authenticated download URL if CORS/getBytes varies by bucket
    const downloadUrl = await getDownloadURL(objectRef).catch(() => '');
    if (!downloadUrl) {
      throw sdkErr;
    }
    const res = await fetch(downloadUrl, { method: 'GET', signal });
    if (!res.ok) {
      throw sdkErr;
    }
    return res.arrayBuffer();
  }
}
