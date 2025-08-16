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
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req, { ignoreVary: true });
  if (cached) return cached;

  const res = await fetch(req);

  // Metti in cache solo 200 OK, richieste GET, risposte "basic" (stessa origine)
  if (
    req.method === 'GET' &&
    res &&
    res.ok &&
    res.status === 200 &&
    res.type === 'basic'
  ) {
    try {
      await cache.put(req, res.clone());
    } catch (e) {
      // ignora errori di put (per sicurezza)
      console.warn('Cache put skipped:', e);
    }
  }
  return res;
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

  // bypassa richieste video/audio o con header Range (non cacheabili)
  const isVideoOrAudio = /\.(?:mp4|mov|webm|mp3|ogg|wav)$/i.test(url.pathname);
  const isRange = request.headers.has('range');

  // dati (workout.json) → stale-while-revalidate
  const isWorkoutData = isSameOrigin && url.pathname.endsWith('/workout.json');

  // navigazioni HTML → network-first con fallback a cache
  const isDocument = request.mode === 'navigate' || request.destination === 'document';

  if (isWorkoutData) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (isVideoOrAudio || isRange) {
    // niente cache per i media stream parziali
    event.respondWith(fetch(request));
    return;
  }

  if (request.destination === 'image' || url.pathname.includes('/media/')) {
    // immagini → cache-first
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
