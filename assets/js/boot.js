/* The launch mark covers session restoration; its dot reveals the prepared screen. */
(() => {
  'use strict';
  const root = document.documentElement, screen = document.getElementById('appBoot');
  if (!screen || !root.classList.contains('app-booting')) return;
  const startedAt = performance.now(), minimumDuration = 2000, revealDuration = 1200;
  screen.style.setProperty('--boot-reveal-duration', `${revealDuration}ms`);
  const dot = screen.querySelector('.boot-dot'), bloom = screen.querySelector('.boot-bloom');
  const targets = Array.from(document.querySelectorAll('#loginOverlay,.app-shell,#bottomTabBar'));
  const previousInert = targets.map(element => element.inert);
  targets.forEach(element => { element.inert = true; });
  let closing = false, finished = false, timer = null;
  function cleanup() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    bloom.removeEventListener('animationend', ended);
    screen.hidden = true;
    screen.setAttribute('aria-hidden', 'true');
    root.classList.remove('app-booting');
    targets.forEach((element, index) => { element.inert = previousInert[index]; });
  }
  function ended(event) {
    if (event.target === bloom && event.animationName === 'bootDotReveal') cleanup();
  }
  window.unilinkBoot = {
    finish(openApplication = false) {
      if (finished || closing) return;
      closing = true;
      if (document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        cleanup();
        return;
      }
      function reveal() {
        timer = null;
        if (document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          cleanup();
          return;
        }
        const bounds = screen.getBoundingClientRect(), point = dot.getBoundingClientRect();
        const x = point.left + point.width / 2 - bounds.left;
        const y = point.top + point.height / 2 - bounds.top;
        const size = Math.max(1, point.width);
        const radius = Math.hypot(Math.max(x, bounds.width - x), Math.max(y, bounds.height - y));
        screen.style.setProperty('--boot-x', `${x}px`);
        screen.style.setProperty('--boot-y', `${y}px`);
        screen.style.setProperty('--boot-dot-size', `${size}px`);
        screen.style.setProperty('--boot-scale', String((radius * 2 + 4) / size));
        bloom.addEventListener('animationend', ended);
        screen.classList.add('is-revealing');
        timer = setTimeout(cleanup, revealDuration + 200);
      }
      if (openApplication) {
        const hold = Math.max(0, minimumDuration - revealDuration - (performance.now() - startedAt));
        if (hold) timer = setTimeout(reveal, hold);
        else reveal();
      } else {
        // No authenticated screen to reveal: expose the login form or retry message.
        screen.classList.add('is-dismissed');
        timer = setTimeout(cleanup, 180);
      }
    },
  };
})();
