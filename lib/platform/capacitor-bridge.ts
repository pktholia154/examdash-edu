/**
 * Runtime Capacitor Platform Guards, Native Preferences, SystemBars & Offline Storage Persistence
 * Zero static native imports so web & crawler bundles never pull native bridge code.
 */

const AUTHED_PREF_KEY = 'ed-authed';

interface CapacitorGlobalBridge {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    Preferences?: {
      get?: (opts: { key: string }) => Promise<{ value?: string | null }>;
      set?: (opts: { key: string; value: string }) => Promise<void>;
      remove?: (opts: { key: string }) => Promise<void>;
    };
    StatusBar?: {
      setStyle?: (opts: { style: 'DARK' | 'LIGHT' | 'DEFAULT' }) => Promise<void>;
      setBackgroundColor?: (opts: { color: string }) => Promise<void>;
    };
    SystemBars?: {
      setStyle?: (opts: { style: 'DARK' | 'LIGHT' | 'DEFAULT' }) => Promise<void>;
      setColor?: (opts: { color: string }) => Promise<void>;
    };
  };
}

function getCapacitorGlobal(): CapacitorGlobalBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobalBridge }).Capacitor;
}

export function isCapacitorNative(): boolean {
  return Boolean(getCapacitorGlobal()?.isNativePlatform?.());
}

export function getCapacitorPlatform(): 'ios' | 'android' | 'web' {
  if (!isCapacitorNative()) return 'web';
  const raw = getCapacitorGlobal()?.getPlatform?.()?.toLowerCase() || '';
  if (raw === 'ios') return 'ios';
  return 'android';
}

/**
 * Checks whether the user previously signed in (`ed-authed === "1"`).
 * Uses `localStorage` on Web and `@capacitor/preferences` runtime plugin on Capacitor Native.
 * Prevents loading Firebase Auth chunks/iframes for anonymous guests and Googlebot.
 */
export async function readPersistedAuthHint(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  if (isCapacitorNative()) {
    const prefs = getCapacitorGlobal()?.Plugins?.Preferences;
    if (prefs?.get) {
      try {
        const res = await prefs.get({ key: AUTHED_PREF_KEY });
        if (res?.value === '1') return true;
        if (res?.value === '0') return false;
      } catch {
        // Fall back to localStorage mirror
      }
    }
  }

  try {
    return localStorage.getItem(AUTHED_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export async function writePersistedAuthHint(authed: boolean): Promise<void> {
  if (typeof window === 'undefined') return;

  if (isCapacitorNative()) {
    const prefs = getCapacitorGlobal()?.Plugins?.Preferences;
    try {
      if (authed) {
        await prefs?.set?.({ key: AUTHED_PREF_KEY, value: '1' });
      } else {
        await prefs?.remove?.({ key: AUTHED_PREF_KEY });
      }
    } catch {
      // Ignore native plugin error
    }
  }

  try {
    if (authed) {
      localStorage.setItem(AUTHED_PREF_KEY, '1');
    } else {
      localStorage.removeItem(AUTHED_PREF_KEY);
    }
  } catch {
    // Ignore private mode storage errors
  }
}

/**
 * Mirrors `#0B1120` (dark) / `#F8FAFC` (light) theme colors to `@capacitor/status-bar`
 * and `SystemBars` on Capacitor Native boot and theme switches.
 */
export async function syncNativeSystemBars(theme: 'light' | 'dark'): Promise<void> {
  if (!isCapacitorNative()) return;
  const plugins = getCapacitorGlobal()?.Plugins;
  const hexColor = theme === 'dark' ? '#0B1120' : '#F8FAFC';
  // In Capacitor StatusBar, 'DARK' renders light text/icons for dark backgrounds,
  // and 'LIGHT' renders dark text/icons for light backgrounds.
  const barStyle = theme === 'dark' ? 'DARK' : 'LIGHT';

  try {
    await plugins?.StatusBar?.setStyle?.({ style: barStyle });
    await plugins?.StatusBar?.setBackgroundColor?.({ color: hexColor });
    await plugins?.SystemBars?.setStyle?.({ style: barStyle });
    await plugins?.SystemBars?.setColor?.({ color: hexColor });
  } catch {
    // Non-blocking on platforms where status bar color is OS-locked
  }
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
