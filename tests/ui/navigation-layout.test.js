import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../assets/js/navigation-layout.js', import.meta.url), 'utf8');
test('navigation stays anchored through keyboard resizing, viewport panning and restoration', () => {
  const values = {}, events = {};
  const viewport = { height: 844, offsetTop: 0, scale: 1, addEventListener: (name, fn) => { events[name] = fn; } };
  const document = { activeElement: { tagName: 'TEXTAREA' }, addEventListener: (name, fn) => { events[name] = fn; }, documentElement: { style: { setProperty: (name, value) => { values[name] = value; } } } };
  vm.runInNewContext(source, { document, setTimeout: () => 1, clearTimeout() {},
    window: { innerHeight: 844, visualViewport: viewport, addEventListener() {} } });
  assert.equal(values['--navigation-viewport-offset'], '0px');
  viewport.height = 500; events.resize();
  assert.equal(values['--navigation-viewport-offset'], '344px');
  viewport.offsetTop = 40; events.scroll();
  assert.equal(values['--navigation-viewport-offset'], '304px');
  document.activeElement = null; events.focusout();
  assert.equal(values['--navigation-viewport-offset'], '0px');
  events.scroll();
  assert.equal(values['--navigation-viewport-offset'], '0px');
  document.activeElement = { tagName: 'TEXTAREA' };
  viewport.height = 844; viewport.offsetTop = 0; events.resize();
  assert.equal(values['--navigation-viewport-offset'], '0px');
  viewport.scale = 2; viewport.height = 422; events.resize();
  assert.equal(values['--navigation-viewport-offset'], '0px');
});

test('stale iPhone viewport gaps without text entry never lift navigation', () => {
  const values = {}, events = {};
  const viewport = { height: 700, offsetTop: 20, scale: 1, addEventListener: (name, fn) => { events[name] = fn; } };
  const document = { activeElement: null, addEventListener: (name, fn) => { events[name] = fn; }, documentElement: { style: { setProperty: (name, value) => { values[name] = value; } } } };
  const timers = [];
  vm.runInNewContext(source, { document, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    window: { innerHeight: 844, visualViewport: viewport, addEventListener: (name, fn) => { events[name] = fn; } } });
  for (const active of [null, { tagName: 'BUTTON' }, { tagName: 'INPUT', type: 'checkbox' }, { tagName: 'INPUT', readOnly: true }]) {
    document.activeElement = active;
    events.resize(); events.scroll(); events.pageshow(); events.visibilitychange();
    timers.splice(0).forEach(fn => fn());
    assert.equal(values['--navigation-viewport-offset'], '0px');
  }
});
