/* One silent looping video shared by the login screen and the application. */
(() => {
  'use strict';
  const surface = document.querySelector('.aurora-backdrop');
  if (!surface) return;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const video = document.createElement('video');
  video.className = 'video-background';
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'none';
  video.controls = false;
  video.disablePictureInPicture = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  video.setAttribute('tabindex', '-1');
  let failed = false, playPending = false, suspended = false;
  const scriptURL = document.currentScript && document.currentScript.src;
  const connection = navigator.connection;
  let startupComplete = false;
  function allowVideo() {
    return startupComplete && !motion.matches && !(connection && connection.saveData);
  }

  function shouldPlay() { return allowVideo() && !document.hidden && !failed && !suspended; }
  function sync() {
    if (!allowVideo() || failed) {
      surface.classList.remove('video-ready');
      document.body.classList.remove('has-animated-background');
    }
    if (!shouldPlay()) { video.pause(); return; }
    if (!video.getAttribute('src')) video.src = new URL('../media/background.mp4', scriptURL || new URL('./assets/js/background.js', document.baseURI)).href;
    if (!video.paused || playPending) return;
    playPending = true;
    try {
      const attempt = video.play();
      if (attempt && typeof attempt.then === 'function') {
        attempt.then(() => {
          playPending = false;
          if (!shouldPlay()) video.pause();
        }, () => { playPending = false; });
      } else playPending = false;
    } catch (error) { playPending = false; }
    // If autoplay is denied, keep the first loaded frame and retry on a tap.
  }
  video.addEventListener('playing', () => {
    if (!shouldPlay()) { video.pause(); return; }
    surface.classList.add('video-ready');
    document.body.classList.add('has-animated-background');
  });
  video.addEventListener('error', () => {
    failed = true;
    video.pause();
    surface.classList.remove('video-ready');
    document.body.classList.remove('has-animated-background');
  });
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('pointerdown', sync, { passive: true });
  document.addEventListener('keydown', sync);
  window.addEventListener('pagehide', () => { suspended = true; video.pause(); });
  window.addEventListener('pageshow', () => { suspended = false; sync(); });
  if (motion.addEventListener) motion.addEventListener('change', sync);
  else if (motion.addListener) motion.addListener(sync);
  if (connection && connection.addEventListener) connection.addEventListener('change', sync);
  // Keep the decoder and compositing layer attached across login transitions.
  surface.appendChild(video);
  window.addEventListener('univer-ready', () => {
    const start = () => { startupComplete = true; sync(); };
    if (window.requestIdleCallback) window.requestIdleCallback(start, { timeout: 3000 });
    else setTimeout(start, 1500);
  }, { once: true });
})();
