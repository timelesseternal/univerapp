// Public app shell only; student data and video ranges bypass this cache.
const CACHE_NAME = 'univer-shell-v11';
const FONT_PATHS = new Set([
  '/assets/fonts/manrope/cyrillic-ext.woff2',
  '/assets/fonts/manrope/cyrillic.woff2',
  '/assets/fonts/manrope/latin.woff2',
]);
const SHELL_PATHS = new Set(['/', '/index.html', '/assets/css/app.css', '/assets/css/typography.css', '/assets/js/appearance.js', '/assets/js/app.js', '/assets/js/background.js', ...FONT_PATHS]);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(
    names.filter(name => name.startsWith('univer-') && name !== CACHE_NAME)
      .map(name => caches.delete(name))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin
    || !SHELL_PATHS.has(url.pathname) || url.search || request.headers.has('range')) return;

  // Prefer fresh code; keep the public shell available if the network is down.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (FONT_PATHS.has(url.pathname)) {
      const cachedFont = await cache.match(request);
      if (cachedFont) return cachedFont;
    }
    try {
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(cache.put(request, copy));
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      throw error;
    }
  })());
});
