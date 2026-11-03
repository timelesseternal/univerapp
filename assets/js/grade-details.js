(() => {
  'use strict';
  const cache = new Map(), opened = new Set();
  const pageSize = 4;
  let epoch = 0;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paint = (body, html) => { if (window.unilinkMotion) window.unilinkMotion.replace(body, html); else body.innerHTML = html; };
  function groupLabel(name, index) {
    if (/(?:-Lab$|лаборатор)/i.test(name)) return 'Лаб.';
    if (/(?:-SRSP$|срсп)/i.test(name)) return 'СРСП';
    if (/(?:-L$|лекци)/i.test(name)) return 'Лекции';
    if (/(?:-P$|практи)/i.test(name)) return 'Практика';
    return name || `Группа ${index+1}`;
  }
  function groupsHtml(groups, view = {}) {
    if (!Array.isArray(groups)) throw new Error('invalid_details');
    if (!groups.length) return '<p class="grade-points-empty">Оценок за контрольные точки пока нет</p>';
    groups.forEach(group => {
      if (!group || !Array.isArray(group.marks)) throw new Error('invalid_group');
      group.marks.forEach(point => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(point.date) || typeof point.mark !== 'number'
          || !Number.isFinite(point.mark) || point.mark < 0 || point.mark > 100) throw new Error('invalid_point');
      });
    });
    const selected = Number.isInteger(view.selected) && groups[view.selected] ? view.selected : Math.max(0,groups.findIndex(group=>group.marks.length));
    const group = groups[selected];
    const pageCount = Math.max(1,Math.ceil(group.marks.length/pageSize));
    const page = Math.max(0,Math.min(pageCount-1,view.pages?.[selected] || 0));
    const points = group.marks.slice(page*pageSize,(page+1)*pageSize);
    const tabs = groups.length>1 ? `<nav class="grade-point-tabs" aria-label="Вид занятия">${groups.map((item,index)=>`<button type="button" data-grade-group="${index}" aria-pressed="${index===selected}">${escape(groupLabel(item.name,index))}<span>${item.marks.length}</span></button>`).join('')}</nav>` : '';
    const dates = points.map(point=>{
      const [year,month,day]=point.date.split('-');
      return `<th scope="col"><time datetime="${point.date}" aria-label="${day}.${month}.${year}" title="${day}.${month}.${year}">${day}.${month}<small>${year}</small></time></th>`;
    }).join('');
    const marks = points.map(point=>`<td><span class="grade-point-mark">${escape(point.mark.toLocaleString('ru-RU',{maximumFractionDigits:2}))}</span></td>`).join('');
    const table = points.length ? `<table class="grade-points-table" aria-label="Даты и оценки"><thead><tr><th scope="col">Дата</th>${dates}</tr></thead><tbody><tr><th scope="row">Оценка</th>${marks}</tr></tbody></table>` : '<p class="grade-points-empty">Оценок за контрольные точки пока нет</p>';
    const pager = pageCount>1 ? `<div class="grade-points-pages"><button type="button" data-grade-page="${page-1}" aria-label="Предыдущие оценки" ${page===0?'disabled':''}>‹</button><span aria-live="polite">${page*pageSize+1}–${Math.min((page+1)*pageSize,group.marks.length)} из ${group.marks.length}</span><button type="button" data-grade-page="${page+1}" aria-label="Следующие оценки" ${page===pageCount-1?'disabled':''}>›</button></div>` : '';
    return `${tabs}<section class="grade-points-group"><h3>${escape(group.name)}</h3>${group.tutor ? `<p class="grade-points-tutor" title="${escape(group.tutor)}">${escape(group.tutor)}</p>` : ''}${table}${pager}</section>`;
  }
  function paintGroups(body, entry, revision, details) {
    const view=entry.view ||= {selected:Math.max(0,entry.groups.findIndex(group=>group.marks.length)),pages:{}};
    paint(body,groupsHtml(entry.groups,view));
    body.onclick=event=>{
      const button=event.target.closest?.('button[data-grade-group],button[data-grade-page]');
      if (!button || !body.contains(button) || button.disabled || revision!==epoch || !details.open) return;
      const group=button.getAttribute('data-grade-group'), page=button.getAttribute('data-grade-page');
      if (group!==null) view.selected=Number(group);
      else view.pages[view.selected]=Number(page);
      paintGroups(body,entry,revision,details);
      const selector=group!==null ? `button[data-grade-group="${view.selected}"]` : `button[aria-label="${button.getAttribute('aria-label')}"]`;
      body.querySelector(selector)?.focus?.({preventScroll:true});
    };
  }
  async function load(details, context) {
    const body = details.querySelector('.grade-details-body');
    const subject = context.subjects[Number(details.dataset.gradeIndex)];
    const subjectID = Number(subject?.subjectID);
    const queryID = Number(subject?.queryID);
    const querySuffix = Number.isSafeInteger(queryID) && queryID > 0 ? `&queryID=${queryID}` : '';
    if (!Number.isSafeInteger(subjectID) || subjectID < 1 || !context.year || context.term == null) {
      paint(body, '<p class="grade-points-empty">Подробные оценки пока недоступны. Обнови список дисциплин.</p>');
      return;
    }
    const key = `${context.generation}:${context.studentID}:${context.year}:${context.term}:${subjectID}${querySuffix}`;
    if (!details.open) { opened.delete(key); return; }
    opened.add(key);
    const revision = epoch;
    let entry = cache.get(key);
    if (!entry) { entry = {}; cache.set(key, entry); }
    if (entry.groups) paintGroups(body,entry,revision,details);
    else paint(body, window.unilinkLoading.html('Контрольные точки загружаются'));
    if (!entry.work && (!entry.at || Date.now() - entry.at >= 60000)) {
      entry.work = context.fetch(`/api/grade-details?year=${context.year}&term=${context.term}&subjectID=${subjectID}${querySuffix}`)
        .then(data => {
          const html = groupsHtml(data?.groups);
          if (revision !== epoch) return;
          entry.html = html; entry.at = Date.now();
          entry.groups = data.groups;
        }).finally(() => { entry.work = null; });
    }
    try {
      if (entry.work) await entry.work;
      if (revision === epoch && body.isConnected) paintGroups(body,entry,revision,details);
    } catch {
      if (revision !== epoch || !body.isConnected) return;
      paint(body, (entry.groups ? groupsHtml(entry.groups,entry.view) : '') + '<div class="grade-points-error" role="status"><p>Не удалось загрузить контрольные точки.</p><button type="button" class="grade-points-retry">Попробовать снова</button></div>');
      body.querySelector('.grade-points-retry').addEventListener('click', () => load(details, context));
    }
  }
  window.unilinkGradeDetails = {
    groupsHtml,
    attach(root, context) {
      const revision = epoch;
      if (root.gradeDetailsToggle) root.removeEventListener('toggle', root.gradeDetailsToggle, true);
      root.gradeDetailsToggle = event => {
        if (revision === epoch && event.target.matches?.('details[data-grade-index]')) load(event.target, context);
      };
      root.addEventListener('toggle', root.gradeDetailsToggle, true);
      root.querySelectorAll('details[data-grade-index]').forEach(details => {
        const subject = context.subjects[Number(details.dataset.gradeIndex)];
        const id = Number(subject?.subjectID), queryID = Number(subject?.queryID);
        const querySuffix = Number.isSafeInteger(queryID) && queryID > 0 ? `&queryID=${queryID}` : '';
        const key = `${context.generation}:${context.studentID}:${context.year}:${context.term}:${id}${querySuffix}`;
        if (opened.has(key)) { details.open = true; load(details, context); }
      });
    },
    reset() { epoch++; cache.clear(); opened.clear(); },
  };
})();
