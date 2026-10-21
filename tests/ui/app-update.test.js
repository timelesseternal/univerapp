import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { installLoading } from '../helpers/loading.js';
const source = readFileSync(new URL('../../assets/js/updates.js', import.meta.url), 'utf8');
const workerSource = readFileSync(new URL('../../assets/js/sw.js', import.meta.url), 'utf8');

function setup({ update = async () => {}, ok = true, online = true, version = 'development', versionFetch, hidden = false, htmlVersion = 'development' } = {}) {
  let reloads = 0, refreshes = 0;
  let now = 100000;
  const versionCalls = [], documentEvents = {}, windowEvents = {}, intervals = [];
  const status = { textContent: '' }, attributes = new Map();
  const notice = { hidden: true };
  const badge = { hidden: true }, profileAttributes = new Map();
  const profileTab = { setAttribute: (key, value) => profileAttributes.set(key, value) };
  const button = { disabled: false, textContent: 'Обновить приложение',
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) };
  const registration = { update, active: { postMessage(data, ports) {
    refreshes++;assert.equal(data.type, 'REFRESH_SHELL');ports[0].receive({ data: { ok } });
  } } };
  const window = { location: { reload() { reloads++; } }, addEventListener(name, handler) { windowEvents[name] = handler; } };
  installLoading({ window });
  const privateData = new Map([['platonus_session', 'session'], ['univer-chat-preview-23', 'messages']]);
  const document = { hidden, querySelector: () => ({ content: htmlVersion }),
    getElementById: id => ({ appUpdateStatus: status, appUpdateAvailable: notice, appUpdateButton: button,
      profileUpdateBadge: badge, 'section-profile': profileTab })[id],
    addEventListener(name, handler) { documentEvents[name] = handler; } };
  const navigator = { onLine: online, serviceWorker: { getRegistration: async () => registration } };
  vm.runInNewContext(source, { window, navigator, document, setTimeout, clearTimeout, AbortSignal, Date: { now: () => now },
    setInterval: callback => intervals.push(callback),
    fetch: async (url, options) => { versionCalls.push({url,options}); return versionFetch ? versionFetch() : {ok:true,json:async()=>({version})}; },
    localStorage: { clear() { throw new Error('must_preserve_account'); }, getItem: key => privateData.get(key) },
    MessageChannel: class { constructor() { this.port1 = { close() {} }; this.port2 = { receive: event => this.port1.onmessage(event) }; } } });
  return { window, button, status, notice, badge, profileAttributes, document, navigator, versionCalls, documentEvents, windowEvents, intervals, attributes, privateData,
    advance(ms) { now += ms; }, get reloads() { return reloads; }, get refreshes() { return refreshes; } };
}

test('a changed release shows the profile notice without reloading or downloading the shell', async () => {
  const ui=setup({version:'release-2'});await ui.window.unilinkUpdates.check();
  assert.equal(ui.notice.hidden,false);assert.equal(ui.button.textContent,'Обновить до новой версии');
  assert.equal(ui.badge.hidden,false);assert.match(ui.profileAttributes.get('aria-label'),/доступна новая версия/);
  assert.equal(ui.reloads,0);assert.equal(ui.refreshes,0);
  assert.equal(ui.versionCalls[0].url,'/version.json');assert.equal(ui.versionCalls[0].options.cache,'no-store');
  assert.equal(ui.versionCalls[0].options.credentials,'omit');
  ui.notice.hidden=true;ui.window.unilinkUpdates.render();assert.equal(ui.notice.hidden,false);
});

test('release checks share pending work and are throttled across navigation and focus events', async () => {
  let release;const ui=setup({versionFetch:()=>new Promise(resolve=>{release=resolve;})});
  const first=ui.window.unilinkUpdates.check();assert.equal(ui.window.unilinkUpdates.check(),first);
  assert.equal(ui.versionCalls.length,1);release({ok:true,json:async()=>({version:'development'})});await first;
  ui.windowEvents.focus();ui.documentEvents.visibilitychange();ui.intervals[0]();
  assert.equal(ui.versionCalls.length,1);assert.equal(ui.notice.hidden,true);assert.equal(ui.badge.hidden,true);
  assert.equal(ui.profileAttributes.get('aria-label'),'Профиль');
  ui.advance(60000);const next=ui.window.unilinkUpdates.check();assert.equal(ui.versionCalls.length,2);
  release({ok:true,json:async()=>({version:'development'})});await next;
});

