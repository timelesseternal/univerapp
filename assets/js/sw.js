// Public app shell only; student data and video ranges bypass this cache.
if(typeof importScripts==='function') importScripts('/assets/js/push-storage.js');
const CACHE_NAME = 'univer-shell-v121';
const SHELL_INTEGRITY = {};
const FONT_PATHS = new Set([
  '/assets/fonts/manrope/cyrillic-ext.woff2',
  '/assets/fonts/manrope/cyrillic.woff2',
  '/assets/fonts/manrope/latin.woff2',
]);
const SHELL_PATHS = new Set(['/', '/index.html', '/manifest.webmanifest', '/assets/icons/uniq-apple-touch-180.png', '/assets/icons/uniq-192.png', '/assets/icons/uniq-512.png', '/assets/css/app.css', '/assets/css/background.css', '/assets/css/typography.css', '/assets/css/chat.css', '/assets/css/motion.css', '/assets/css/controls.css', '/assets/js/appearance.js', '/assets/js/app.js', '/assets/js/updates.js', '/assets/js/chat.js', '/assets/js/background.js', ...FONT_PATHS]);
SHELL_PATHS.add('/assets/css/wrapped.css');
SHELL_PATHS.add('/assets/js/navigation.js');
SHELL_PATHS.add('/assets/js/actions.js');
SHELL_PATHS.add('/assets/js/device-session.js');
SHELL_PATHS.add('/assets/js/viewport-recovery.js');
SHELL_PATHS.add('/assets/js/wrapped.js');
SHELL_PATHS.add('/assets/css/academic.css');
SHELL_PATHS.add('/assets/js/academic.js');
SHELL_PATHS.add('/assets/js/loading.js');
SHELL_PATHS.add('/assets/js/motion.js');
SHELL_PATHS.add('/assets/js/grade-details.js');
SHELL_PATHS.add('/assets/js/schedule-share.js');
SHELL_PATHS.add('/assets/css/schedule-share.css');
SHELL_PATHS.add('/assets/js/study-history.js');
SHELL_PATHS.add('/assets/js/push.js');
SHELL_PATHS.add('/assets/js/push-storage.js');
SHELL_PATHS.add('/assets/css/study-history.css');
SHELL_PATHS.add('/assets/icons/uniq-maskable-512.png');
SHELL_PATHS.add('/assets/icons/uniq-favicon-32.png');

function fetchShell(request, options) {
  const path = typeof request === 'string' ? request : new URL(request.url).pathname;
  return fetch(request, { ...options, ...(SHELL_INTEGRITY[path] ? { integrity: SHELL_INTEGRITY[path] } : {}) });
}

async function savedResponse(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(request);
    if (response) return response;
  } catch { /* Restricted storage must not block a successful network load. */ }
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
    return await savedResponse(request) || response;
  } catch (error) {
    const cached = await savedResponse(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('message', event => {
  if(event.data?.type==='UNILINK_PUSH_SUPPORT') {event.ports?.[0]?.postMessage({ready:true});return;}
  if(['UNILINK_PUSH_READ','UNILINK_PUSH_LOGOUT'].includes(event.data?.type)) {
    event.waitUntil((async()=>{
      if(event.data.type==='UNILINK_PUSH_LOGOUT')await self.unilinkPushStorage?.set(null);
      const notifications=await self.registration.getNotifications();
      for(const notification of notifications) if(event.data.type==='UNILINK_PUSH_LOGOUT'||notification.data?.conversationID===event.data.conversationID)notification.close();
    })().catch(()=>{}));return;
  }
  if (event.data?.type !== 'REFRESH_SHELL' || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    try {
      // Download first: an offline/failed update must preserve the existing shell.
      const files = await Promise.all([...SHELL_PATHS].map(async path => {
        const response = await fetchShell(path, { cache: 'reload', signal: AbortSignal.timeout(12000) });
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

self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let payload;try{payload=event.data?.json();}catch{return;}
    const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
    if(!payload||!['chat','test'].includes(payload.kind)||!uuid.test(payload.owner)
      ||(payload.kind==='chat'&&!uuid.test(payload.conversationID)))return;
    const owner=await self.unilinkPushStorage?.get();
    if(owner!==payload.owner)return; // Logout/account switches cannot reveal another student's message.
    await self.registration.showNotification(String(payload.title||'uniq.').slice(0,160),{
      body:String(payload.body||'Новое сообщение').slice(0,240),icon:'/assets/icons/uniq-192.png',
      tag:payload.kind==='chat'?`chat-${payload.conversationID}`:'unilink-push-test',
      data:{owner,conversationID:payload.kind==='chat'?payload.conversationID:null},
    });
  })().catch(()=>{}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const data=event.notification.data;
    if(!data?.owner||await self.unilinkPushStorage?.get()!==data.owner)return;
    const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
    const url=new URL(data.conversationID&&uuid.test(data.conversationID)?`/?chat=${data.conversationID}`:'/',self.location.origin).href;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(window=>window.url.startsWith(self.location.origin+'/'));
    if(client){
      await client.focus();
      if(!data.conversationID)return;
      if(data.conversationID && typeof MessageChannel!=='undefined') {
        const accepted=await new Promise(resolve=>{
          const channel=new MessageChannel();let timer;
          const finish=value=>{clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value);};
          channel.port1.onmessage=event=>finish(event.data?.handled===true);
          timer=setTimeout(()=>finish(false),1500);
          try{client.postMessage({type:'UNILINK_OPEN_CHAT',owner:data.owner,conversationID:data.conversationID},[channel.port2]);}catch{finish(false);}
        });
        if(accepted)return; // Keep unsent drafts and the current app instance intact.
      }
      await client.navigate(url);
    }
    else await self.clients.openWindow(url);
  })().catch(()=>{}));
});

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Prime the public shell on the first visit too, before this worker controls a page.
    // Keep the previous worker active if any file is missing or belongs to another release.
    const files = await Promise.all([...SHELL_PATHS].map(async path => {
      const response = await fetchShell(path, {cache:'reload',credentials:'omit',signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw new Error('shell_unavailable');
      return [path, response];
    }));
    await Promise.all(files.map(([path, response]) => rememberResponse(path, response)));
    await self.skipWaiting();
  })());
});
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

  // HTML and assets stay together until a complete new worker is installed.
  // Build-generated integrity values reject files from a different deployment.
  event.respondWith((async () => {
    const cached = await savedResponse(request);
    if (cached) return cached;
    return networkResponse(request, (async () => {
      const response = await fetchShell(request, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(rememberResponse(request, copy));
      }
      return response;
    })());
  })());
});
