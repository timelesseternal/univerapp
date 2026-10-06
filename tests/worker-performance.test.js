import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../assets/js/sw.js', import.meta.url), 'utf8');
function worker(cached, fetch) {
  const handlers = {}; const writes = [];
  vm.runInNewContext(source, {
    URL, fetch, caches: { open: async () => ({ match: async () => cached, put: async (...args) => writes.push(args) }) },
    self: { location: { origin: 'https://univer.test' }, addEventListener: (name, fn) => { handlers[name] = fn; } },
  });
  return { writes, request(path) {
    const event = { request: { method: 'GET', url: `https://univer.test${path}`, headers: { has: () => false } },
      waitUntil(promise) { this.work = promise; }, respondWith(promise) { this.response = promise; } };
    handlers.fetch(event); return event;
  } };
}
const response = { ok: true, clone() { return this; } };
test('warm code displays while the network is pending and updates its public cache afterwards', async () => {
  let resolve;
  const cached = {};
  const ui = worker(cached, () => new Promise(done => { resolve = done; }));
  const event = ui.request('/assets/js/app.js');
  assert.equal(await event.response, cached);
  assert.equal(ui.writes.length, 0);
  resolve(response); await event.work;
  assert.equal(ui.writes.length, 1);
});
test('cold code waits for the network and private endpoints bypass the worker', async () => {
  let calls = 0;
  const ui = worker(null, async () => { calls++; return response; });
  assert.equal(await ui.request('/assets/css/app.css').response, response);
  const event = ui.request('/api/chat?action=inbox');
  assert.equal(event.response, undefined);
  assert.equal(calls, 1);
});
test('warm code remains available when background refresh fails', async () => {
  const cached = {};
  const ui = worker(cached, async () => { throw new Error('offline'); });
  const event = ui.request('/assets/js/app.js');
  assert.equal(await event.response, cached);
  await event.work;
});
