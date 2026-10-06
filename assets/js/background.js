/* Persistent video layers crossfade the mismatch between the last and first frames.
   The standby decoder is paused except during the short transition. */
(() => {
  'use strict';
  const surface = document.querySelector('.aurora-backdrop');
  if (!surface) return;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection;
  const scriptURL = document.currentScript && document.currentScript.src;
  const source = new URL('../media/background.mp4', scriptURL || new URL('./assets/js/background.js', document.baseURI)).href;
  const layer = document.createElement('div');
  layer.className = 'video-background';
  layer.setAttribute('aria-hidden', 'true');
  const videos = [0, 1].map(index => {
    const video = document.createElement('video');
    video.className = 'video-background-frame';
    video.muted = video.defaultMuted = true;
    video.loop = false;
    video.playsInline = true;
    video.preload = 'none';
    video.controls = false;
    video.disablePictureInPicture = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('tabindex', '-1');
    video.style.opacity = index === 0 ? '1' : '0';
    video.style.zIndex = index === 0 ? '1' : '2';
    layer.appendChild(video);
    return video;
  });
  surface.appendChild(layer);

  const pending = new Set();
  let active = 0, blend = null, failed = false, suspended = false, startupComplete = false;
  const fadeSeconds = 1.2;
  function allowed() { return startupComplete && !motion.matches && !(connection && connection.saveData); }
  function shouldPlay() { return allowed() && !document.hidden && !failed && !suspended; }
  function showVideo() {
    surface.classList.add('video-ready');
    document.body.classList.add('has-animated-background');
  }
  function finishBlend() {
    if (!blend) return;
    clearTimeout(blend.timer);
    const outgoing = videos[blend.from];
    const incoming = videos[blend.to];
    outgoing.pause();
    outgoing.style.transition = 'none';
    outgoing.style.opacity = '0';
    outgoing.style.zIndex = '2';
    incoming.style.transition = 'none';
    incoming.style.opacity = '1';
    incoming.style.zIndex = '1';
    active = blend.to;
    blend = null;
    try { outgoing.currentTime = 0; } catch (e) { /* Retry the seek at the next blend. */ }
  }
  function play(index) {
    const video = videos[index];
    if (!video.paused || pending.has(index)) return;
    pending.add(index);
    try {
      Promise.resolve(video.play()).then(() => {
        pending.delete(index);
        if (!shouldPlay()) video.pause();
        else if (video.paused && (index === active || (blend && index === blend.to))) play(index);
      }, () => {
        pending.delete(index);
        if (blend && blend.to === index && !blend.started) blend = null;
      });
    } catch (e) {
      pending.delete(index);
      if (blend && blend.to === index && !blend.started) blend = null;
    }
  }
  function beginBlend() {
    if (blend || !shouldPlay()) return;
    const next = 1 - active;
    const incoming = videos[next];
    try { incoming.currentTime = 0; } catch (e) { return; }
    incoming.style.transition = 'none';
    incoming.style.opacity = '0';
    incoming.style.zIndex = '2';
    const duration = videos[active].duration;
    blend = { from: active, to: next, started: false, timer: null,
      seconds: Number.isFinite(duration) ? Math.min(fadeSeconds, duration / 3) : fadeSeconds };
    play(next);
  }
  function sync() {
    if (!allowed() || failed) {
      surface.classList.remove('video-ready');
      document.body.classList.remove('has-animated-background');
    }
    if (!shouldPlay()) {
      videos.forEach(video => video.pause());
      if (blend && blend.started) finishBlend();
      return;
    }
    videos.forEach(video => {
      if (!video.getAttribute('src')) {
        video.preload = 'auto';
        video.src = source;
      }
    });
    if (blend) {
      play(blend.to);
      if (!videos[blend.from].ended) play(blend.from);
    } else if (videos[active].ended) beginBlend();
    else play(active);
  }
  videos.forEach((video, index) => {
    video.addEventListener('playing', () => {
      if (!shouldPlay()) { video.pause(); return; }
      showVideo();
      if (blend && blend.to === index && !blend.started) {
        blend.started = true;
        // Outgoing stays opaque so the midpoint does not darken.
        video.style.transition = `opacity ${blend.seconds}s linear`;
        video.style.opacity = '1';
        blend.timer = setTimeout(finishBlend, blend.seconds * 1000);
      }
    });
    video.addEventListener('timeupdate', () => {
      if (index !== active || blend || !Number.isFinite(video.duration)) return;
      if (video.duration - video.currentTime <= Math.min(fadeSeconds, video.duration / 3)) beginBlend();
    });
    // Hold the final frame if preparation is late, instead of jumping to frame zero.
    video.addEventListener('ended', () => { if (index === active) beginBlend(); });
    video.addEventListener('error', () => { failed = true; sync(); });
  });
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('pointerdown', sync, { passive: true });
  document.addEventListener('keydown', sync);
  window.addEventListener('pagehide', () => { suspended = true; sync(); });
  window.addEventListener('pageshow', () => { suspended = false; sync(); });
  if (motion.addEventListener) motion.addEventListener('change', sync);
  else if (motion.addListener) motion.addListener(sync);
  if (connection && connection.addEventListener) connection.addEventListener('change', sync);
  window.addEventListener('univer-ready', () => {
    const start = () => { startupComplete = true; sync(); };
    if (window.requestIdleCallback) window.requestIdleCallback(start, { timeout: 3000 });
    else setTimeout(start, 1500);
  }, { once: true });
})();
