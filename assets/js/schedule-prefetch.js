/* Warm missing past weeks without changing the selected week or its live status. */
(() => {
  'use strict';
  let job = null, timer = null, running = false;
  const interval = 1500;
  function cancelTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function valid(current) {
    return job === current && current.isCurrent();
  }
  function visibleAndOnline() {
    return !document.hidden && navigator.onLine !== false;
  }
  function schedule(delay = interval) {
    if (timer !== null || running || !job || !job.weeks.length || !visibleAndOnline()) return;
    if (!valid(job)) { job = null; return; }
    timer = setTimeout(tick, delay);
  }
  async function tick() {
    timer = null;
    const current = job;
    if (!current || !valid(current) || !visibleAndOnline()) return;
    if (!current.canRun()) { schedule(); return; }
    running = true;
    let delay = interval;
    try {
      const week = current.weeks[0];
      const cached = await current.loadCached(week);
      if (!valid(current)) return;
      if (!cached) {
        if (!visibleAndOnline() || !current.canRun()) return;
        await current.loadWeek(week);
        if (!valid(current)) return;
      }
      current.weeks.shift();
      current.failures = 0;
    } catch {
      // Keep the failed week queued; do not retry a slow or rate-limited server in a loop.
      if (valid(current)) delay = Math.min(300000, 30000 * 2 ** Math.min(current.failures++, 4));
    } finally {
      running = false;
      schedule(delay);
    }
  }
  window.unilinkSchedulePrefetch = {
    start(options) {
      if (!Number.isInteger(options.currentWeek) || options.currentWeek < 1 || options.currentWeek > 54) return;
      if (job?.key !== options.key) {
        cancelTimer();
        job = {...options, failures: 0,
          weeks: Array.from({length: options.currentWeek - 1}, (_, index) => options.currentWeek - index - 1)};
      }
      schedule();
    },
    stop() { cancelTimer(); job = null; },
  };
  function resume() {
    if (!visibleAndOnline()) cancelTimer();
    else schedule();
  }
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  window.addEventListener('offline', resume);
})();
