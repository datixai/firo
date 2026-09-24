/**
 * service-worker.js — PWA offline support
 * Network-first for same-origin pages and assets; falls back to cache when offline.
 * Firebase / CDN / API requests are never intercepted so live data is always fresh.
 */
const CACHE_NAME = 'firo-site-v11';
const ASSETS_TO_CACHE = [
  '/',
  '/dashboard',
  '/map',
  '/incidents',
  '/cameras',
  '/analytics',
  '/login',
  '/logs',
  '/report',
  '/manifest.json',
  '/assets/logo.png',
  '/css/site.css',
  '/css/ops.css',
  '/js/ops/data.js',
  '/js/ops/shell.js',
  '/js/ops/charts.js',
  '/js/ops/map.js',
  '/js/firebase-init.js',
  '/js/common.js',
  '/js/site.js',
  '/js/content.js',
  '/js/jungle-bg.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE).catch(()=>{}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k === CACHE_NAME ? null : caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests; never cache the config API
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => (await caches.match(event.request)) || caches.match('/'))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && !response.redirected) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone).catch(()=>{}));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
