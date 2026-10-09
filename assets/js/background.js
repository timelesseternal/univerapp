/* Procedural metallic folds with moving specular highlights. No video or loop reset. */
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
    ctx.fillStyle = palette.dark ? '#020304' : palette.base;
    ctx.fillRect(0, 0, width, height);
    const silver = palette.dark ? '238, 240, 241' : '47, 53, 59';
    const rgba = alpha => `rgba(${silver}, ${alpha})`;
    const glow = ctx.createRadialGradient(width * .6, height * .45, 0,
      width * .6, height * .45, Math.max(width, height) * .65);
    glow.addColorStop(0, `rgba(${palette.rgb}, ${palette.dark ? .018 : .025})`);
    glow.addColorStop(1, `rgba(${palette.rgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const pixel = width / Math.max(1, window.innerWidth);
    // The ribs fan out from the upper-left and fold at different heights.
    // A narrow moving light exposes only the crests; the rest falls into black.
    for (let line = 0; line < 19; line++) {
      const u = line / 18;
      const bend = .395 - .10 * u + .095 * Math.exp(-Math.pow((u - .48) / .21, 2))
        + .008 * Math.sin(u * 9) + .014 * Math.sin(time * .42 + u * 1.6);
      const release = .57 - .09 * u + .022 * Math.sin(time * .31 + 1);
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      for (let stop = 0; stop <= 100; stop++) {
        const v = stop / 100;
        const crest = Math.exp(-Math.pow((v - bend - .006) / .026, 2));
        const reflection = Math.exp(-Math.pow((v - bend - .070) / .085, 2));
        const upper = Math.exp(-Math.pow((v - .035 - u * .26) / .035, 2));
        const tail = Math.exp(-Math.pow((v - .87 - .05 * Math.sin(u * 6 + time * .2)) / .085, 2));
        const variation = .65 + .35 * Math.pow(Math.sin(u * 11 + 1), 2);
        const light = .002 + (crest + reflection * .22) * variation
          + upper * .30 * Math.exp(-Math.pow((u - .22) / .2, 2))
          + tail * .48 * Math.exp(-Math.pow((u - .61) / .065, 2));
        gradient.addColorStop(v, rgba(Math.min(1, light) * (palette.dark ? 1 : .40)));
      }
      ctx.strokeStyle = gradient;
      ctx.beginPath();
      for (let step = 0; step <= 160; step++) {
        const v = step / 160;
        const fan = (u - .5) * .34 * Math.sin(Math.PI * v);
        const fold = .055 * Math.tanh((v - bend) / .032)
          - .053 * Math.tanh((v - release) / .049);
        const ripple = .010 * Math.sin(v * 17 + u * 2 - time * .38);
        const x = width * (.05 + .27 * u + (.56 + .19 * u) * v + fan + fold + ripple);
        const y = height * v;
        if (step) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.globalAlpha = .035;
      ctx.lineWidth = Math.max(2, 11 * pixel);
      ctx.stroke();
      ctx.globalAlpha = .13;
      ctx.lineWidth = Math.max(1, 4.5 * pixel);
      ctx.stroke();
      ctx.globalAlpha = .40;
      ctx.lineWidth = Math.max(.7, 2.3 * pixel);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(.5, 1.25 * pixel);
      ctx.stroke();
    }
    // Deterministic specks shimmer gently, without random flicker between frames.
    for (let dot = 0; dot < 160; dot++) {
      const seed = Math.sin(dot * 127.1 + 19.7) * 43758.5453;
      const other = Math.sin(dot * 311.7 + 47.3) * 19341.592;
      const x = width * ((seed - Math.floor(seed)) * .94 + .03 + .008 * Math.sin(time * .16 + dot));
      const y = height * ((other - Math.floor(other)) * .94 + .03 + .006 * Math.cos(time * .14 + dot));
      const shine = .08 + .38 * Math.pow(.5 + .5 * Math.sin(time * .7 + dot * 2.1), 3);
      ctx.fillStyle = rgba(shine);
      const size = Math.max(.6, (dot % 7 === 0 ? 2 : 1) * pixel);
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
