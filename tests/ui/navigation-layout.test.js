import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../assets/js/navigation-layout.js', import.meta.url), 'utf8');
test('navigation stays anchored through keyboard resizing, viewport panning and restoration', () => {
  const values = {}, events = {};
  const viewport = { height: 844, offsetTop: 0, scale: 1, addEventListener: (name, fn) => { events[name] = fn; } };
  vm.runInNewContext(source, { document: { documentElement: { style: { setProperty: (name, value) => { values[name] = value; } } } },
    window: { innerHeight: 844, visualViewport: viewport, addEventListener() {} } });
  assert.equal(values['--navigation-viewport-offset'], '0px');
  viewport.height = 500; events.resize();
  assert.equal(values['--navigation-viewport-offset'], '344px');
  viewport.offsetTop = 40; events.scroll();
  assert.equal(values['--navigation-viewport-offset'], '304px');
  viewport.height = 844; viewport.offsetTop = 0; events.resize();
  assert.equal(values['--navigation-viewport-offset'], '0px');
  viewport.scale = 2; viewport.height = 422; events.resize();
  assert.equal(values['--navigation-viewport-offset'], '0px');
});
