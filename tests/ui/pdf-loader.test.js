import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
function setup() {
  const scripts = [];
  const window = {};
  const context = vm.createContext({ window, setTimeout, clearTimeout, document: {
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { appendChild(script) { scripts.push(script); } },
  } });
  vm.runInContext(source.slice(source.indexOf('  let pdfJsLoadPromise'), source.indexOf('  function setViewportZoomable')), context);
  return { scripts, window, load: () => context.ensurePdfJsLoaded() };
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
  env.window.pdfjsLib = { GlobalWorkerOptions: {} };
  env.scripts[1].onload();
  await retry;
  await env.load();
  assert.equal(env.scripts.length, 2);
  assert.match(env.window.pdfjsLib.GlobalWorkerOptions.workerSrc, /pdf.worker.min.js$/);
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
