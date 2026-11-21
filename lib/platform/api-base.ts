/**
 * Dual-Target Backend Endpoint Resolver
 * Returns "" on Web SSR/MPA and "https://exam-dash.com" (or configured origin) inside Capacitor static shells.
 */
export const API_BASE: string = (process.env.NEXT_PUBLIC_API_BASE ?? '')
  .trim()
  .replace(/\/+$/, '');

export function apiUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return API_BASE || '/';
  if (
    pathOrUrl.startsWith('http://') ||
    pathOrUrl.startsWith('https://') ||
    pathOrUrl.startsWith('blob:') ||
    pathOrUrl.startsWith('data:')
  ) {
    return pathOrUrl;
  }
  const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return API_BASE ? `${API_BASE}${normalizedPath}` : normalizedPath;
}
