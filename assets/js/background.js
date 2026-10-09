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
    const silver = palette.dark ? '238, 240, 241' : '47, 53, 59';
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
    for (let line = 0; line < 30; line++) {
      const u = line / 29;
      const highlight = .28 + .32 * u + .085 * Math.sin(time * .5 + u * 3);
      const band = .18 + .82 * Math.exp(-Math.pow((u - .42 - .12 * Math.sin(time * .18)) / .3, 2));
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, rgba(.015));
      gradient.addColorStop(highlight - .10, rgba(palette.dark ? .07 : .045));
      gradient.addColorStop(highlight, rgba((palette.dark ? .92 : .38) * band));
      gradient.addColorStop(highlight + .10, rgba(palette.dark ? .07 : .045));
      gradient.addColorStop(1, rgba(.015));
      ctx.strokeStyle = gradient;
      ctx.beginPath();
      for (let step = 0; step <= 96; step++) {
        const v = step / 96;
        const spread = .77 + .08 * Math.sin(v * 4 - time * .24);
        const shoulder = Math.exp(-Math.pow((v - .34 - .025 * Math.sin(time * .35)) / .17, 2));
        const waist = Math.exp(-Math.pow((v - .60 - .04 * Math.cos(time * .27)) / .15, 2));
        const x = width * (.12 + .48 * v + (u - .5) * spread
          + .17 * shoulder - .11 * waist
          + .04 * Math.sin(v * 12 - time * .6 + u * .7));
        const y = height * (v * 1.1 - .05);
        if (step) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.globalAlpha = .15;
      ctx.lineWidth = Math.max(.8, 4 * pixel);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(.45, 1.15 * pixel);
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
