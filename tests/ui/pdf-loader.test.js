import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
function setup() {
  const scripts = [];
  const window = {};
  const timers = new Map(); let timerID = 0;
  const context = vm.createContext({ window,
    setTimeout(fn, delay) { timers.set(++timerID, { fn, delay }); return timerID; },
    clearTimeout(id) { timers.delete(id); }, document: {
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { appendChild(script) { scripts.push(script); } },
  } });
  vm.runInContext(source.slice(source.indexOf('  let pdfJsLoadPromise'), source.indexOf('  function setViewportZoomable')), context);
  return { scripts, window, timers, load: () => context.ensurePdfJsLoaded() };
}

test('PDF loader shares concurrent requests and retries after a failed script', async () => {
  const env = setup();
  const first = env.load();
  assert.equal(env.load(), first);
  const rejected = assert.rejects(first, /pdfjs_load_failed/);
  env.scripts[0].onerror();
  await rejected;
  assert.equal(env.scripts[0].removed, true);
  const retry = env.load();
  assert.equal(env.scripts.length, 2);
  env.window.pdfjsLib = { GlobalWorkerOptions: {}, getDocument() {} };
  env.scripts[1].onload();
  await retry;
  await env.load();
  assert.equal(env.scripts.length, 2);
  assert.match(env.window.pdfjsLib.GlobalWorkerOptions.workerSrc, /pdf.worker.min.js$/);
});

test('a partial PDF API cannot bypass validation on the next attempt', async () => {
  for (const partial of [{}, { GlobalWorkerOptions: {} }]) {
    const env = setup();
    const first = env.load(); const rejected = assert.rejects(first, /pdfjs_load_failed/);
    env.window.pdfjsLib = partial; env.scripts[0].onload(); await rejected;
    const retry = env.load(); assert.equal(env.scripts.length, 2);
    env.window.pdfjsLib = { GlobalWorkerOptions: {}, getDocument() {} };
    env.scripts[1].onload(); await retry;
    assert.equal(env.timers.size, 0);
  }
});

test('a hanging PDF script times out, cleans up and shares a fresh retry', async () => {
  const env = setup(); const first = env.load();
  const rejected = assert.rejects(first, /pdfjs_load_failed/);
  const timer = [...env.timers.values()][0]; assert.equal(timer.delay, 12000); timer.fn();
  await rejected;
  assert.equal(env.scripts[0].removed, true);
  assert.equal(env.scripts[0].onload, null); assert.equal(env.scripts[0].onerror, null);
  assert.equal(env.timers.size, 0);
  const retry = env.load(); assert.equal(env.load(), retry); assert.equal(env.scripts.length, 2);
  env.window.pdfjsLib = { GlobalWorkerOptions: {}, getDocument() {} };
  env.scripts[1].onload(); await retry; assert.equal(env.timers.size, 0);
});

test('a script without the PDF API fails cleanly and can be retried', async () => {
  const env = setup();
  const result = env.load();
  const rejected = assert.rejects(result, /pdfjs_load_failed/);
  env.scripts[0].onload();
  await rejected;
  const retry = env.load();
  const secondRejected = assert.rejects(retry, /pdfjs_load_failed/);
  env.scripts[1].onerror();
  await secondRejected;
});
