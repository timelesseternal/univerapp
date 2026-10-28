/* Connect native browser/phone Back to the existing nested-screen back actions. */
(() => {
  'use strict';
  const history = window.history;
  if (!history?.pushState || !window.MutationObserver) return;
  const token = `unilink-${Date.now()}-${Math.random()}`;
  const marker = depth => ({...history.state, unilinkNavigation:{token,depth}});
  const byID = id => document.getElementById(id);
  const visible = el => !!el?.getClientRects().length;
  let entries = [], moving = false, applying = false;
  function screens() {
    if (document.body.classList.contains('login-screen')) return [];
    const result = [];
    const add = (key, button) => { if (button) result.push({key,button}); };
    if (visible(byID('sectionChat'))) {
      if (visible(byID('chatThread')) || visible(byID('chatPeerProfile'))) add('chat', byID('chatBack'));
      if (visible(byID('chatPeerProfile'))) add('peer-profile', byID('chatProfileBack'));
    }
    for (const id of ['sectionUmkd','sectionExams','sectionCalendar','sectionTranscript']) {
      const section = byID(id);
      if (!visible(section)) continue;
      add(id, section.querySelector(':scope > .navigation-back'));
      if (id === 'sectionUmkd') {
        const subjectBack = byID('umkdContainer')?.querySelector('.navigation-back');
        if (visible(subjectBack)) add('umkd-subject', subjectBack);
      }
    }
    if (visible(byID('umkdFileOverlay')) && byID('umkdFileOverlay').classList.contains('active'))
      add('pdf', byID('umkdFileOverlay').querySelector('.navigation-back'));
    const close = document.querySelector('dialog[open] .wrapped-close');
    if (close) add('recap', close);
    const logout = byID('logoutDialog');
    if (logout?.open) add('logout-dialog', logout.querySelector('.cancel'));
    const scheduleShare = byID('scheduleShareDialog');
    if (scheduleShare?.open) add('schedule-share', byID('scheduleShareClose'));
    if (byID('studyHistoryDialog')?.open) add('study-history', byID('studyHistoryClose'));
    return result;
  }
  function sync() {
    if (moving || applying) return;
    const next = screens();
    let common = 0;
    while (common < entries.length && common < next.length && entries[common].key === next[common].key) common++;
    if (common < entries.length) {
      // A visible Back button or tab change already closed these screens.
      // Consume the matching native history entries without closing anything twice.
      const removed = entries.length - common;
      entries = entries.slice(0,common);
      moving = true;
      history.go(-removed);
      return;
    }
    entries = next.slice(0,common);
    for (const entry of next.slice(common)) {
      entries.push(entry);
      history.pushState(marker(entries.length), '');
    }
  }
  history.replaceState(marker(0), '');
  window.addEventListener('popstate', event => {
    const state = event.state?.unilinkNavigation;
    if (state?.token !== token) return; // Leave the app's root/browser history alone.
    if (moving) { moving = false; sync(); return; }
    applying = true;
    const depth = Math.max(0, Math.min(entries.length, state.depth));
    while (entries.length > depth) entries.pop().button.click();
    applying = false;
    // Forward entries cannot resurrect private chats from an earlier login.
    history.replaceState(marker(entries.length), '');
    sync();
  });
  const observer = new window.MutationObserver(sync);
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','open']});
  sync();
})();
