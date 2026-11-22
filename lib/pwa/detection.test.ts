import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpenInAppHref,
  isCrawlerUserAgent,
  resolvePWADeviceRoute,
  stripPwaLaunchParams,
} from './detection';

test('resolvePWADeviceRoute prioritizes standalone and Capacitor native shells first', () => {
  assert.equal(
    resolvePWADeviceRoute({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
      maxTouchPoints: 5,
      isStandaloneDisplay: false,
      isNavigatorStandalone: true,
      isCapacitorNative: false,
    }),
    'standalone'
  );

  assert.equal(
    resolvePWADeviceRoute({
      userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/134.0.0.0 Mobile',
      maxTouchPoints: 5,
      isStandaloneDisplay: true,
      isNavigatorStandalone: false,
      isCapacitorNative: false,
    }),
    'standalone'
  );

  assert.equal(
    resolvePWADeviceRoute({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; wv) Instagram',
      maxTouchPoints: 5,
      isStandaloneDisplay: false,
      isNavigatorStandalone: false,
      isCapacitorNative: true,
    }),
    'standalone'
  );
});

test('resolvePWADeviceRoute detects social in-app WebViews before OS branches', () => {
  for (const ua of [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) Instagram 360.0.0',
    'Mozilla/5.0 (Linux; Android 15) [FBAN/FB4A;FBAV/490.0.0]',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) LinkedInApp/9.30',
    'Mozilla/5.0 (Linux; Android 14) WhatsApp/2.25.1',
  ]) {
    assert.equal(
      resolvePWADeviceRoute({
        userAgent: ua,
        maxTouchPoints: 5,
        isStandaloneDisplay: false,
        isNavigatorStandalone: false,
        isCapacitorNative: false,
      }),
      'in-app-webview'
    );
  }
});

test('resolvePWADeviceRoute routes macOS Chrome/Edge to non-apple while routing macOS Safari and iPadOS accurately', () => {
  // macOS Chrome -> non-apple (gets 1-click native beforeinstallprompt)
  assert.equal(
    resolvePWADeviceRoute({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      maxTouchPoints: 0,
      isStandaloneDisplay: false,
      isNavigatorStandalone: false,
      isCapacitorNative: false,
    }),
    'non-apple'
  );

  // macOS Edge -> non-apple
  assert.equal(
    resolvePWADeviceRoute({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0',
      maxTouchPoints: 0,
      isStandaloneDisplay: false,
      isNavigatorStandalone: false,
      isCapacitorNative: false,
    }),
    'non-apple'
  );

  // macOS Safari -> apple-mac-safari (Add to Dock)
  assert.equal(
    resolvePWADeviceRoute({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      maxTouchPoints: 0,
      isStandaloneDisplay: false,
      isNavigatorStandalone: false,
      isCapacitorNative: false,
    }),
    'apple-mac-safari'
  );

  // iPadOS desktop-class UA (Macintosh + maxTouchPoints > 1) -> apple-ios
  assert.equal(
    resolvePWADeviceRoute({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      maxTouchPoints: 5,
      isStandaloneDisplay: false,
      isNavigatorStandalone: false,
      isCapacitorNative: false,
    }),
    'apple-ios'
  );

  // iPhone Chrome (CriOS) -> apple-ios
  assert.equal(
    resolvePWADeviceRoute({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) CriOS/134.0.0.0 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
      isStandaloneDisplay: false,
      isNavigatorStandalone: false,
      isCapacitorNative: false,
    }),
    'apple-ios'
  );
});

test('stripPwaLaunchParams and buildOpenInAppHref preserve route query state cleanly', () => {
  assert.equal(stripPwaLaunchParams('/', '?source=pwa'), '/');
  assert.equal(stripPwaLaunchParams('/books', '?page=2&from=browser'), '/books?page=2');
  // Must preserve ?source=offline on /read/[slug]
  assert.equal(stripPwaLaunchParams('/read/upsc-book', '?source=offline'), null);

  assert.equal(buildOpenInAppHref('/', ''), '/?from=browser');
  assert.equal(
    buildOpenInAppHref('/exams/ssc-cgl', '?source=pwa'),
    '/exams/ssc-cgl?from=browser'
  );
  assert.equal(
    buildOpenInAppHref('/books', '?page=3'),
    '/books?page=3&from=browser'
  );
});

test('isCrawlerUserAgent suppresses PWA logic for search and AI citation bots', () => {
  assert.equal(
    isCrawlerUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'),
    true
  );
  assert.equal(
    isCrawlerUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/136.0.0.0 Mobile'),
    false
  );
});
