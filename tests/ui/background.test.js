import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../../assets/js/background.js', import.meta.url), 'utf8');
function setup({ reduced = false, saveData = false, available = true } = {}) {
  const events = new Map(), pages = new Map(), frames = new Map();
  const colors = [], created = [];
  let paints = 0, frameID = 0, observer;
  const ctx = { fillRect() { paints++; }, beginPath() {}, lineTo() {}, moveTo() {}, stroke() {},
    createRadialGradient() { return { addColorStop(_, color) { colors.push(color); } }; },
    createLinearGradient() { return { addColorStop(_, color) { colors.push(color); } }; } };
  const classList = () => ({ add() {} });
  const canvas = { getContext: () => available ? ctx : null, setAttribute() {} };
  const surface = { children: [], classList: classList(), appendChild(item) { this.children.push(item); } };
  const root = { dark: true, getAttribute() { return this.dark ? 'dark' : null; } };
  const document = { hidden: false, documentElement: root, body: { classList: classList() },
    querySelector: () => surface, createElement(tag) { created.push(tag); return canvas; },
    addEventListener(name, fn) { events.set(name, fn); } };
  const motion = { matches: reduced, addEventListener(name, fn) { this.change = fn; } };
  const connection = { saveData, addEventListener() {} };
  let accent = '40, 180, 150';
  const window = { innerWidth: 1920, innerHeight: 1080,
    matchMedia: () => motion, addEventListener(name, fn) { pages.set(name, fn); },
    requestAnimationFrame(fn) { frames.set(++frameID, fn); return frameID; },
    cancelAnimationFrame(id) { frames.delete(id); } };
  vm.runInNewContext(source, { window, document, navigator: { connection, hardwareConcurrency: 8 },
    getComputedStyle: () => ({ getPropertyValue: name => name === '--accent-rgb' ? accent : '#0b1115' }),
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} } });
  return { canvas, created, surface, frames, document, root, motion, window, events, pages, colors,
    get paints() { return paints; }, start: () => pages.get('univer-ready')?.(),
    step(timestamp) { const [id, callback] = [...frames][0]; frames.delete(id); callback(timestamp); },
    appearance(rgb) { accent = rgb; observer(); } };
}

test('travelling ribs move over time and remain continuous across successive waves', () => {
  const paths = [];
  // A standalone recorder avoids asserting a particular artistic shape.
  const ctx = { fillRect() {}, beginPath() {}, moveTo(x, y) { paths.push([x, y]); },
    lineTo(x, y) { paths.push([x, y]); }, stroke() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }) };
  const noop = () => {};
  const window = { innerWidth: 390, innerHeight: 844, addEventListener: noop,
    matchMedia: () => ({ matches: true, addEventListener: noop }) };
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,
    'window.renderAt = value => { time = value; draw(); };})();'), {
    window, navigator: {}, document: { hidden: false,
      querySelector: () => ({ appendChild: noop, classList: { add: noop } }),
      createElement: () => ({ getContext: () => ctx, setAttribute: noop }),
      documentElement: { getAttribute: () => 'dark' }, body: { classList: { add: noop } },
      addEventListener: noop }, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    MutationObserver: class { observe() {} }
  });
  const capture = t => { paths.length = 0; window.renderAt(t); return paths.slice(); };
  const start = capture(0), later = capture(3.5);
  assert.ok(start.some((point, i) => Math.abs(point[0] - later[i][0]) > 5));
  const boundary = .94 / .034;
  const before = capture(boundary - .001), after = capture(boundary + .001);
  assert.ok(before.every((point, i) => Math.abs(point[0] - after[i][0]) < .1));
});
test('code background draws without video and caps its pixel budget before animation starts', () => {
  const env = setup();
  assert.deepEqual(env.created, ['canvas']);
  assert.ok(env.canvas.width * env.canvas.height <= 241000);
  assert.ok(env.paints > 0);
  assert.equal(env.frames.size, 0);
  env.start();
  env.step(0);
  const before = env.paints;
  env.step(16);
  assert.equal(env.paints, before);
  env.step(40);
  assert.ok(env.paints > before);
});
test('hidden and suspended pages stop rendering; resume ignores time spent away', () => {
  const env = setup(); env.start(); env.step(0); env.step(40);
  env.document.hidden = true; env.events.get('visibilitychange')();
  assert.equal(env.frames.size, 0);
  const before = env.paints;
  env.document.hidden = false; env.events.get('visibilitychange')();
  env.step(500000);
  assert.equal(env.paints, before);
  env.step(500040); assert.ok(env.paints > before);
  env.pages.get('pagehide')(); assert.equal(env.frames.size, 0);
  env.pages.get('pageshow')(); assert.equal(env.frames.size, 1);
});
test('reduced motion and saveData keep a static rendered background', () => {
  for (const options of [{ reduced: true }, { saveData: true }]) {
    const env = setup(options); env.start();
    assert.equal(env.frames.size, 0); assert.ok(env.paints > 0);
  }
  const env = setup(); env.start();
  env.motion.matches = true; env.motion.change(); assert.equal(env.frames.size, 0);
  env.motion.matches = false; env.motion.change(); assert.equal(env.frames.size, 1);
});
test('theme and accent repaint the same canvas and resize stays within budget', () => {
  const env = setup(); const before = env.paints;
  env.root.dark = false; env.appearance('120, 80, 240');
  assert.ok(env.paints > before);
  assert.ok(env.colors.some(color => color.includes('120, 80, 240')));
  assert.equal(env.surface.children.length, 1);
  env.window.innerWidth = 390; env.window.innerHeight = 844;
  env.pages.get('resize')();
  assert.ok(env.canvas.width * env.canvas.height <= 241000);
});
test('unavailable Canvas leaves the CSS fallback intact', () => {
  const env = setup({ available: false });
  assert.equal(env.surface.children.length, 0);
  assert.equal(env.frames.size, 0);
});
