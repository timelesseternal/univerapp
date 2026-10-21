(() => {
  'use strict';
  const cache = new Map(), pending = new Map();
  const painted = new WeakMap();
  const ttl = 5 * 60 * 1000;
  let epoch = 0, active = null, account = null;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const number = value => value == null ? '—' : escape(Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 }));
  const names = { calendar: 'Академический календарь', transcript: 'Транскрипт' };
  const container = kind => document.getElementById(`${kind}Container`);
  function calendar(data) {
    return `<header class="academic-heading"><span class="academic-kicker">УЧЕБНЫЙ ГОД ${escape(data.year)}</span><h1>Академический календарь</h1></header>` +
      data.semesters.map(semester => `<article class="academic-card"><h2>${escape(semester.name)}</h2>${semester.groups.map(group => `<section class="calendar-group"><h3>${escape(group.name)}</h3><dl>${group.rows.map(row => `<div class="calendar-row"><dt>${escape(row.label)}</dt><dd>${escape(row.value)}</dd></div>`).join('')}</dl></section>`).join('')}</article>`).join('');
  }
  function transcript(data, options) {
    const currentIndex = data.periods.findIndex(period => Number(period.course) === Number(options?.currentPeriod?.course)
      && Number(period.term) === Number(options?.currentPeriod?.term));
    return `<header class="academic-heading"><span class="academic-kicker">ТВОЁ ОБУЧЕНИЕ</span><h1>Транскрипт</h1></header><div class="transcript-stats"><div><span>Общий GPA</span><strong>${number(data.gpa)}</strong></div><div><span>Кредитов освоено</span><strong>${number(data.assimilatedCredits)}</strong></div></div>` +
      (data.periods.length ? data.periods.map((period, index) => `<details class="academic-card transcript-period" ${index === currentIndex ? 'open' : ''}><summary><span>${escape(period.course)} курс · ${period.term > 0 ? `${escape(period.term)} семестр` : 'Дополнительный период'}</span><span class="period-gpa">GPA ${number(period.gpa)}<svg aria-hidden="true" class="action-icon academic-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span></summary><div class="transcript-rows">${period.rows.map(row => `<article class="transcript-row"><div class="transcript-subject"><h3>${escape(row.subject)}</h3><p>${[row.code, row.category === 'Дисциплины' ? '' : row.category, row.credits == null ? '' : `${number(row.credits)} кр.`].filter(Boolean).map(escape).join(' · ')}</p></div><div class="transcript-mark"><strong>${escape(row.letter || '—')}</strong><span>${row.percent == null ? 'Нет оценки' : `${number(row.percent)}% · ${number(row.points)}`}</span></div>${row.retakes || row.repeats ? `<p class="transcript-retakes">${row.retakes ? `Пересдач: ${number(row.retakes)}` : ''}${row.retakes && row.repeats ? ' · ' : ''}${row.repeats ? `Повторных прохождений: ${number(row.repeats)}` : ''}</p>` : ''}</article>`).join('')}</div><p class="course-gpa">GPA за ${escape(period.course)} курс: ${number(period.courseGpa)}</p></details>`).join('') : '<div class="academic-card">В транскрипте пока нет дисциплин.</div>');
  }
  function paint(kind, data, options) {
    const el = container(kind);
    if (!el) return;
    if (painted.get(el) === data) {
      const message = el.querySelector('.academic-feedback');
      if (message) message.innerHTML = '';
      return;
    }
    // Preserve expanded periods when the background refresh returns.
    const opened = [...el.querySelectorAll('details')].map((d, i) => d.open ? i : -1);
    const hadDetails = !!el.querySelector('details');
    el.innerHTML = (kind === 'calendar' ? calendar(data) : transcript(data, options)) + '<div class="academic-feedback" role="status"></div>';
    painted.set(el, data);
    if (hadDetails) [...el.querySelectorAll('details')].forEach((d, i) => { d.open = opened.includes(i); });
  }
  function feedback(kind, options, cached) {
    const el = container(kind);
    if (!el) return;
    if (!cached) el.innerHTML = `<header class="academic-heading"><h1>${names[kind]}</h1></header><div class="academic-feedback academic-card" role="status"></div>`;
    const target = el.querySelector('.academic-feedback');
    if (!target) return;
    target.innerHTML = `<span>${cached ? 'Показаны ранее загруженные данные. ' : ''}Не удалось загрузить ${kind === 'calendar' ? 'календарь' : 'транскрипт'}.</span><button type="button">Попробовать ещё</button>`;
    target.querySelector('button').addEventListener('click', () => open(kind, options, true));
  }
  function load(kind, options, force = false) {
    const id = Number(options?.student?.studentID);
    if (!names[kind] || !Number.isSafeInteger(id) || id <= 0 || typeof options?.fetch !== 'function') return Promise.reject(new Error('invalid_account'));
    const key = `${id}:${kind}`, version = epoch;
    const saved = cache.get(key);
    if (!force && saved && Date.now() - saved.time < ttl) return Promise.resolve(saved.data);
    if (!pending.has(key)) {
      const request = (async () => {
        const data = await options.fetch(`/api/${kind}`);
        if (Number(data.studentID) !== id || (kind === 'calendar' ? !Array.isArray(data.semesters) : !Array.isArray(data.periods))) throw new Error('invalid_document');
        if (epoch === version) cache.set(key, { data, time: Date.now() });
        return data;
      })();
      pending.set(key, request);
      request.finally(() => { if (pending.get(key) === request) pending.delete(key); }).catch(() => {});
    }
    return pending.get(key);
  }
  async function open(kind, options, force = false) {
    if (!names[kind]) return;
    const id = Number(options?.student?.studentID), el = container(kind);
    if (!el || !Number.isSafeInteger(id) || id <= 0 || typeof options?.fetch !== 'function') return;
    active = kind; account = id;
    const key = `${id}:${kind}`, version = epoch;
    const visible = () => epoch === version && account === id && active === kind;
    const saved = cache.get(key);
    if (saved) paint(kind, saved.data, options);
    else el.innerHTML = `<header class="academic-heading"><h1>${names[kind]}</h1></header>` + window.unilinkLoading.html(names[kind]);
    el.dataset.academicKey = key;
    try { const data = await load(kind, options, force); if (visible()) paint(kind, data, options); }
    catch { if (visible()) feedback(kind, options, !!saved); }
  }
  // Warm data only: never activate a screen, paint hidden content or show errors.
  const prefetch = options => Promise.allSettled(Object.keys(names).map(kind => load(kind, options)));
  window.univerAcademic = { open, prefetch, onSection: section => { active = names[section] ? section : null; }, reset: () => {
    epoch++; active = null; account = null; cache.clear(); pending.clear();
    for (const kind of Object.keys(names)) { const el = container(kind); if (el) { el.innerHTML = ''; painted.delete(el); delete el.dataset.academicKey; } }
  } };
})();
