const CACHE = 'nanoclaw-todo-v2';
// Vite's build hashes asset filenames (app.[hash].js, etc.), so we can't
// list them ahead of time the way the old hand-written shell did. Precache
// just the always-stable URLs, then cache everything else at runtime as
// it's fetched (cache-first, falling back to network, populating the cache
// on the way through) — the hashed bundle URLs referenced by index.html get
// caught the first time the shell loads them.
const SHELL = ['/', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Network-first for API calls (always want fresh data), cache-first
// (populating as we go) for everything else — the app shell and its
// hashed build assets.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() => new Response('{"error":"offline"}', { status: 503 })));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        }),
    ),
  );
});
