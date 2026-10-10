// Public app shell only; student data and video ranges bypass this cache.
const CACHE_NAME = 'univer-shell-v81';
const FONT_PATHS = new Set([
  '/assets/fonts/manrope/cyrillic-ext.woff2',
  '/assets/fonts/manrope/cyrillic.woff2',
  '/assets/fonts/manrope/latin.woff2',
]);
const SHELL_PATHS = new Set(['/', '/index.html', '/manifest.webmanifest', '/assets/icons/apple-touch-icon.png', '/assets/icons/icon-192.png', '/assets/icons/icon-512.png', '/assets/css/app.css', '/assets/css/background.css', '/assets/css/typography.css', '/assets/css/chat.css', '/assets/css/motion.css', '/assets/css/controls.css', '/assets/js/appearance.js', '/assets/js/app.js', '/assets/js/updates.js', '/assets/js/chat.js', '/assets/js/background.js', ...FONT_PATHS]);
SHELL_PATHS.add('/assets/css/wrapped.css');
SHELL_PATHS.add('/assets/js/wrapped.js');
SHELL_PATHS.add('/assets/css/academic.css');
SHELL_PATHS.add('/assets/js/academic.js');

self.addEventListener('message', event => {
  if (event.data?.type !== 'REFRESH_SHELL' || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    try {
      // Download first: an offline/failed update must preserve the existing shell.
      const files = await Promise.all([...SHELL_PATHS].map(async path => {
        const response = await fetch(path, { cache: 'reload', signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error('shell_unavailable');
        return [path, response];
      }));
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(files.map(([path, response]) => cache.put(path, response)));
      event.ports[0].postMessage({ ok: true });
    } catch { event.ports[0].postMessage({ ok: false }); }
  })());
});

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

  // A navigation checks for new releases; warmed assets display immediately.
  // Cache namespaces change with releases so an old release cannot fill this cache.
  if (!FONT_PATHS.has(url.pathname) && url.pathname !== '/' && url.pathname !== '/index.html') {
    const update = (async () => {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })();
    event.waitUntil(update.catch(() => {}));
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      return cached || await update;
    })());
    return;
  }

  // Prefer fresh HTML; keep the public shell available if the network is down.
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
