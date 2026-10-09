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
    const accent = palette.rgb.split(',').map(Number);
    const silver = accent.map(value => Math.round(palette.dark ? 205 + value * .18 : 35 + value * .28)).join(', ');
    const rgba = alpha => `rgba(${silver}, ${alpha})`;
    const glow = ctx.createRadialGradient(width * .6, height * .45, 0,
      width * .6, height * .45, Math.max(width, height) * .65);
    glow.addColorStop(0, `rgba(${palette.rgb}, ${palette.dark ? .07 : .04})`);
    glow.addColorStop(1, `rgba(${palette.rgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const pixel = width / Math.max(1, window.innerWidth);
    // One continuous field keeps the lines parallel while the folds change shape.
    for (let line = 0; line < 34; line++) {
      const u = line / 33;
      const highlight = .5 + .32 * Math.sin(time * .24 + u * 5);
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, rgba(.015));
      gradient.addColorStop(highlight - .13, rgba(palette.dark ? .07 : .045));
      gradient.addColorStop(highlight, rgba(palette.dark ? .68 : .28));
      gradient.addColorStop(highlight + .13, rgba(palette.dark ? .07 : .045));
      gradient.addColorStop(1, rgba(.015));
      ctx.strokeStyle = gradient;
      ctx.beginPath();
      for (let step = 0; step <= 96; step++) {
        const v = step / 96;
        const spread = .64 + .09 * Math.sin(v * 7 - time * .25);
        const x = width * (.46 + .35 * (v - .5) + (u - .5) * spread
          + .085 * Math.sin(v * 9 - time * .36)
          + .05 * Math.sin(v * 17 + time * .27 + u * .6));
        const y = height * (v * 1.1 - .05);
        if (step) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.globalAlpha = .15;
      ctx.lineWidth = Math.max(.8, 3.2 * pixel);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(.45, .9 * pixel);
      ctx.stroke();
    }
    // Deterministic specks shimmer gently, without random flicker between frames.
    for (let dot = 0; dot < 64; dot++) {
      const seed = Math.sin(dot * 127.1 + 19.7) * 43758.5453;
      const other = Math.sin(dot * 311.7 + 47.3) * 19341.592;
      const x = width * ((seed - Math.floor(seed)) * .94 + .03 + .008 * Math.sin(time * .16 + dot));
      const y = height * ((other - Math.floor(other)) * .94 + .03 + .006 * Math.cos(time * .14 + dot));
      const shine = .04 + .16 * Math.pow(.5 + .5 * Math.sin(time * .7 + dot * 2.1), 3);
      ctx.fillStyle = rgba(shine);
      const size = Math.max(.6, (dot % 5 === 0 ? 1.5 : .8) * pixel);
      ctx.fillRect(x, y, size, size);
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
