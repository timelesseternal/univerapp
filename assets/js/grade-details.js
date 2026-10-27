(() => {
  'use strict';
  const cache = new Map(), opened = new Set();
  let epoch = 0;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function groupsHtml(groups) {
    if (!Array.isArray(groups)) throw new Error('invalid_details');
    if (!groups.length) return '<p class="grade-points-empty">Оценок за контрольные точки пока нет</p>';
    return groups.map(group => {
      if (!group || !Array.isArray(group.marks)) throw new Error('invalid_group');
      const rows = group.marks.map(point => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(point.date) || typeof point.mark !== 'number'
          || !Number.isFinite(point.mark) || point.mark < 0 || point.mark > 100) throw new Error('invalid_point');
        const [year, month, day] = point.date.split('-');
        const mark = point.mark.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
        return `<li class="grade-point"><time datetime="${point.date}">${day}.${month}.${year}</time><span class="grade-point-mark">${escape(mark)}</span></li>`;
      }).join('');
      return `<section class="grade-points-group"><h3>${escape(group.name)}</h3>${group.tutor ? `<p class="grade-points-tutor">${escape(group.tutor)}</p>` : ''}${rows ? `<ol class="grade-points-list" aria-label="Даты и оценки">${rows}</ol>` : '<p class="grade-points-empty">Оценок за контрольные точки пока нет</p>'}</section>`;
    }).join('');
  }
  async function load(details, context) {
    const body = details.querySelector('.grade-details-body');
    const subject = context.subjects[Number(details.dataset.gradeIndex)];
    const subjectID = Number(subject?.subjectID);
    const queryID = Number(subject?.queryID);
    const querySuffix = Number.isSafeInteger(queryID) && queryID > 0 ? `&queryID=${queryID}` : '';
    if (!Number.isSafeInteger(subjectID) || subjectID < 1 || !context.year || context.term == null) {
      body.innerHTML = '<p class="grade-points-empty">Подробные оценки пока недоступны. Обнови список дисциплин.</p>';
      return;
    }
    const key = `${context.generation}:${context.studentID}:${context.year}:${context.term}:${subjectID}${querySuffix}`;
    if (!details.open) { opened.delete(key); return; }
    opened.add(key);
    const revision = epoch;
    let entry = cache.get(key);
    if (!entry) { entry = {}; cache.set(key, entry); }
    if (entry.html) body.innerHTML = entry.html;
    else body.innerHTML = window.unilinkLoading.html('Контрольные точки загружаются');
    if (!entry.work && (!entry.at || Date.now() - entry.at >= 60000)) {
      entry.work = context.fetch(`/api/grade-details?year=${context.year}&term=${context.term}&subjectID=${subjectID}${querySuffix}`)
        .then(data => {
          const html = groupsHtml(data?.groups);
          if (revision !== epoch) return;
          entry.html = html; entry.at = Date.now();
        }).finally(() => { entry.work = null; });
    }
    try {
      if (entry.work) await entry.work;
      if (revision === epoch && body.isConnected) body.innerHTML = entry.html;
    } catch {
      if (revision !== epoch || !body.isConnected) return;
      body.innerHTML = (entry.html || '') + '<div class="grade-points-error" role="status"><p>Не удалось загрузить контрольные точки.</p><button type="button" class="grade-points-retry">Попробовать снова</button></div>';
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
