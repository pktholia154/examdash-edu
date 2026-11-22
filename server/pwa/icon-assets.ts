import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const APP_ICON_VERSION = 'ef0c6c39';

export type AppIconRouteKey =
  | 'apple-touch-icon.png'
  | 'icon-192.png'
  | 'icon-512.png'
  | 'maskable-192.png'
  | 'maskable-512.png'
  | 'favicon-32.png';

const ICON_DISK_MAP: Record<AppIconRouteKey, string> = {
  'apple-touch-icon.png': 'apple-touch-icon.png',
  'icon-192.png': 'pwa-192x192.png',
  'icon-512.png': 'pwa-512x512.png',
  'maskable-192.png': 'pwa-maskable-192x192.png',
  'maskable-512.png': 'pwa-maskable-512x512.png',
  'favicon-32.png': 'favicon-32x32.png',
};

const iconBufferCache = new Map<AppIconRouteKey, Promise<Buffer>>();

export function isSupportedAppIconKey(value: string): value is AppIconRouteKey {
  return Object.prototype.hasOwnProperty.call(ICON_DISK_MAP, value);
}

export function loadAppIconBuffer(key: AppIconRouteKey): Promise<Buffer> {
  const existing = iconBufferCache.get(key);
  if (existing) {
    return existing;
  }

  const diskName = ICON_DISK_MAP[key];
  const filePath = path.join(process.cwd(), 'public', diskName);
  const loadPromise = readFile(filePath).catch((err) => {
    iconBufferCache.delete(key);
    throw err;
  });

  iconBufferCache.set(key, loadPromise);
  return loadPromise;
}

export async function loadAppIconDataUri(key: AppIconRouteKey): Promise<string> {
  const buf = await loadAppIconBuffer(key);
  return `data:image/png;base64,${buf.toString('base64')}`;
}
