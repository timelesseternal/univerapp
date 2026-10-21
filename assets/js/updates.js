/* Refresh only public application files; account and message storage stay intact. */
(() => {
  let busy = false;
  const CURRENT_VERSION = 'development';
  const currentVersion = CURRENT_VERSION;
  const htmlVersion = document.querySelector('meta[name="unilink-version"]')?.content;
  let available = false, checkWork = null, lastCheck = -Infinity, errorMessage = '';
  function render() {
    const notice = document.getElementById('appUpdateAvailable');
    const badge = document.getElementById('profileUpdateBadge');
    const profileTab = document.getElementById('section-profile');
    const button = document.getElementById('appUpdateButton');
    const status = document.getElementById('appUpdateStatus');
    if (notice) notice.hidden = !available;
    if (badge) badge.hidden = !available;
    if (profileTab) profileTab.setAttribute('aria-label', available ? 'Профиль — доступна новая версия' : 'Профиль');
    if (button) {
      button.disabled = busy;
      if (busy) {
        button.setAttribute('aria-busy', 'true');
        button.innerHTML = window.unilinkLoading.html('Обновление приложения', true);
      } else {
        button.removeAttribute('aria-busy');
        button.textContent = available ? 'Обновить до новой версии' : 'Обновить приложение';
      }
    }
    if (status) status.textContent = errorMessage;
  }
  function check(force = false) {
    if (checkWork) return checkWork;
    if (!currentVersion || busy || document.hidden || navigator.onLine === false
      || (!force && Date.now() - lastCheck < 60000)) return Promise.resolve();
    lastCheck = Date.now();
    checkWork = (async () => {
      try {
        // Public release metadata bypasses both the worker and HTTP caches.
        const response = await fetch('/version.json', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(8000) });
        if (!response.ok) return;
        const data = await response.json();
        if (typeof data?.version !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(data.version)) return;
        available = data.version !== currentVersion || Boolean(htmlVersion && htmlVersion !== currentVersion);
        render();
      } catch { /* Background checks must never interrupt the current screen. */ }
    })().finally(() => { checkWork = null; });
    return checkWork;
  }
  function activated(worker) {
    if (worker.state === 'activated') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        worker.removeEventListener('statechange', changed);
        error ? reject(error) : resolve();
      };
      const changed = () => {
        if (worker.state === 'activated') finish();
        else if (worker.state === 'redundant') finish(new Error('activation_failed'));
      };
      const timer = setTimeout(() => finish(new Error('activation_timeout')), 15000);
      worker.addEventListener('statechange', changed);
      changed();
    });
  }
  function refreshShell(worker) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const finish = error => {
        clearTimeout(timer);
        channel.port1.close();
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(() => finish(new Error('refresh_timeout')), 20000);
      channel.port1.onmessage = event => finish(event.data?.ok ? null : new Error('refresh_failed'));
      try { worker.postMessage({ type: 'REFRESH_SHELL' }, [channel.port2]); }
      catch (error) { finish(error); }
    });
  }
  window.updateApplication = async button => {
    if (busy) return;
    busy = true;
    errorMessage = '';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = window.unilinkLoading.html('Проверка обновления', true);
    render();
    try {
      if (navigator.onLine === false) throw new Error('offline');
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/')
          || await navigator.serviceWorker.register('./assets/js/sw.js', { scope: '/', updateViaCache: 'none' });
        let updateTimer;
        try {
          await Promise.race([registration.update(), new Promise((_, reject) => {
            updateTimer = setTimeout(() => reject(new Error('update_timeout')), 15000);
          })]);
        } finally { clearTimeout(updateTimer); }
        const pending = registration.installing || registration.waiting;
        if (pending) await activated(pending);
        const worker = registration.active;
        if (!worker) throw new Error('worker_missing');
        await refreshShell(worker);
      } else {
        const response = await fetch('./index.html', { cache: 'reload', signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error('refresh_failed');
      }
      window.location.reload();
    } catch {
      errorMessage = 'Не удалось обновить приложение. Проверьте интернет и попробуйте ещё раз.';
    } finally {
      busy = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = 'Обновить приложение';
      render();
    }
  };
  window.unilinkUpdates = { check, render };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('online', () => check(true));
  window.addEventListener('focus', () => check());
  setInterval(() => check(), 60000);
  check();
})();
