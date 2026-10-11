import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../assets/js/viewport.js', import.meta.url), 'utf8');
function setup({standalone = true, visual = true} = {}) {
  const values = new Map(), events = new Map(), frames = [], timers = new Map();
  let timerID = 0;
  const listen = owner => (name, fn) => events.set(`${owner}:${name}`, fn);
  const viewport = {height: 760, scale: 1, offsetTop: 0, addEventListener: listen('viewport')};
  const document = {activeElement: null, hidden: false, addEventListener: listen('document'),
    documentElement: {classList: {contains: () => standalone}, style: {setProperty: (key, value) => values.set(key, value)}}};
  const window = {innerHeight: 844, visualViewport: visual ? viewport : undefined, addEventListener: listen('window'),
    requestAnimationFrame: fn => {frames.push(fn); return frames.length;},
    setTimeout: fn => {timers.set(++timerID, fn); return timerID;}, clearTimeout: id => timers.delete(id)};
  vm.runInNewContext(source, {document, window});
  const emit = key => {events.get(key)?.(); while (frames.length) frames.shift()();};
  const settle = () => {for (const fn of timers.values()) fn(); timers.clear(); while (frames.length) frames.shift()();};
  return {values, viewport, document, window, emit, settle, height: () => values.get('--app-viewport-height')};
}

test('installed shell uses the visible height even when layout viewport is larger', () => {
  const app = setup();
  assert.equal(app.height(), '760px');
  app.viewport.offsetTop = 90;
  app.emit('window:pageshow');
  assert.equal(app.height(), '760px');
  app.window.innerHeight = 740;
  app.emit('window:resize');
  assert.equal(app.height(), '740px');
});

test('keyboard leaves shell stationary and restoration resumes screen measurements', () => {
  const app = setup();
  app.document.activeElement = {matches: () => true};
  app.viewport.height = 430;
  app.emit('viewport:resize');
  assert.equal(app.height(), '760px');
  app.document.activeElement = null;
  app.emit('document:focusout');
  app.emit('viewport:resize');
  assert.equal(app.height(), '760px');
  app.viewport.height = 760;
  app.settle();
  assert.equal(app.height(), '760px');
  app.viewport.height = 390;
  app.window.innerHeight = 390;
  app.emit('viewport:resize');
  assert.equal(app.height(), '390px');
});

test('pinch zoom cannot resize shell; returning to normal scale restores measurements', () => {
  const app = setup();
  app.viewport.scale = 2;
  app.viewport.height = 380;
  app.emit('viewport:resize');
  assert.equal(app.height(), '760px');
  app.viewport.scale = 1;
  app.viewport.height = 780;
  app.emit('viewport:resize');
  assert.equal(app.height(), '780px');
});

test('browser and Telegram layouts retain CSS sizing; older installed browsers use innerHeight', () => {
  assert.equal(setup({standalone: false}).values.size, 0);
  assert.equal(setup({visual: false}).height(), '844px');
});
