(() => {
  'use strict';
  const cache = new Map(), opened = new Set();
  let epoch = 0;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paint = (body, html) => { if (window.unilinkMotion) window.unilinkMotion.replace(body, html); else body.innerHTML = html; };
  function groupLabel(name, index) {
    if (/(?:-Lab$|лаборатор)/i.test(name)) return 'Лабораторные';
    if (/(?:-SRSP$|срсп)/i.test(name)) return 'СРСП';
    if (/(?:-L$|лекци)/i.test(name)) return 'Лекции';
    if (/(?:-P$|практи)/i.test(name)) return 'Практика';
    return name || `Группа ${index+1}`;
  }
  function groupsHtml(groups) {
    if (!Array.isArray(groups)) throw new Error('invalid_details');
    if (!groups.length) return '<p class="grade-points-empty">Оценок за контрольные точки пока нет</p>';
    groups.forEach(group => {
      if (!group || !Array.isArray(group.marks)) throw new Error('invalid_group');
      group.marks.forEach(point => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(point.date) || typeof point.mark !== 'number'
          || !Number.isFinite(point.mark) || point.mark < 0 || point.mark > 100) throw new Error('invalid_point');
      });
    });
    return groups.map((group,index) => {
    const points = group.marks;
    const dates = points.map(point=>{
      const [year,month,day]=point.date.split('-');
      return `<th scope="col"><time datetime="${point.date}" aria-label="${day}.${month}.${year}" title="${day}.${month}.${year}">${day}.${month}<small>${year}</small></time></th>`;
    }).join('');
    const marks = points.map(point=>`<td><span class="grade-point-mark">${escape(point.mark.toLocaleString('ru-RU',{maximumFractionDigits:2}))}</span></td>`).join('');
    const table = points.length ? `<div class="grade-points-scroll" tabindex="0" role="region" aria-label="Все оценки раздела, прокрутка вбок"><table class="grade-points-table" style="--grade-column-count:${points.length}" aria-label="Даты и оценки"><thead><tr><th scope="col">Дата</th>${dates}</tr></thead><tbody><tr><th scope="row">Оценка</th>${marks}</tr></tbody></table></div>` : '<p class="grade-points-empty">Оценок за контрольные точки пока нет</p>';
    return `<section class="grade-points-group"><h3 title="${escape(group.name)}">${escape(groupLabel(group.name,index))}</h3>${group.tutor ? `<p class="grade-points-tutor" title="${escape(group.tutor)}">${escape(group.tutor)}</p>` : ''}${table}</section>`;
    }).join('');
  }
  function paintGroups(body, entry) {
    paint(body,groupsHtml(entry.groups));
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
    if (entry.groups) paintGroups(body,entry);
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
      if (revision === epoch && body.isConnected) paintGroups(body,entry);
    } catch {
      if (revision !== epoch || !body.isConnected) return;
      paint(body, (entry.groups ? groupsHtml(entry.groups) : '') + '<div class="grade-points-error" role="status"><p>Не удалось загрузить контрольные точки.</p><button type="button" class="grade-points-retry">Попробовать снова</button></div>');
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
