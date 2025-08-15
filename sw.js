/* PWA Service Worker – runtime cache per immagini/video e workout.json */
const STATIC_CACHE = 'timer-static-v2';
const RUNTIME_CACHE = 'timer-runtime-v2';
const MAX_RUNTIME_ENTRIES = 80;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './sw.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './workout.json' // utile per offline al primo avvio
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => ![STATIC_CACHE, RUNTIME_CACHE].includes(k)).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// helper: limita numero di entry nel runtime cache
async function trimRuntimeCache(maxEntries = MAX_RUNTIME_ENTRIES) {
  const cache = await caches.open(RUNTIME_CACHE);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  // cancella le più vecchie
  const toDelete = keys.length - maxEntries;
  for (let i = 0; i < toDelete; i++) {
    await cache.delete(keys[i]);
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const net = await fetch(req);
  const cache = await caches.open(RUNTIME_CACHE);
  try { cache.put(req, net.clone()); trimRuntimeCache(); } catch (e) {}
  return net;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then(resp => {
    try { cache.put(req, resp.clone()); trimRuntimeCache(); } catch (e) {}
    return resp;
  }).catch(() => null);
  return cached || networkPromise || fetch(req);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // immagini/video (anche cross-origin) → cache-first
  const isMedia = request.destination === 'image' || request.destination === 'video' ||
                  url.pathname.includes('/media/') ||
                  /\.(?:png|jpg|jpeg|webp|gif|svg|mp4|mov)$/i.test(url.pathname);

  // dati (workout.json) → stale-while-revalidate
  const isWorkoutData = isSameOrigin && url.pathname.endsWith('/workout.json');

  // navigazioni HTML → network-first con fallback a cache
  const isDocument = request.mode === 'navigate' || request.destination === 'document';

  if (isWorkoutData) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (isMedia) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isSameOrigin) {
    // core asset statici → cache-first (già precache)
    event.respondWith(
      caches.match(request).then(c => c || fetch(request))
    );
    return;
  }

  // tutto il resto (API/CDN) → tenta rete, fallback a cache se esiste
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// permetti alla pagina di forzare lo skipWaiting
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
