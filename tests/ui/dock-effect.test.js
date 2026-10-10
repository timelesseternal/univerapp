import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../assets/js/dock-effect.js', import.meta.url), 'utf8');
function setup() {
  const props = new Map(), classes = new Set(), body = new Set(), frames = [];
  let observe, bounds = { top: 600, bottom: 760, left: 30, width: 300, height: 160 };
  const card = { getBoundingClientRect: () => bounds, style: { setProperty: (k,v) => props.set(k,v), removeProperty: k => props.delete(k) }, classList: { add: k => classes.add(k), remove: k => classes.delete(k) } };
  const events = {};
  const context = vm.createContext({ window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} },
    document: { hidden: false, body: { classList: { contains: k => body.has(k) } }, getElementById: () => ({ getBoundingClientRect: () => ({ top: 700, bottom: 780, left: 20, width: 320, height: 80 }) }),
      querySelector: () => ({}), querySelectorAll: () => [card], addEventListener: (k,fn) => { events[k] = fn; } },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    IntersectionObserver: class { constructor(fn) { observe = fn; } observe() {} unobserve() {} },
    MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} },
  });
  vm.runInContext(source, context);
  const flush = () => { frames.splice(0).forEach(fn => fn()); };
  flush(); observe([{ target: card, isIntersecting: true }]); flush();
  return { api: context.window.UniLinkDockEffect, props, classes, body, events, flush, frames, move(value) { bounds = value; events.scroll(); flush(); } };
}
test('dock effect affects only the approaching edge and releases cards above it', () => {
  const ui = setup(); assert.ok(ui.classes.has('dock-dissolve'));
  assert.equal(ui.props.get('--dock-fade-start'), '52.0px');
  assert.ok(Number(ui.props.get('--dock-spread')) <= 1.025);
  ui.move({ top: 400, bottom: 560, left: 30, width: 300, height: 160 });
  assert.equal(ui.classes.size, 0); assert.equal(ui.props.size, 0);
});
test('experiment can be disabled immediately and schedules no idle animation loop', () => {
  const ui = setup(); assert.equal(ui.frames.length, 0);
  ui.api.setEnabled(false); assert.equal(ui.classes.size, 0); assert.equal(ui.props.size, 0);
  ui.flush(); assert.equal(ui.frames.length, 0);
});
test('opening keyboard or hiding a section removes the effect', () => {
  const ui = setup(); ui.body.add('chat-keyboard-open'); ui.events.scroll(); ui.flush();
  assert.equal(ui.props.size, 0);
  ui.body.delete('chat-keyboard-open');
  ui.move({ top: 0, bottom: 0, left: 0, width: 0, height: 0 }); assert.equal(ui.props.size, 0);
});
