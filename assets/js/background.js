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
  const frameInterval = navigator.hardwareConcurrency <= 4 ? 1000 / 24 : 1000 / 30;
  let ready = false, suspended = false, frame = null, previous = null, time = 0;
  let palette, width = 1, height = 1;
  const specks = Array.from({ length: 160 }, (_, dot) => {
    const seed = Math.sin(dot * 127.1 + 19.7) * 43758.5453;
    const other = Math.sin(dot * 311.7 + 47.3) * 19341.592;
    return { x: seed - Math.floor(seed), y: other - Math.floor(other) };
  });
  function colors() {
    const style = getComputedStyle(document.documentElement);
    const rgb = style.getPropertyValue('--accent-rgb').trim() || '92, 150, 140';
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const channels = rgb.split(',').map(value => Number(value.trim()));
    const accent = channels.length === 3 && channels.every(Number.isFinite)
      ? channels.map(value => Math.max(0, Math.min(255, value))) : [92, 150, 140];
    // Equal perceived brightness keeps yellow, purple and green equally quiet.
    // Mix toward a neutral endpoint instead of clipping individual channels.
    const luminance = accent[0] * .2126 + accent[1] * .7152 + accent[2] * .0722;
    const target = dark ? 185 : 105;
    const endpoint = luminance < target ? 255 : 0;
    const amount = Math.abs(target - luminance) / Math.max(1, Math.abs(endpoint - luminance));
    const lines = accent.map(value => Math.round(value + (endpoint - value) * amount)).join(', ');
    palette = { rgb, base: style.getPropertyValue('--aurora-base').trim() || '#0b1115',
      dark, lines };
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
    const rgba = alpha => `rgba(${palette.lines}, ${alpha})`;
    const glow = ctx.createRadialGradient(width * .6, height * .45, 0,
      width * .6, height * .45, Math.max(width, height) * .65);
    glow.addColorStop(0, `rgba(${palette.rgb}, ${palette.dark ? .045 : .055})`);
    glow.addColorStop(1, `rgba(${palette.rgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const pixel = width / Math.max(1, window.innerWidth);
    // Reference: 720 × 1280, 23.98 fps. The crest travels about 0.12 screen
    // heights in 3.5 seconds. Repeat the wave in space, not the animation clock.
    const wavelength = .94;
    const travel = (time * .034) % wavelength;
    const peak = (distance, spread) => Math.exp(-Math.pow(distance / spread, 2));
    const upperLight = .10 + .38 * Math.pow(Math.sin(time * .55), 2);
    const upperPosition = .04 + .025 * Math.sin(time * .7 + 2);
    for (let line = 0; line < 19; line++) {
      const u = line / 18;
      const bend = .395 - .10 * u + .095 * Math.exp(-Math.pow((u - .48) / .21, 2))
        + .008 * Math.sin(u * 9);
      const release = bend + .165 - .045 * u;
      const variation = .65 + .35 * Math.pow(Math.sin(u * 11 + 1), 2);
      const tailStrength = .52 * peak(u - .61, .075);
      const upperStrength = upperLight * peak(u - .22, .2);
      const tailPosition = .87 + .05 * Math.sin(u * 6);
      const upperFoldStrength = peak(u - .15, .2);
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      for (let stop = 0; stop <= 100; stop++) {
        const v = stop / 100;
        let light = .003;
        for (let wave = -2; wave <= 2; wave++) {
          const offset = travel + wave * wavelength;
          const crest = peak(v - bend - offset - .006, .025);
          const reflection = peak(v - bend - offset - .060, .072);
          const tail = peak(v - tailPosition - offset, .085);
          light += (crest + reflection * .18) * variation
            + tail * tailStrength;
        }
        light += peak(v - upperPosition, .035) * upperStrength;
        gradient.addColorStop(v, rgba(Math.min(1, light) * (palette.dark ? .90 : .32)));
      }
      ctx.strokeStyle = gradient;
      ctx.beginPath();
      for (let step = 0; step <= 160; step++) {
        const v = step / 160;
        const fan = (u - .5) * .34 * Math.sin(Math.PI * v);
        let fold = 0;
        for (let wave = -2; wave <= 2; wave++) {
          const offset = travel + wave * wavelength;
          fold += .055 * (Math.tanh((v - bend - offset) / .032)
            - Math.tanh((v - release - offset) / .049));
        }
        fold += .025 * (Math.tanh((v - .025) / .018)
          - Math.tanh((v - .11) / .045)) * upperFoldStrength;
        const ripple = .010 * Math.sin((v - travel) * Math.PI * 6 / wavelength + u * 2);
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
      const x = width * (specks[dot].x * .94 + .03 + .008 * Math.sin(time * .16 + dot));
      const y = height * (specks[dot].y * .94 + .03 + .006 * Math.cos(time * .14 + dot));
      const shine = .04 + .28 * Math.pow(.5 + .5 * Math.sin(time * 1.1 + dot * 2.1), 3);
      ctx.fillStyle = rgba(shine * (palette.dark ? 1 : .55));
      const size = Math.max(.6, (dot % 7 === 0 ? 2 : 1) * pixel);
      ctx.fillRect(x, y, size, size);
    }
  }
  function allowed() {
    return ready && !suspended && !document.hidden && !document.body.classList.contains('wrapped-open') && !motion.matches && !connection?.saveData;
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
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pagehide', () => { suspended = true; sync(); });
  window.addEventListener('pageshow', () => { suspended = false; colors(); resize(); sync(); });
  if (motion.addEventListener) motion.addEventListener('change', sync);
  else if (motion.addListener) motion.addListener(sync);
  connection?.addEventListener?.('change', sync);
  window.addEventListener('univer-ready', () => { ready = true; sync(); }, { once: true });
})();
