/**
 * Runtime Capacitor Platform Guards & Offline Storage Persistence
 * Zero static native imports so web & crawler bundles never pull native bridge code.
 */

export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  return Boolean(win.Capacitor?.isNativePlatform?.());
}

export async function requestPersistentWebStorage(): Promise<boolean> {
  if (typeof window === 'undefined' || isCapacitorNative()) return false;
  if (navigator.storage && typeof navigator.storage.persist === 'function') {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Generates a time-ordered UUIDv7 string for deterministic Idempotency-Key headers.
 */
export function createUuidV7(): string {
  const now = Date.now();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  const high16 = Math.floor(now / 0x100000000);
  const low32 = now >>> 0;
  bytes[0] = (high16 >>> 8) & 0xff;
  bytes[1] = high16 & 0xff;
  bytes[2] = (low32 >>> 24) & 0xff;
  bytes[3] = (low32 >>> 16) & 0xff;
  bytes[4] = (low32 >>> 8) & 0xff;
  bytes[5] = low32 & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Sanitizes incoming Universal / App Link paths against open-redirect or parameter injection.
 */
export function sanitizeDeepLinkPath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') return '/';
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return '/';
  }
  try {
    const parsed = new URL(trimmed, 'https://examdash.local');
    if (parsed.origin !== 'https://examdash.local') return '/';
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '/';
  }
}
