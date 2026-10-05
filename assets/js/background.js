/* One silent looping video shared by the login screen and the application. */
(() => {
  'use strict';
  const surfaces = Array.from(document.querySelectorAll('.aurora-backdrop'));
  if (!surfaces.length) return;
  const login = document.getElementById('loginOverlay');
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
  let active = null, loaded = false, failed = false, playPending = false, suspended = false;
  const scriptURL = document.currentScript && document.currentScript.src;
  const connection = navigator.connection;
  let startupComplete = false;
  function allowVideo() {
    return startupComplete && !motion.matches && !(connection && connection.saveData);
  }

  function chooseSurface() {
    const visible = login && !login.classList.contains('hidden') && getComputedStyle(login).display !== 'none';
    const next = visible ? surfaces.find(surface => login.contains(surface)) : surfaces.find(surface => !login || !login.contains(surface));
    if (next && next !== active) {
      if (active) active.classList.remove('video-ready');
      active = next;
      active.appendChild(video);
      if (loaded) active.classList.add('video-ready');
    }
  }
  function shouldPlay() { return allowVideo() && !document.hidden && !failed && !suspended; }
  function sync() {
    chooseSurface();
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
  video.addEventListener('loadeddata', () => {
    loaded = true;
    chooseSurface();
    if (active) active.classList.add('video-ready');
    sync();
  });
  video.addEventListener('error', () => {
    failed = true;
    loaded = false;
    video.pause();
    surfaces.forEach(surface => surface.classList.remove('video-ready'));
  });
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('pointerdown', sync, { passive: true });
  document.addEventListener('keydown', sync);
  window.addEventListener('pagehide', () => { suspended = true; video.pause(); });
  window.addEventListener('pageshow', () => { suspended = false; sync(); });
  if (motion.addEventListener) motion.addEventListener('change', sync);
  else if (motion.addListener) motion.addListener(sync);
  if (connection && connection.addEventListener) connection.addEventListener('change', sync);
  if (login) new MutationObserver(sync).observe(login, { attributes: true, attributeFilter: ['class', 'style'] });
  chooseSurface();
  window.addEventListener('univer-ready', () => {
    const start = () => { startupComplete = true; sync(); };
    if (window.requestIdleCallback) window.requestIdleCallback(start, { timeout: 3000 });
    else setTimeout(start, 1500);
  }, { once: true });
})();
