import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
test('modal locking preserves content scroll without repositioning the screen or navigation', () => {
  const classes = new Set(), calls = [];
  const scroller = { scrollTop: 420, classList: { add: c => classes.add(c), remove: c => classes.delete(c) }, scrollTo: options => calls.push(options) };
  const context = vm.createContext({ document: { querySelector: () => scroller,
    body: { style: new Proxy({}, { set() { throw new Error('body must stay stationary'); } }) } } });
  vm.runInContext(source.slice(source.indexOf('  let bodyScrollLockY'), source.indexOf('  function openCityModal')), context);
  context.lockBodyScroll();
  assert.equal(classes.has('app-scroll-locked'), true);
  context.unlockBodyScroll();
  assert.equal(classes.size, 0);
  assert.equal(scroller.scrollTop, 420);
  context.scrollAppTo({ top: 0, behavior: 'smooth' });
  assert.equal(calls[0].top, 0);
});
