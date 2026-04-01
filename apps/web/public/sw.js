const CACHE = 'xo-v2';

// Static assets we know upfront
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/radar.svg',
  '/qr-code.svg',
  '/spartan.svg',
  '/ai-ckt.svg',
  '/crown.svg',
  '/fingerprint.svg',
  '/icons.svg',
  '/world-map.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Always serve index.html for navigation requests (SPA fallback)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Cache-first for same-origin assets (JS, CSS, SVG, images)
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        });
      })
    );
    return;
  }

  // Network-only for external requests (Nakama, fonts, etc)
  e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
});