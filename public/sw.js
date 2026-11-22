// ExamDash Pass-Through Service Worker
// Satisfies Chromium WebAPK & Desktop PWA installability criteria at scope '/'
// without hijacking SSR HTML, CDN cache headers, or /api/v1/library/stream Range requests.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Intentional pass-through: let browser native HTTP stack handle all requests directly.
});
