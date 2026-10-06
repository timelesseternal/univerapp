import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/background.js', import.meta.url), 'utf8');
function setup({ reducedMotion = false, saveData = false } = {}) {
  const callbacks = new Map(), pageCallbacks = new Map(), timers = new Map();
  let timerID = 0;
  function element() {
    const listeners = new Map(), attributes = new Map(), classes = new Set();
    return {
      style: {}, children: [], paused: true, ended: false, duration: 10, currentTime: 0,
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      appendChild(child) { this.children.push(child); },
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute(name) { return name === 'src' ? this.src || null : attributes.get(name); },
      addEventListener: (name, fn) => listeners.set(name, fn),
      emit: name => listeners.get(name)?.(),
      play() { this.paused = false; this.ended = false; return Promise.resolve(); },
      pause() { this.paused = true; },
    };
  }
  const surface = element();
  const document = {
    hidden: false, baseURI: 'https://example.com/',
    currentScript: { src: 'https://example.com/assets/js/background.js' },
    body: element(), querySelector: () => surface, createElement: element,
    addEventListener: (name, fn) => callbacks.set(name, fn),
  };
  const window = {
    matchMedia: () => ({ matches: reducedMotion, addEventListener() {} }),
    addEventListener: (name, fn) => pageCallbacks.set(name, fn), requestIdleCallback: fn => fn(),
  };
  vm.runInNewContext(source, {
    document, window, navigator: { connection: { saveData, addEventListener() {} } }, URL,
    setTimeout: fn => { timers.set(++timerID, fn); return timerID; },
    clearTimeout: id => timers.delete(id),
  });
  return {
    document, surface, videos: surface.children[0].children,
    start: () => pageCallbacks.get('univer-ready')(),
    visibility: () => callbacks.get('visibilitychange')(),
    finish() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
  };
}

test('background waits for startup and keeps the standby video paused', async () => {
  const env = setup();
  assert.ok(env.videos.every(video => !video.src && video.paused && video.loop === false));
  env.start();
  await Promise.resolve();
  assert.equal(env.videos[0].paused, false);
  assert.equal(env.videos[1].paused, true);
  assert.equal(env.videos[0].src, env.videos[1].src);
});

test('loop seam crossfades without darkening, then recycles the outgoing video', async () => {
  const env = setup();
  env.start();
  await Promise.resolve();
  const [first, second] = env.videos;
  first.emit('playing');
  first.currentTime = 9;
  first.emit('timeupdate');
  await Promise.resolve();
  assert.equal(second.paused, false);
  assert.equal(second.style.opacity, '0');
  second.emit('playing');
  assert.equal(first.style.opacity, '1');
  assert.equal(second.style.opacity, '1');
  assert.equal(second.style.transition, 'opacity 1.2s linear');
  env.finish();
  assert.equal(first.paused, true);
  assert.equal(first.currentTime, 0);
  assert.equal(first.style.opacity, '0');
  assert.equal(second.style.opacity, '1');
  second.currentTime = 9;
  second.emit('timeupdate');
  await Promise.resolve();
  first.emit('playing');
  env.finish();
  assert.equal(second.paused, true);
  assert.equal(first.style.opacity, '1');
});

test('late preparation holds the last frame until the next cycle actually plays', async () => {
  const env = setup();
  env.start();
  await Promise.resolve();
  const [first, second] = env.videos;
  first.ended = true;
  first.paused = true;
  first.currentTime = 10;
  first.emit('ended');
  assert.equal(first.currentTime, 10);
  assert.equal(first.style.opacity, '1');
  assert.equal(second.style.opacity, '0');
  second.emit('playing');
  env.finish();
  assert.equal(second.style.opacity, '1');
});

test('hiding during a crossfade pauses both decoders and resumes the new cycle', async () => {
  const env = setup();
  env.start();
  await Promise.resolve();
  env.videos[0].currentTime = 9;
  env.videos[0].emit('timeupdate');
  await Promise.resolve();
  env.videos[1].emit('playing');
  env.document.hidden = true;
  env.visibility();
  assert.ok(env.videos.every(video => video.paused));
  env.document.hidden = false;
  env.visibility();
  await new Promise(setImmediate);
  assert.equal(env.videos[1].paused, false);
  assert.equal(env.videos[0].paused, true);
});

test('reduced motion and data saving do not load either video', () => {
  for (const options of [{ reducedMotion: true }, { saveData: true }]) {
    const env = setup(options);
    env.start();
    assert.ok(env.videos.every(video => !video.src && video.paused));
  }
});
