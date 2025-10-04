const CACHE_NAME = 'tbank-cache-v1';
const ASSETS = [
    '/', '/index.html', '/manifest.json'
];

// install - cache only assets that exist (fail-safe)
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return Promise.all(ASSETS.map(url =>
                fetch(url).then(r => {
                    if (r.ok) return cache.put(url, r.clone());
                }).catch(() => { })
            ));
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', event => {
    const req = event.request;
    // network first for API calls, cache-first for others
    if (req.url.includes('/api/')) {
        event.respondWith(fetch(req).catch(() => caches.match(req)));
        return;
    }
    event.respondWith(caches.match(req).then(r => r || fetch(req)));
});
