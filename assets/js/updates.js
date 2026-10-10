/* Refresh only public application files; account and message storage stay intact. */
(() => {
  let busy = false;
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
    const status = document.getElementById('appUpdateStatus');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Проверяем обновление…';
    if (status) status.textContent = '';
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
        button.textContent = 'Загружаем обновление…';
        await refreshShell(worker);
      } else {
        const response = await fetch('./index.html', { cache: 'reload', signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error('refresh_failed');
      }
      window.location.reload();
    } catch {
      if (status) status.textContent = 'Не удалось обновить приложение. Проверьте интернет и попробуйте ещё раз.';
    } finally {
      busy = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = 'Обновить приложение';
    }
  };
})();
