// Delegated, allowlisted actions keep HTML free of executable inline handlers.
(() => {
  'use strict';
  const allowed = new Set([
    'toggleColorMode', 'togglePasswordVisibility', 'submitLogin', 'restoreSavedLogin', 'closeCityModal',
    'saveCityAndLoad', 'selectAccentSwatch', 'closeAccentModal', 'saveAccentTheme',
    'shareUmkdFile', 'closeUmkdFile', 'closeLogoutConfirmation', 'jumpToToday',
    'openAccentModal', 'openCityModal', 'stepWeek', 'selectDay', 'switchSection',
    'tapTab', 'openSemesterWrapped', 'updateApplication', 'confirmLogout',
    'selectCityListItem', 'retryLiveLoad', 'selectUmkdSubject', 'openUmkdFile', 'renderUmkdSubjects',
  ]);
  function parse(value, element) {
    if (!value.trim()) return [];
    const args = [];
    const token = /\s*('(?:[^'\\]|\\['\\])*'|-?\d+|true|false|this)\s*(,|$)/gy;
    while (token.lastIndex < value.length) {
      const match = token.exec(value);
      if (!match) return null;
      const raw = match[1];
      args.push(raw === 'this' ? element : raw.startsWith("'")
        ? raw.slice(1, -1).replace(/\\(['\\])/g, '$1') : JSON.parse(raw));
      if (!match[2]) return args;
      if (token.lastIndex === value.length) return null;
    }
    return null;
  }
  document.addEventListener('click', event => {
    const element = event.target.closest?.('[data-action]');
    if (!element || element.disabled) return;
    const match = /^([A-Za-z]\w*)\((.*)\)$/.exec(element.dataset.action || '');
    if (!match || !allowed.has(match[1]) || typeof window[match[1]] !== 'function') return;
    const args = parse(match[2], element);
    if (args) window[match[1]](...args);
  });
  document.addEventListener('input', event => {
    if (event.target.matches?.('[data-city-filter]')) window.filterCityList(event.target.value);
  });
})();
