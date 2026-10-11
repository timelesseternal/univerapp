(() => {
  'use strict';
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let settleTimer;
  function editing() {
    const element = document.activeElement;
    if (!element || element.disabled || element.readOnly) return false;
    if (element.isContentEditable || element.tagName === 'TEXTAREA') return true;
    return element.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|color|file|hidden|image)$/i.test(element.type || 'text');
  }
  function sync() {
    // Safari can retain a reduced/panned visual viewport after keyboard dismissal.
    // Outside text entry the native fixed bottom is authoritative, not that gap.
    const keyboard = viewport && viewport.scale === 1 && editing()
      && window.innerHeight - viewport.height > 120;
    const offset = keyboard
      ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
    root.style.setProperty('--navigation-viewport-offset', `${offset}px`);
  }
  function settle() {
    sync();
    clearTimeout(settleTimer);
    // WebKit settles the viewport asynchronously after focus/restore events.
    settleTimer = setTimeout(sync, 350);
  }
  viewport?.addEventListener('resize', sync, { passive: true });
  viewport?.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync, { passive: true });
  window.addEventListener('pageshow', settle);
  document.addEventListener('focusin', settle);
  document.addEventListener('focusout', () => {
    root.style.setProperty('--navigation-viewport-offset', '0px');
    clearTimeout(settleTimer);
    settleTimer = setTimeout(sync, 350);
  });
  document.addEventListener('visibilitychange', settle);
  sync();
})();
