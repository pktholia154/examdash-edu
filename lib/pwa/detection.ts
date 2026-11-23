export type PWADeviceRoute =
  | 'standalone'
  | 'in-app-webview'
  | 'apple-ios'
  | 'apple-mac-safari'
  | 'non-apple';

export interface PWADetectionInput {
  userAgent: string;
  maxTouchPoints: number;
  isStandaloneDisplay: boolean;
  isNavigatorStandalone: boolean;
  isCapacitorNative: boolean;
}

const BOT_UA_PATTERN =
  /Googlebot|Bingbot|Applebot|DuckDuckBot|Baiduspider|YandexBot|OAI-SearchBot|ChatGPT-User|Claude-SearchBot|PerplexityBot|Google-Extended|GPTBot|ClaudeBot|CCBot|Bytespider/i;

const IN_APP_WEBVIEW_UA_PATTERN =
  /FBAN|FBAV|Instagram|Line\/|LinkedInApp|Snapchat|MicroMessenger|WhatsApp/i;

export function isCrawlerUserAgent(ua: string): boolean {
  return BOT_UA_PATTERN.test(ua || '');
}

export function isAndroidUserAgent(ua: string): boolean {
  return /Android/i.test(ua || '');
}

/**
 * Routes user context by display mode and browser capability first, then OS:
 * - Standalone / Capacitor Native -> 'standalone' (hide all install/open UI)
 * - Social In-App WebViews -> 'in-app-webview' (prompt to open in Chrome / Safari)
 * - Apple iOS / iPadOS (all browsers on iOS/iPadOS use WebKit) -> 'apple-ios'
 * - Apple macOS Safari (desktop Safari only; macOS Chrome/Edge fall through to 'non-apple') -> 'apple-mac-safari'
 * - Non-Apple & macOS Chromium -> 'non-apple' (1-click native install + getInstalledRelatedApps)
 */
export function resolvePWADeviceRoute(input: PWADetectionInput): PWADeviceRoute {
  const ua = input.userAgent || '';

  if (
    input.isCapacitorNative ||
    input.isStandaloneDisplay ||
    input.isNavigatorStandalone
  ) {
    return 'standalone';
  }

  if (IN_APP_WEBVIEW_UA_PATTERN.test(ua)) {
    return 'in-app-webview';
  }

  const isIOS =
    /iPhone|iPod|iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) && input.maxTouchPoints > 1);
  if (isIOS) {
    return 'apple-ios';
  }

  const isMacSafari =
    /Macintosh/i.test(ua) &&
    /Safari/i.test(ua) &&
    !/Chrome|Chromium|CriOS|Edg|OPR|Brave|Vivaldi|Firefox|FxiOS/i.test(ua) &&
    input.maxTouchPoints <= 1;
  if (isMacSafari) {
    return 'apple-mac-safari';
  }

  return 'non-apple';
}

/**
 * Strips ephemeral PWA launch/handoff parameters (`source=pwa`, `from=browser`)
 * while preserving meaningful route parameters (such as `page=2` or `source=offline` on `/read/*`).
 */
export function stripPwaLaunchParams(
  pathname: string,
  rawSearch: string
): string | null {
  if (!rawSearch || rawSearch === '?') return null;
  const params = new URLSearchParams(
    rawSearch.startsWith('?') ? rawSearch.slice(1) : rawSearch
  );
  let mutated = false;

  if (params.get('source') === 'pwa') {
    params.delete('source');
    mutated = true;
  }
  if (params.get('from') === 'browser') {
    params.delete('from');
    mutated = true;
  }

  if (!mutated) return null;
  const nextQuery = params.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

/**
 * Builds an in-scope relative URL with `?from=browser` so Android WebAPK and
 * Desktop Chromium PWA Navigation Capturing (`handle_links: "preferred"`)
 * focus or launch the installed standalone app on the exact current route.
 */
export function buildOpenInAppHref(
  pathname: string,
  rawSearch: string = ''
): string {
  const safePath = pathname && pathname.startsWith('/') ? pathname : '/';
  const params = new URLSearchParams(
    rawSearch.startsWith('?') ? rawSearch.slice(1) : rawSearch
  );
  if (params.get('source') === 'pwa') {
    params.delete('source');
  }
  params.set('from', 'browser');
  const qs = params.toString();
  return qs ? `${safePath}?${qs}` : `${safePath}?from=browser`;
}

/**
 * Restricts post-install "Open in App" prompts strictly to the Home page (`/`)
 * and Product Detail pages (`/books/[slug]`, `/exams/[slug]`).
 */
export function isOpenInAppAllowedRoute(pathname: string): boolean {
  if (!pathname) return false;
  const normalized =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;
  if (normalized === '/') return true;
  if (normalized.startsWith('/books/')) {
    return normalized.slice('/books/'.length).length > 0;
  }
  if (normalized.startsWith('/exams/')) {
    return normalized.slice('/exams/'.length).length > 0;
  }
  return false;
}

