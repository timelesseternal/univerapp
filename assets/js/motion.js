/* Short, interruptible transitions. Never transform the viewport or navigation dock. */
(() => {
  'use strict';
  const running = new WeakMap(), disclosures = new WeakMap(), closing = new WeakMap(), cascades = new WeakMap(), cardAnimations = new WeakMap();
  const ease = 'cubic-bezier(.16,1,.3,1)';
  const reduced = () => document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function cascade(element) {
    if (!element) return false;
    (cascades.get(element) || []).forEach(animation => animation.cancel());
    cascades.delete(element);
    if (reduced()) return false;
    const targets = [...(element.querySelectorAll?.('.lesson-event, .grade-card, .profile-layout > *, #chatInbox > .chat-person, #chatResults > .chat-person, .exam-card, .umkd-subject-row, .transcript-period, .weather-location, .weather-scene, .weather-data-panel') || [])]
      .filter(target => target.animate && (!target.getClientRects || target.getClientRects().length))
      .filter(target => !target.getBoundingClientRect || target.getBoundingClientRect().top < (window.innerHeight || Infinity))
      .slice(0, 8);
    if (!targets.length) return false;
    running.get(element)?.cancel(); running.delete(element);
    const animations = targets.map((target, index) => {
      cardAnimations.get(target)?.cancel();
      const animation=target.animate([
        {opacity:0, transform:'translateY(10px)'}, {opacity:1, transform:'translateY(0)'},
      ], {duration:300, delay:Math.min(index, 4) * 70, easing:ease, fill:'backwards'});
      cardAnimations.set(target,animation);
      animation.finished.catch(()=>{}).then(()=>{if(cardAnimations.get(target)===animation)cardAnimations.delete(target);});
      return animation;
    });
    cascades.set(element, animations);
    Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(() => {
      if (cascades.get(element) === animations) cascades.delete(element);
    });
    return true;
  }
  function enter(element, {x = 0, y = 0, duration = 260} = {}) {
    if (!element) return;
    running.get(element)?.cancel(); running.delete(element);
    if (cascade(element)) return;
    if (reduced() || !element.animate) return;
    const frames = [{opacity:0}, {opacity:1}];
    // Only content may move. Sections can contain fixed chat UI on iPhone.
    if ((x || y) && !element.classList.contains('app-section')) {
      frames[0].transform = `translate(${x}px,${y}px)`;
      frames[1].transform = 'translate(0,0)';
    }
    const animation = element.animate(frames, {duration, easing:ease});
    running.set(element, animation);
    animation.finished.then(() => {
      if (running.get(element) === animation) running.delete(element);
    }, () => {});
  }
  function day(element, before, after) {
    if (element?.querySelector?.('.day-off-weather')) {enter(element, {y:10});return;}
    const order = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
    enter(element, {x: order.indexOf(after) >= order.indexOf(before) ? 14 : -14});
  }
  function closeDialog(dialog) {
    if (!dialog?.open || closing.has(dialog)) return;
    if (reduced() || !dialog.animate) {dialog.close(); return;}
    dialog.setAttribute('data-motion-closing', '');
    const animation = dialog.animate([{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.975)'}],
      {duration:180,easing:'ease-in',fill:'forwards'});
    closing.set(dialog, animation);
    const finish = () => {
      if (closing.get(dialog) !== animation) return;
      closing.delete(dialog); dialog.removeAttribute('data-motion-closing');
      if (dialog.open) dialog.close();
      animation.cancel();
    };
    animation.finished.then(finish, finish);
  }
  function release(details) {
    const previous = disclosures.get(details);
    if (!previous) return;
    disclosures.delete(details); previous.animation.cancel();
    details.style.overflow = previous.overflow;
    details.removeAttribute('data-motion-expanded');
  }
  function height(details, from, to, wanted) {
    if (reduced() || !details.animate || Math.abs(from - to) < 1) {details.removeAttribute('data-motion-expanded');details.open = wanted; return;}
    const overflow = details.style.overflow;
    details.style.overflow = 'hidden';
    details.setAttribute('data-motion-expanded', String(wanted));
    const animation = details.animate([{height:`${from}px`},{height:`${to}px`}], {duration:260,easing:ease});
    const entry = {animation,overflow,wanted}; disclosures.set(details, entry);
    const finish = () => {
      if (disclosures.get(details) !== entry) return;
      disclosures.delete(details); details.style.overflow = overflow;
      details.removeAttribute('data-motion-expanded');
      if (details.isConnected) details.open = wanted;
    };
    animation.finished.then(finish, finish);
  }
  function toggle(details) {
    const wanted = !(disclosures.get(details)?.wanted ?? details.open);
    const from = details.getBoundingClientRect().height;
    release(details);
    if (!wanted) {
      const summary = details.querySelector(':scope > summary');
      const style = getComputedStyle(details);
      const to = summary.getBoundingClientRect().height + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      height(details, from, to, false);
    } else {
      details.open = true;
      height(details, from, details.getBoundingClientRect().height, true);
    }
  }
  function replace(body, html) {
    const details = body.closest?.('details');
    const from = details?.getBoundingClientRect().height;
    const wanted = details && (disclosures.get(details)?.wanted ?? details.open);
    if (details) release(details);
    body.innerHTML = html;
    if (details?.open) {
      const to = wanted ? details.getBoundingClientRect().height : (() => {
        details.open = false; const size = details.getBoundingClientRect().height; details.open = true; return size;
      })();
      height(details, from, to, wanted);
    }
  }
  document.addEventListener('click', event => {
    const summary = event.target.closest?.('summary');
    const details = summary?.parentElement;
    if (!details?.matches('details.profile-gpa, details.profile-notifications, details.grade-card, details.transcript-period, details.profile-menu')
      || event.target.closest('a,button,input,select,textarea')) return;
    if (reduced() || !details.animate) return; // Keep native keyboard/click behaviour as fallback.
    event.preventDefault(); toggle(details);
  });
  document.addEventListener('cancel', event => {
    if (!event.target.matches?.('dialog.schedule-share-dialog, dialog.study-history-dialog, dialog.logout-dialog, dialog.wrapped-dialog')) return;
    event.preventDefault(); closeDialog(event.target);
  }, true);
  document.addEventListener('close', event => {
    const animation = closing.get(event.target);
    if (animation) {closing.delete(event.target);animation.cancel();event.target.removeAttribute('data-motion-closing');}
  }, true);
  window.unilinkMotion = {enter, cascade, day, closeDialog, replace};
})();