test('hidden and offline apps skip background checks, then check when the connection returns', async () => {
  const ui=setup({online:false});await ui.window.unilinkUpdates.check();assert.equal(ui.versionCalls.length,0);
  ui.navigator.onLine=true;await ui.windowEvents.online();assert.equal(ui.versionCalls.length,1);
  ui.advance(60000);ui.document.hidden=true;await ui.window.unilinkUpdates.check();assert.equal(ui.versionCalls.length,1);
  ui.document.hidden=false;await ui.documentEvents.visibilitychange();await ui.window.unilinkUpdates.check();assert.equal(ui.versionCalls.length,2);
});

test('failed or malformed checks are silent and do not erase a known available update', async () => {
  let reply={ok:true,json:async()=>({version:'release-2'})};
  const ui=setup({versionFetch:async()=>{if(reply instanceof Error)throw reply;return reply;}});
  await ui.window.unilinkUpdates.check();assert.equal(ui.notice.hidden,false);
  for(const data of [new Error('offline'),{ok:false},{ok:true,json:async()=>({version:{bad:true}})}]) {
    reply=data;await ui.window.unilinkUpdates.check(true);assert.equal(ui.notice.hidden,false);assert.equal(ui.status.textContent,'');
  }
});

test('mixed cached runtime and fresh HTML are offered an update even when the server matches the runtime',async()=>{
  const ui=setup({htmlVersion:'different-release'});await ui.window.unilinkUpdates.check();assert.equal(ui.notice.hidden,false);
});

test('an app update refreshes the shell once, then reloads without removing login or chat data', async () => {
  let release;
  const ui = setup({ update: () => new Promise(resolve => { release = resolve; }) });
  const updating = ui.window.updateApplication(ui.button);
  await Promise.resolve();await Promise.resolve();
  assert.equal(ui.button.disabled, true);assert.equal(ui.reloads, 0);
  assert.match(ui.button.innerHTML, /content-loading-arrow/);
  await ui.window.updateApplication(ui.button);
  release();await updating;
  assert.equal(ui.refreshes, 1);assert.equal(ui.reloads, 1);
  assert.equal(ui.privateData.get('platonus_session'), 'session');
  assert.equal(ui.privateData.get('univer-chat-preview-23'), 'messages');
});

test('offline or incomplete updates keep the current screen and let the user retry', async () => {
  for (const options of [{ online: false }, { ok: false }, { update: async () => { throw new Error('network'); } }]) {
    const ui = setup(options);await ui.window.updateApplication(ui.button);
    assert.equal(ui.reloads, 0);assert.equal(ui.button.disabled, false);
    assert.match(ui.status.textContent, /Проверьте интернет/);assert.equal(ui.attributes.has('aria-busy'), false);
  }
});

test('the worker updates only public files and preserves the old shell on download failure', async () => {
  for (const failure of [false, true]) {
    const handlers = {}, downloads = [], writes = [], replies = [];
    vm.runInNewContext(workerSource, { AbortSignal, self: { addEventListener: (name, fn) => { handlers[name] = fn; } },
      caches: { open: async () => ({ put: async (...args) => writes.push(args) }) },
      fetch: async (path, options) => { downloads.push(path);assert.equal(options.cache, 'reload');return { ok: !(failure && path === '/assets/js/app.js') }; } });
    let work;
    handlers.message({ data: { type: 'REFRESH_SHELL' }, ports: [{ postMessage: data => replies.push(data.ok) }], waitUntil: promise => { work = promise; } });
    await work;
    assert.equal(downloads.some(path => path.startsWith('/api/')), false);
    assert.ok(downloads.includes('/assets/js/updates.js'));
    assert.deepEqual(replies, [!failure]);
    assert.equal(writes.length, failure ? 0 : downloads.length);
  }
});
