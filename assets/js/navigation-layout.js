(() => {
  'use strict';
  const root = document.documentElement;
  const viewport = window.visualViewport;
  function sync() {
    // iOS can pan or resize the visible viewport independently of the page.
    // Keep the shared navigation attached to its lower edge in every section.
    const offset = viewport && viewport.scale === 1
      ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
    root.style.setProperty('--navigation-viewport-offset', `${offset}px`);
  }
  viewport?.addEventListener('resize', sync, { passive: true });
  viewport?.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync, { passive: true });
  window.addEventListener('pageshow', sync);
  sync();
})();
