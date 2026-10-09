/* Low-resolution procedural aurora. No video, network requests or loop reset. */
(() => {
  'use strict';
  const surface = document.querySelector('.aurora-backdrop');
  if (!surface) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  canvas.className = 'aurora-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  surface.appendChild(canvas);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection;
  const frameInterval = navigator.hardwareConcurrency <= 4 ? 50 : 1000 / 30;
  let ready = false, suspended = false, frame = null, previous = null, time = 0;
  let palette, width = 1, height = 1;
  function colors() {
    const style = getComputedStyle(document.documentElement);
    const rgb = style.getPropertyValue('--accent-rgb').trim() || '92, 150, 140';
    palette = { rgb, base: style.getPropertyValue('--aurora-base').trim() || '#0b1115',
      dark: document.documentElement.getAttribute('data-theme') === 'dark' };
  }
  function resize() {
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    const scale = Math.min(1, 720 / viewportWidth, 900 / viewportHeight,
      Math.sqrt(240000 / (viewportWidth * viewportHeight)));
    width = canvas.width = Math.max(1, Math.round(viewportWidth * scale));
    height = canvas.height = Math.max(1, Math.round(viewportHeight * scale));
    if (!document.hidden && !suspended) draw();
  }
  function draw() {
    ctx.fillStyle = palette.base;
    ctx.fillRect(0, 0, width, height);
    const rgba = alpha => `rgba(${palette.rgb}, ${alpha})`;
    for (let i = 0; i < 3; i++) {
      const x = width * (.5 + .42 * Math.sin(time * .09 + i * 2.3));
      const y = height * (.5 + .4 * Math.cos(time * .07 + i * 1.7));
      const radius = Math.max(width, height) * .65;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, rgba(palette.dark ? .23 : .13));
      glow.addColorStop(1, rgba(0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let ribbon = 0; ribbon < 3; ribbon++) {
      const phase = time * .12 + ribbon * 2;
      for (let layer = 3; layer >= 1; layer--) {
        const gradient = ctx.createLinearGradient(0, height, width, 0);
        gradient.addColorStop(0, rgba(0));
        gradient.addColorStop(.45, rgba((palette.dark ? .08 : .045) / layer));
        gradient.addColorStop(.75, rgba((palette.dark ? .14 : .07) / layer));
        gradient.addColorStop(1, rgba(0));
        ctx.strokeStyle = gradient;
        ctx.lineWidth = Math.max(width, height) * .045 * layer;
        ctx.beginPath();
        for (let step = 0; step <= 48; step++) {
          const u = step / 48;
          const x = width * (u * 1.2 - .1);
          const y = height * (.85 - .7 * u + .16 * Math.sin(u * 5 + phase)
            + .06 * Math.cos(u * 9 - phase * .7));
          if (step) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    }
  }
  function allowed() {
    return ready && !suspended && !document.hidden && !motion.matches && !connection?.saveData;
  }
  function tick(timestamp) {
    frame = null;
    if (!allowed()) { previous = null; return; }
    if (previous === null) previous = timestamp;
    const elapsed = timestamp - previous;
    if (elapsed >= frameInterval) {
      time += Math.min(elapsed, 100) / 1000;
      previous = timestamp;
      draw();
    }
    frame = window.requestAnimationFrame(tick);
  }
  function sync() {
    if (!allowed()) {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = previous = null;
    } else if (frame === null) frame = window.requestAnimationFrame(tick);
  }
  colors();
  resize();
  surface.classList.add('canvas-ready');
  document.body.classList.add('has-animated-background');
  new MutationObserver(() => {
    colors();
    if (!document.hidden && !suspended) draw();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pagehide', () => { suspended = true; sync(); });
  window.addEventListener('pageshow', () => { suspended = false; colors(); resize(); sync(); });
  if (motion.addEventListener) motion.addEventListener('change', sync);
  else if (motion.addListener) motion.addListener(sync);
  connection?.addEventListener?.('change', sync);
  window.addEventListener('univer-ready', () => { ready = true; sync(); }, { once: true });
})();
