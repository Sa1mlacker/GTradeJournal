// G Trade Journal - Service Worker
// This file helps with caching control and offline support

const CACHE_NAME = 'g-trade-journal-v2.1.0';

// Files to cache - use cache busting with version
const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/logo.png'
];

// Install event - cache essential files
self.addEventListener('install', (event) => {
    console.log('[SW] Installing new version:', CACHE_NAME);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching app shell');
                return cache.addAll(urlsToCache);
            })
            .catch((err) => {
                console.log('[SW] Cache install error:', err);
            })
    );
    // Activate immediately - don't wait for old SW to stop
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating new version:', CACHE_NAME);
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME && cacheName.startsWith('g-trade-journal')) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            // Notify all clients that SW has been updated
            return self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME });
                });
            });
        })
    );
    // Claim all clients immediately
    return self.clients.claim();
});

// Fetch event - Network First strategy for app files, Cache First for external resources
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip Supabase API calls - never cache these
    if (event.request.url.includes('supabase.co')) return;

    const url = new URL(event.request.url);

    // For external resources (fonts, CDN) - use Cache First
    if (url.origin !== location.origin) {
        event.respondWith(
            caches.match(event.request).then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetch(event.request).then(response => {
                    // Cache external resources
                    if (response.ok) {
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return response;
                });
            })
        );
        return;
    }

    // For app files - use Network First (always get latest)
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Don't cache if not a valid response
                if (!response || response.status !== 200) {
                    return response;
                }

                // Clone and cache the new version
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });

                return response;
            })
            .catch(() => {
                // Network failed, try to get from cache (offline mode)
                return caches.match(event.request).then((response) => {
                    if (response) {
                        return response;
                    }

                    // If requesting a page and no cache, return index.html
                    if (event.request.mode === 'navigate') {
                        return caches.match('/index.html');
                    }
                });
            })
    );
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
    if (event.data === 'getVersion') {
        event.source.postMessage({ type: 'VERSION', version: CACHE_NAME });
    }
});
