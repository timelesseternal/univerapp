(() => {
  'use strict';
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = () => '<svg aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle class="content-loading-track" cx="16" cy="16" r="11"/><g class="content-loading-arrow"><path d="M16 5a11 11 0 1 1-11 11M2 19l3-3 3 3"/></g></svg>';
  window.unilinkLoading = {
    icon,
    html(label = 'Загрузка', compact = false) {
      const tag = compact ? 'span' : 'div';
      return `<${tag} class="content-loading${compact ? ' content-loading-compact' : ''}" role="status" aria-label="${escape(label)}">${icon()}</${tag}>`;
    },
  };
  // Static tab placeholders use the same SVG as dynamic loading states.
  if (typeof document !== 'undefined') {
    document.querySelectorAll('[data-loading-icon]').forEach(element => { element.innerHTML = icon(); });
  }
})();
