// Apply the saved appearance before first paint to avoid a light flash.
    (() => {
      const storageKey = 'user_color_mode';
      const root = document.documentElement;
      const systemTheme = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      const telegram = window.Telegram ? window.Telegram.WebApp : null;
      let preference = null;
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved === 'light' || saved === 'dark') preference = saved;
      } catch (e) { /* Appearance still works when storage is unavailable. */ }

      function applyAppearance() {
        const mode = preference || (telegram
          ? (telegram.colorScheme === 'dark' ? 'dark' : 'light')
          : (systemTheme && systemTheme.matches ? 'dark' : 'light'));
        const dark = mode === 'dark';
        if (dark) root.setAttribute('data-theme', 'dark');
        else root.removeAttribute('data-theme');
        root.style.colorScheme = mode;
        const background = dark ? '#070809' : '#f0f2f7';
        const themeMeta = document.querySelector('meta[name="theme-color"]');
        if (themeMeta) themeMeta.setAttribute('content', background);
        document.querySelectorAll('.appearance-toggle').forEach(button => {
          const label = dark ? 'Включить светлую тему' : 'Включить тёмную тему';
          button.setAttribute('aria-label', label);
          button.setAttribute('title', label);
          button.setAttribute('aria-pressed', String(dark));
        });
        if (telegram) {
          try {
            if (telegram.setHeaderColor) telegram.setHeaderColor(background);
            if (telegram.setBackgroundColor) telegram.setBackgroundColor(background);
          } catch (e) { /* Older Telegram clients may not support custom colors. */ }
        }
      }

      window.toggleColorMode = () => {
        preference = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(storageKey, preference); } catch (e) { /* Keep the in-memory choice. */ }
        applyAppearance();
        if (typeof haptic === 'function') haptic('light');
      };
      window.syncAppearanceFromSystem = () => { if (!preference) applyAppearance(); };
      if (systemTheme) {
        if (systemTheme.addEventListener) systemTheme.addEventListener('change', window.syncAppearanceFromSystem);
        else if (systemTheme.addListener) systemTheme.addListener(window.syncAppearanceFromSystem);
      }
      applyAppearance();
      document.addEventListener('DOMContentLoaded', applyAppearance);
    })();
