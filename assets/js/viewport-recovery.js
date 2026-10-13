/* iOS may leave the document panned after dismissing its software keyboard. */
(() => {
  'use strict';
  if (!document.documentElement.classList.contains('ios-native-viewport')) return;
  const viewport = window.visualViewport;
  let restingHeight = window.innerHeight || viewport?.height || 0;
  let restingWidth = window.innerWidth;
  let keyboardObserved = false, pending = false, frame = 0;
  const timers = [];
  const editing = () => !!document.activeElement?.matches?.('input, textarea, [contenteditable="true"]');
  function restore() {
    frame = 0;
    if (document.hidden || Math.abs((viewport?.scale || 1) - 1) > 0.01) return;
    const focused = editing();
    if (window.innerWidth !== restingWidth) {
      restingWidth = window.innerWidth;
      restingHeight = window.innerHeight || viewport?.height || 0;
    }
    const height = viewport?.height || window.innerHeight;
    if (restingHeight - height > 120 && (focused || keyboardObserved || pending)) {
      keyboardObserved = true;
      return; // Never fight the keyboard's positioning while it is still visible.
    }
    if (focused && !keyboardObserved) return;
    const scroller = document.scrollingElement;
    const shifted = Math.abs(window.scrollY || 0) > 1 || Math.abs(viewport?.offsetTop || 0) > 1
      || Math.abs(scroller?.scrollTop || 0) > 1;
    if (pending || keyboardObserved || shifted) {
      pending = keyboardObserved = false;
      // Only reset the outer document. Schedule, grades and message history keep
      // their independent scroll positions inside the app.
      window.scrollTo({top:0, left:0, behavior:'instant'});
      if (scroller) scroller.scrollTop = 0;
    }
    restingHeight = Math.max(window.innerHeight || 0, height || 0);
  }
  function schedule() {
    if (!frame) frame = window.requestAnimationFrame(restore);
  }
  function settle() {
    pending = true;
    timers.splice(0).forEach(id => window.clearTimeout(id));
    schedule();
    // WebKit can finish panning after blur/resize has already been dispatched.
    for (const delay of [100, 350, 800]) timers.push(window.setTimeout(schedule, delay));
  }
  document.addEventListener('focusin', () => {
    if (!keyboardObserved) restingHeight = Math.max(window.innerHeight || 0, viewport?.height || 0);
  });
  document.addEventListener('focusout', settle);
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule);
  window.addEventListener('pageshow', settle);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) settle(); });
})();
