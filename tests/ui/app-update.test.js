import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../assets/js/updates.js', import.meta.url), 'utf8');
const workerSource = readFileSync(new URL('../../assets/js/sw.js', import.meta.url), 'utf8');

function setup({ update = async () => {}, ok = true, online = true } = {}) {
  let reloads = 0, refreshes = 0;
  const status = { textContent: '' }, attributes = new Map();
  const button = { disabled: false, textContent: 'Обновить приложение',
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) };
  const registration = { update, active: { postMessage(data, ports) {
    refreshes++;assert.equal(data.type, 'REFRESH_SHELL');ports[0].receive({ data: { ok } });
  } } };
  const window = { location: { reload() { reloads++; } } };
  const privateData = new Map([['platonus_session', 'session'], ['univer-chat-preview-23', 'messages']]);
  vm.runInNewContext(source, { window, navigator: { onLine: online, serviceWorker: { getRegistration: async () => registration } },
    document: { getElementById: () => status }, setTimeout, clearTimeout,
    localStorage: { clear() { throw new Error('must_preserve_account'); }, getItem: key => privateData.get(key) },
    MessageChannel: class { constructor() { this.port1 = { close() {} }; this.port2 = { receive: event => this.port1.onmessage(event) }; } } });
  return { window, button, status, attributes, privateData, get reloads() { return reloads; }, get refreshes() { return refreshes; } };
}

test('an app update refreshes the shell once, then reloads without removing login or chat data', async () => {
  let release;
  const ui = setup({ update: () => new Promise(resolve => { release = resolve; }) });
  const updating = ui.window.updateApplication(ui.button);
  await Promise.resolve();await Promise.resolve();
  assert.equal(ui.button.disabled, true);assert.equal(ui.reloads, 0);
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
