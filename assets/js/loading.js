(() => {
  'use strict';
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = () => '<svg aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle class="content-loading-track" cx="16" cy="16" r="11"/><circle class="content-loading-arrow" cx="16" cy="16" r="11" stroke-dasharray="24 46" transform="rotate(-90 16 16)"/></svg>';
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
