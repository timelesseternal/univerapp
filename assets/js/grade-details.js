(() => {
  'use strict';
  const cache = new Map(), opened = new Set();
  const views = new WeakMap();
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
        const absent = point.mark === null && point.status === 'absent';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(point.date) || !absent && (typeof point.mark !== 'number'
          || !Number.isFinite(point.mark) || point.mark < 0 || point.mark > 100)) throw new Error('invalid_point');
      });
    });
    return groups.map((group,index) => {
    const points = group.marks;
    const dates = points.map(point=>{
      const [year,month,day]=point.date.split('-');
      return `<th scope="col"><time datetime="${point.date}" aria-label="${day}.${month}.${year}" title="${day}.${month}.${year}">${day}.${month}<small>${year}</small></time></th>`;
    }).join('');
    const marks = points.map(point => point.status === 'absent' && point.mark === null
      ? '<td><span class="grade-point-mark grade-point-absence" aria-label="Отсутствие на занятии">н</span></td>'
      : `<td><span class="grade-point-mark">${escape(point.mark.toLocaleString('ru-RU',{maximumFractionDigits:2}))}</span></td>`).join('');
    const table = points.length ? `<div class="grade-points-scroll" tabindex="0" role="region" aria-label="Все оценки раздела, прокрутка вбок"><table class="grade-points-table" style="--grade-column-count:${points.length}" aria-label="Даты и оценки"><thead><tr><th scope="col">Дата</th>${dates}</tr></thead><tbody><tr><th scope="row">Оценка</th>${marks}</tr></tbody></table></div>` : '<p class="grade-points-empty">Оценок за контрольные точки пока нет</p>';
    return `<section class="grade-points-group"><h3 title="${escape(group.name)}">${escape(groupLabel(group.name,index))}</h3>${group.tutor ? `<p class="grade-points-tutor" title="${escape(group.tutor)}">${escape(group.tutor)}</p>` : ''}${table}</section>`;
    }).join('');
  }
  const dateLabel = value => value.split('-').reverse().join('.');
  const rangeLabel = period => `${dateLabel(period.start)} — ${dateLabel(period.end)}`;
  const inside = (point, period) => point.date >= period.start && point.date <= period.end;
  const filterGroups = (groups, predicate) => groups.map(group => ({ ...group, marks: group.marks.filter(predicate) }));
  const formatMark = value => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  function trendData(groups) {
    const days = new Map(); let total = 0, count = 0;
    for (const group of groups) for (const point of group.marks) {
      const stamp = Date.parse(point.date + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(point.date) || !Number.isFinite(stamp)
        || new Date(stamp).toISOString().slice(0,10) !== point.date) throw new Error('invalid_point');
      if (point.mark === null && point.status === 'absent') continue;
      if (typeof point.mark !== 'number' || !Number.isFinite(point.mark) || point.mark < 0 || point.mark > 100) throw new Error('invalid_point');
      const day = days.get(point.date) || { date: point.date, stamp, sum: 0, count: 0 };
      day.sum += point.mark; day.count++; days.set(point.date, day);
      total += point.mark; count++;
    }
    const points = [...days.values()].sort((a,b) => a.stamp-b.stamp).map(day => ({ ...day, mean: day.sum/day.count }));
    return { points, count, mean: count ? total/count : null,
      change: points.length > 1 ? points.at(-1).mean-points[0].mean : null };
  }
  function trendHtml(groups) {
    const data = trendData(groups);
    const heading = '<h3 class="grade-trend-title">Динамика оценок</h3>';
    if (!data.count) return `<section class="grade-trend">${heading}<p class="grade-period-note">За семестр пока нет оценок для графика.</p></section>`;
    const points = data.points, first = points[0], last = points.at(-1);
    const x = point => points.length === 1 ? 168 : 32 + (point.stamp-first.stamp)/(last.stamp-first.stamp)*272;
    const y = point => 112-point.mean*.92;
    const xy = point => `${x(point).toFixed(2)},${y(point).toFixed(2)}`;
    const changeValue = data.change === null ? null : Math.round(data.change*100)/100;
    const change = changeValue === null ? 'Для сравнения нужна ещё одна дата.'
      : `Последняя дата к первой: ${changeValue > 0 ? '+' : changeValue < 0 ? '−' : ''}${formatMark(Math.abs(changeValue))} б.`;
    const chartLabel = `Средние оценки по датам, шкала от 0 до 100. С ${dateLabel(first.date)} по ${dateLabel(last.date)}.`;
    const grid = [0,50,100].map(mark => `<line x1="32" x2="304" y1="${112-mark*.92}" y2="${112-mark*.92}"/><text x="24" y="${116-mark*.92}" text-anchor="end">${mark}</text>`).join('');
    const line = points.length > 1 ? `<polyline class="grade-trend-line" points="${points.map(xy).join(' ')}"/>` : '';
    const dots = points.map(point => {
      const label = `${dateLabel(point.date)}: среднее ${formatMark(point.mean)}, оценок ${point.count}`;
      return `<circle class="grade-trend-dot" cx="${x(point).toFixed(2)}" cy="${y(point).toFixed(2)}" r="3"><title>${escape(label)}</title></circle>`;
    }).join('');
    const labels = points.length === 1 ? `<text x="168" y="140" text-anchor="middle">${dateLabel(first.date)}</text>`
      : `<text x="32" y="140">${dateLabel(first.date)}</text><text x="304" y="140" text-anchor="end">${dateLabel(last.date)}</text>`;
    return `<section class="grade-trend">${heading}<p class="grade-period-note">За весь семестр · среднее за день · шкала 0–100</p><div class="grade-trend-stats"><div><span>Средняя оценка</span><strong>${formatMark(data.mean)}</strong></div><div><span>Всего оценок</span><strong>${data.count}</strong></div></div><svg class="grade-trend-chart" viewBox="0 0 320 150" role="img" aria-label="${escape(chartLabel)}"><g class="grade-trend-grid" aria-hidden="true">${grid}${labels}</g>${line}${dots}</svg><p class="grade-period-note">${change} Простое среднее без весов; итог РК смотри в карточке предмета.</p></section>`;
  }
  function periodsHtml(entry) {
    const ready = !!entry.periods, selected = ready || entry.selected === 'trend' ? entry.selected : 'all';
    const absenceNote = entry.groups.some(group => group.marks.some(point => point.mark === null && point.status === 'absent'))
      ? '<p class="grade-period-note">«н» — отсутствие на занятии. В количество оценок, среднее и график эта отметка не входит.</p>' : '';
    const count = predicate => entry.groups.reduce((total, group) => total + group.marks.filter(point => typeof point.mark === 'number' && predicate(point)).length, 0);
    const tabs = `<div class="grade-period-tabs" role="group" aria-label="Контрольные точки и динамика">${[['rk1','РК 1'],['rk2','РК 2'],['all','Все'],['trend','Динамика']].map(([id,label]) => {
      const period = entry.periods?.find(item => item.id === id);
      const amount = ready && id !== 'trend' ? count(point => id === 'all' || inside(point, period)) : null;
      return `<button type="button" data-grade-period="${id}" aria-pressed="${selected === id}" ${['rk1','rk2'].includes(id) && !ready ? 'disabled' : ''}>${label}${amount == null ? '' : `<span>${amount}</span>`}</button>`;
    }).join('')}</div>`;
    if (selected === 'trend') return tabs + absenceNote + trendHtml(entry.groups);
    if (!ready) return tabs + absenceNote + `<p class="grade-period-note" role="status">${entry.calendarPending ? 'Определяем периоды по академическому календарю. Пока показаны все оценки.' : 'Не удалось определить границы РК для этого семестра. Показаны все оценки.'}</p>`
      + (!entry.calendarPending && entry.retryCalendar ? '<button type="button" class="grade-calendar-retry">Повторить загрузку календаря</button>' : '') + groupsHtml(entry.groups);
    const outside = point => !entry.periods.some(period => inside(point, period));
    const extra = entry.groups.reduce((total,group) => total + group.marks.filter(outside).length, 0);
    const section = period => `<section class="grade-period-section"><h3 class="grade-period-title">Оценки за период ${period.id === 'rk1' ? 'РК 1' : 'РК 2'}</h3><p class="grade-period-note">${rangeLabel(period)}</p>${groupsHtml(filterGroups(entry.groups, point => inside(point, period)))}</section>`;
    const content = selected === 'all'
      ? entry.periods.map(section).join('') + (extra ? `<section class="grade-period-section"><h3 class="grade-period-title">Вне периодов РК</h3><p class="grade-period-note">Даты этих оценок не входят в периоды календаря.</p>${groupsHtml(filterGroups(entry.groups, outside))}</section>` : '')
      : section(entry.periods.find(period => period.id === selected)) + (extra ? `<p class="grade-period-note">Ещё ${extra} записей вне границ периодов — в разделе «Все».</p>` : '');
    return tabs + absenceNote + '<p class="grade-period-note">Разделено по датам академического календаря.</p>' + content;
  }
  function paintGroups(body, entry) {
    paint(body, periodsHtml(entry));
    body.querySelectorAll?.('[data-grade-period]').forEach(button => button.addEventListener('click', () => {
      entry.selected = button.dataset.gradePeriod;
      entry.userSelected = true;
      paintGroups(body, entry);
      body.querySelector(`[data-grade-period="${entry.selected}"]`)?.focus();
    }));
    body.querySelector('.grade-calendar-retry')?.addEventListener('click', entry.retryCalendar);
  }
  function failureHint(error) {
    const message = String(error?.message || '');
    if (message === 'offline') return 'Нет подключения к интернету.';
    if (/GD_TIMEOUT|TimeoutError|AbortError/.test(message) || ['TimeoutError','AbortError'].includes(error?.name)) return 'Platonus отвечает слишком долго (GD_TIMEOUT).';
    const diagnostic = message.match(/\bGD_FORMAT(?:_[A-Z0-9]+)*\b/)?.[0];
    if (diagnostic) return `Platonus вернул неподдерживаемый формат оценок (${diagnostic}). Передай этот код для проверки.`;
    if (['invalid_details','invalid_group','invalid_point'].includes(message)) return 'Приложение не смогло прочитать данные (GD_FORMAT_UI). Обнови приложение через профиль.';
    if (/GD_PROFILE/.test(message)) return 'Не удалось проверить учебный профиль (GD_PROFILE).';
    if (/GD_UPSTREAM/.test(message)) return 'Platonus временно не отдаёт данные предмета (GD_UPSTREAM).';
    if (/platonus_auth_unavailable/.test(message)) return 'Platonus не подтвердил доступ к предмету. Попробуй обновить список оценок.';
    return '';
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
    views.set(body, key);
    const visible = () => revision === epoch && body.isConnected && details.open && views.get(body) === key;
    let entry = cache.get(key);
    if (!entry) { entry = {}; cache.set(key, entry); }
    function loadCalendar(force = false) {
      if (entry.calendarPending || typeof context.calendar !== 'function') return;
      entry.calendarPending = true;
      if (entry.groups && visible()) paintGroups(body, entry);
      entry.calendarWork = Promise.resolve().then(() => context.calendar(force)).then(data => {
        if (revision !== epoch) return;
        const matches = Number(data?.studentID) === Number(context.studentID)
          ? data.gradingPeriods?.filter(item => Number(item.studyYear) === Number(context.year) && Number(item.term) === Number(context.term)) : [];
        const periods = matches?.length === 1 ? matches[0].periods : null;
        const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
          && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;
        if (!Array.isArray(periods) || periods.length !== 2 || periods.some((period,index) =>
          period.id !== (index ? 'rk2' : 'rk1') || !validDate(period.start) || !validDate(period.end) || period.start > period.end)
          || periods[0].end >= periods[1].start) throw new Error('calendar_periods_unavailable');
        entry.periods = periods;
        if (!entry.userSelected) {
          const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
          entry.selected = today >= periods[1].start ? 'rk2' : 'rk1';
        }
      }).catch(() => { /* Grades remain available when the calendar cannot be resolved. */ })
        .finally(() => { entry.calendarPending = false; });
      entry.calendarWork.then(() => { if (entry.groups && visible()) paintGroups(body, entry); });
    }
    entry.retryCalendar = typeof context.calendar === 'function' ? () => loadCalendar(true) : null;
    if (!entry.calendarWork) loadCalendar();
    // A rerender can replace the body while the shared calendar request is pending.
    else if (entry.calendarPending) entry.calendarWork.then(() => { if (entry.groups && visible()) paintGroups(body, entry); });
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
      if (visible()) paintGroups(body,entry);
    } catch (error) {
      if (!visible()) return;
      paint(body, (entry.groups ? groupsHtml(entry.groups) : '') + `<div class="grade-points-error" role="status"><p>Не удалось загрузить контрольные точки. ${failureHint(error)}</p><button type="button" class="grade-points-retry">Попробовать снова</button></div>`);
      body.querySelector('.grade-points-retry').addEventListener('click', () => load(details, context));
    }
  }
  window.unilinkGradeDetails = {
    groupsHtml,
    trendData,
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
