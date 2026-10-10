(() => {
  'use strict';
  const selector = '#scheduleContainer .lesson-event, #sectionSchedule .notice-panel, #gradesContainer .grade-card, #gradesContainer .gpa-card, #profileContainer .profile-hero, #profileContainer .gpa-card, #profileContainer .profile-study-tile, #profileContainer .wrapped-launch, .academic-container .academic-card, .academic-container .transcript-stats';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const observed = new Set(), visible = new Set(), applied = new Set();
  let enabled = true, frame = 0, dirty = true;
  const clamp = n => Math.max(0, Math.min(1, n));
  function geometry(rect, dock) {
    if (rect.height <= 0 || rect.width <= 0 || rect.bottom <= dock.top - 48 || rect.top >= dock.bottom) return null;
    const progress = clamp((rect.bottom - dock.top + 48) / 100);
    const direction = clamp((rect.left + rect.width / 2 - dock.left) / dock.width) * 2 - 1;
    return { start: Math.max(0, dock.top - 48 - rect.top), end: Math.max(0, dock.top + 24 - rect.top), spread: 1 + .025 * progress, shift: direction * 6 * progress };
  }
  function reset(card) {
    card.classList.remove('dock-dissolve');
    for (const key of ['--dock-fade-start', '--dock-fade-end', '--dock-spread', '--dock-shift']) card.style.removeProperty(key);
    applied.delete(card);
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else { visible.delete(entry.target); if (applied.has(entry.target)) reset(entry.target); }
    }
    queue();
  }, { rootMargin: '80px 0px' });
  function discover() {
    const cards = new Set(document.querySelectorAll(selector));
    for (const card of observed) if (!cards.has(card)) {
      observer.unobserve(card); observed.delete(card); visible.delete(card); if (applied.has(card)) reset(card);
    }
    for (const card of cards) if (!observed.has(card)) { observed.add(card); observer.observe(card); }
    dirty = false;
  }
  function update() {
    frame = 0;
    if (dirty) discover();
    const dock = document.getElementById('bottomTabBar');
    const inactive = !enabled || reduced.matches || document.hidden || document.body.classList.contains('login-screen') || document.body.classList.contains('chat-keyboard-open') || document.body.classList.contains('wrapped-open') || !dock;
    const bounds = inactive ? null : dock.getBoundingClientRect();
    if (!bounds || !bounds.height || !bounds.width) { [...applied].forEach(reset); return; }
    // Read all positions before writing styles; no permanent animation loop.
    const changes = [...visible].map(card => [card, geometry(card.getBoundingClientRect(), bounds)]);
    for (const [card, effect] of changes) {
      if (!effect) { if (applied.has(card)) reset(card); continue; }
      card.style.setProperty('--dock-fade-start', `${effect.start.toFixed(1)}px`);
      card.style.setProperty('--dock-fade-end', `${effect.end.toFixed(1)}px`);
      card.style.setProperty('--dock-spread', effect.spread.toFixed(4));
      card.style.setProperty('--dock-shift', `${effect.shift.toFixed(2)}px`);
      card.classList.add('dock-dissolve'); applied.add(card);
    }
  }
  function queue() { if (!frame) frame = requestAnimationFrame(update); }
  const wrapper = document.querySelector('.app-wrapper');
  if (wrapper) new MutationObserver(() => { dirty = true; queue(); }).observe(wrapper, { childList: true, subtree: true });
  new MutationObserver(queue).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new ResizeObserver(queue).observe(document.getElementById('bottomTabBar'));
  document.addEventListener('scroll', queue, { passive: true, capture: true });
  document.addEventListener('click', queue, { passive: true });
  document.addEventListener('toggle', queue, { capture: true, passive: true });
  document.addEventListener('visibilitychange', queue);
  window.addEventListener('resize', queue, { passive: true });
  window.visualViewport?.addEventListener('resize', queue, { passive: true });
  reduced.addEventListener('change', queue);
  window.UniLinkDockEffect = { setEnabled(value) { enabled = !!value; if (!enabled) [...applied].forEach(reset); queue(); } };
  queue();
})();
