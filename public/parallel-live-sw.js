// Offline support for the Parallel Live app (parallel-live.html). The page registers this
// worker with scope "parallel-live", so it never touches the site's other apps.
// The page itself is fetched fresh whenever you're online (and saved for later); the
// Tailwind script, manifest and icons are served from the saved copy.
const CACHE = 'parallel-live-v1';
const PAGE = new URL('parallel-live.html', self.location).href;
const TAILWIND = 'https://cdn.tailwindcss.com/';
const FILES = [
    'parallel-live.html',
    'parallel-live/manifest.webmanifest',
    'parallel-live/icon-192.png',
    'parallel-live/icon-512.png',
    'parallel-live/icon-maskable-512.png',
    'parallel-live/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await cache.addAll(FILES);
        // The CDN sends no CORS headers, so this is kept as an opaque response,
        // which the page's <script> tag can still run.
        await cache.put(TAILWIND, await fetch(TAILWIND, { mode: 'no-cors' }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // Drop older versions of this app's cache; other apps on the site keep theirs.
        for (const key of await caches.keys()) {
            if (key.startsWith('parallel-live-') && key !== CACHE) await caches.delete(key);
        }
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE).then((cache) => cache.put(PAGE, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(PAGE))
        );
        return;
    }
    event.respondWith(caches.match(request).then((saved) => saved || fetch(request)));
});
