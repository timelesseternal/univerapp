/* Measure the installed app's visible screen, independently of CSS viewport units. */
(() => {
  'use strict';
  const root = document.documentElement;
  if (!root.classList.contains('standalone-app')) return;
  const viewport = window.visualViewport;
  let frame = 0, settling = false, settleTimer = 0;
  const editing = () => !!document.activeElement?.matches?.(
    'textarea, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"]):not([type="color"])'
  );
  function measure() {
    frame = 0;
    // Keyboard and pinch zoom must not move navigation. Chat sizes its composer separately.
    if (editing() || settling || (viewport && Math.abs(viewport.scale - 1) > 0.01)) return;
    const heights = [window.innerHeight, viewport?.height].filter(value => Number.isFinite(value) && value > 0);
    if (!heights.length) return;
    root.style.setProperty('--app-viewport-height', `${Math.min(...heights)}px`);
  }
  function schedule() {
    if (!frame) frame = window.requestAnimationFrame(measure);
  }
  document.addEventListener('focusout', () => {
    // Safari finishes restoring the viewport after the input loses focus.
    settling = true;
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => { settling = false; schedule(); }, 600);
  });
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  viewport?.addEventListener('resize', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  measure();
})();
