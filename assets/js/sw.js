// Public app shell only; student data and video ranges bypass this cache.
const CACHE_NAME = 'univer-shell-v121';
const FONT_PATHS = new Set([
  '/assets/fonts/manrope/cyrillic-ext.woff2',
  '/assets/fonts/manrope/cyrillic.woff2',
  '/assets/fonts/manrope/latin.woff2',
]);
const SHELL_PATHS = new Set(['/', '/index.html', '/manifest.webmanifest', '/assets/icons/unilink-dark-apple-touch.png', '/assets/icons/unilink-dark-192.png', '/assets/icons/unilink-dark-512.png', '/assets/css/app.css', '/assets/css/background.css', '/assets/css/typography.css', '/assets/css/chat.css', '/assets/css/motion.css', '/assets/css/controls.css', '/assets/js/appearance.js', '/assets/js/app.js', '/assets/js/updates.js', '/assets/js/chat.js', '/assets/js/background.js', ...FONT_PATHS]);
SHELL_PATHS.add('/assets/css/wrapped.css');
SHELL_PATHS.add('/assets/js/navigation.js');
SHELL_PATHS.add('/assets/js/actions.js');
SHELL_PATHS.add('/assets/js/device-session.js');
SHELL_PATHS.add('/assets/js/viewport-recovery.js');
SHELL_PATHS.add('/assets/js/wrapped.js');
SHELL_PATHS.add('/assets/css/academic.css');
SHELL_PATHS.add('/assets/js/academic.js');
SHELL_PATHS.add('/assets/js/loading.js');
SHELL_PATHS.add('/assets/js/grade-details.js');
SHELL_PATHS.add('/assets/icons/unilink-dark-maskable-512.png');
SHELL_PATHS.add('/assets/icons/unilink-dark-favicon-32.png');

async function savedResponse(request, includePrevious = false) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(request);
    if (response) return response;
  } catch { /* Restricted storage must not block a successful network load. */ }
  if (!includePrevious) return;
  try {
    const names = (await caches.keys()).filter(name => name.startsWith('univer-shell-') && name !== CACHE_NAME).reverse();
    for (const name of names) {
      const response = await (await caches.open(name)).match(request);
      if (response) return response;
    }
  } catch { /* Offline recovery is optional when CacheStorage is unavailable. */ }
}

async function rememberResponse(request, response) {
  try { await (await caches.open(CACHE_NAME)).put(request, response); }
  catch { /* Quota or storage errors must not turn HTTP 200 into a failed load. */ }
}

async function pruneShellCaches(keepPrevious) {
  try {
    const names = (await caches.keys()).filter(name => name.startsWith('univer-shell-') && name !== CACHE_NAME);
    const remove = names.slice(0, Math.max(0, names.length - keepPrevious));
    await Promise.all(remove.map(name => caches.delete(name)));
  } catch { /* Activation can continue even when the cache is restricted. */ }
}

async function networkResponse(request, work) {
  try {
    const response = await work;
    if (response.ok) return response;
    return await savedResponse(request, true) || response;
  } catch (error) {
    const cached = await savedResponse(request, true);
    if (cached) return cached;
    throw error;
  }
}

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
      await pruneShellCaches(1);
      event.ports[0].postMessage({ ok: true });
    } catch { event.ports[0].postMessage({ ok: false }); }
  })());
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  // Keep working fallbacks until the new shell has actually downloaded.
  // Only public shell caches belong to this worker.
  event.waitUntil(pruneShellCaches(2).then(() => self.clients.claim()));
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
      const response = await fetch(request, { signal: AbortSignal.timeout(10000) });
      if (response.ok) await rememberResponse(request, response.clone());
      return response;
    })();
    event.waitUntil(update.catch(() => {}));
    event.respondWith((async () => {
      const cached = await savedResponse(request);
      return cached || await networkResponse(request, update);
    })());
    return;
  }

  // Prefer fresh HTML; keep the public shell available if the network is down.
  event.respondWith((async () => {
    if (FONT_PATHS.has(url.pathname)) {
      const cachedFont = await savedResponse(request);
      if (cachedFont) return cachedFont;
    }
    return networkResponse(request, (async () => {
      const response = await fetch(request, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(rememberResponse(request, copy));
      }
      return response;
    })());
  })());
});
