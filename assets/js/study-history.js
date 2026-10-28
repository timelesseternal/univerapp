/* Device-local academic history. No credentials, background push, or API caching. */
(() => {
  'use strict';
  let key = null, state = {}, offline = false;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp = time => time ? new Date(time).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : 'дата неизвестна';
  function bind(student, scope) {
    const id = Number(student?.studentID);
    const next = Number.isSafeInteger(id) && id > 0 ? `${scope}:study-v1:${id}` : null;
    if (key === next) return;
    key = next; state = {};
    try { const saved = JSON.parse(localStorage.getItem(key)); if (saved?.schema === 1) state = saved; } catch {}
    state.schema = 1;
    state.baselines ||= {}; state.events ||= []; state.seen ||= 0;
    if (!Array.isArray(state.events) || state.events.some(event => !event || typeof event !== 'object') || !state.baselines || typeof state.baselines !== 'object') state = {schema:1,baselines:{},events:[],seen:0};
    render();
  }
  function persist() {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* Full/restricted storage must not break the live app. */ }
    render();
  }
  function record(kind, period, values) {
    if (!key || offline) return;
    const name = `${kind}:${period}`, previous = state.baselines[name];
    const time = Math.max(Date.now(), Number(state.seen || 0) + 1, Number(state.events[0]?.time || 0) + 1);
    if (previous) {
      for (const item of new Set([...Object.keys(previous), ...Object.keys(values)])) {
        const before = previous[item], after = values[item];
        if (before === after) continue;
        state.events.unshift({kind,period,title:item,before:before ?? 'Не было',after:after ?? 'Убрано',time});
      }
    }
    state.events = state.events.slice(0, 80);
    state.baselines[name] = values;
    // Bound storage while retaining several visited weeks/semesters.
    const keys = Object.keys(state.baselines);
    for (const old of keys.slice(0, Math.max(0, keys.length - 20))) delete state.baselines[old];
    persist();
  }
  function grades(period, journal) {
    if (!Array.isArray(journal) || !journal.length) return;
    const values = {};
    for (const subject of journal) {
      for (const metric of Array.isArray(subject.exams) ? subject.exams : []) {
        if (metric?.name && metric.mark != null) values[`${subject.subjectName} · ${metric.name}`] = String(metric.mark);
      }
    }
    record('grades', period, values);
  }
  function schedule(entry) {
    if (!entry?.weekInfo || !entry.schedule || !entry.lessonTimes) return;
    const values = {};
    for (const day of Object.keys(entry.schedule).sort()) {
      const slots = {};
      for (const lesson of entry.schedule[day]) {
        const time = entry.lessonTimes[lesson.пара];
        (slots[lesson.пара] ||= []).push([lesson.sub, time ? `${time.start}–${time.end}` : '', lesson.teacher,
          lesson.building, lesson.room].filter(Boolean).join(' · '));
      }
      for (const slot of Object.keys(slots)) values[`${day} · пара ${slot}`] = slots[slot].sort().join('\n');
    }
    const w = entry.weekInfo;
    record('schedule', `${w.studyYear}/${w.term} · неделя ${w.week}`, values);
  }
  function save(data) {
    if (!key || offline || Number(data?.student?.studentID) <= 0) return;
    // Successful empty lists replace cancelled exams. Missing data does not.
    if (data.scheduleEntry) state.scheduleEntry = data.scheduleEntry;
    if (Array.isArray(data.exams)) { state.exams = data.exams; state.examsAt = data.examsAt; }
    persist();
  }
  function read() {
    const entry = state.scheduleEntry;
    if (entry && (!entry.weekInfo || !Number.isFinite(Number(entry.weekInfo.week)) || !entry.schedule || !entry.lessonTimes ||
      Object.values(entry.lessonTimes).some(slot => !slot || typeof slot.start !== 'string' || typeof slot.end !== 'string') ||
      Object.values(entry.schedule).some(day => !Array.isArray(day) || day.some(item => !item || typeof item.sub !== 'string')))) return null;
    if (state.exams != null && (!Array.isArray(state.exams) || state.exams.some(exam => !exam || typeof exam.subject !== 'string'))) return null;
    return entry || Array.isArray(state.exams) ? {scheduleEntry:entry,exams:state.exams,examsAt:state.examsAt} : null;
  }
  function render() {
    const strip = document.getElementById('studyStatus');
    const count = (state.events || []).filter(event => event.time > state.seen).length;
    if (strip) {
      strip.hidden = !key || (!offline && !count);
      strip.innerHTML = `${offline ? '<span>Без интернета · сохранённые данные</span>' : ''}${count ? `<button type="button" data-study-history>Изменения <b>${count}</b></button>` : ''}`;
    }
    document.querySelectorAll('[data-study-history-count]').forEach(el => { el.textContent = count ? `Новых: ${count}` : 'Оценки и расписание'; });
    for (const section of ['schedule','exams']) {
      let note = document.getElementById(`${section}SavedNote`);
      const target = document.getElementById(section === 'schedule' ? 'scheduleContainer' : 'examsContainer');
      if (!note && target) {
        note = document.createElement('p'); note.id = `${section}SavedNote`; note.className = 'study-saved-note'; target.before(note);
      }
      if (note) { note.hidden = !offline; note.textContent = `Сохранено: ${stamp(section === 'schedule' ? state.scheduleEntry?.cachedAt : state.examsAt)}. Изменения появятся после подключения.`; }
    }
    document.getElementById('section-chat')?.toggleAttribute('disabled', offline);
    document.querySelectorAll('[data-action="switchSection(\'calendar\')"], [data-action="switchSection(\'transcript\')"], [data-action="switchSection(\'umkd\')"]').forEach(button => button.disabled = offline);
  }
  function open() {
    if (!key) return;
    let dialog = document.getElementById('studyHistoryDialog');
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id = 'studyHistoryDialog'; dialog.className = 'study-history-dialog';
      dialog.setAttribute('aria-label', 'Изменения оценок и расписания');
      document.body.append(dialog);
    }
    const events = state.events || [];
    dialog.innerHTML = `<header><h2>Что изменилось</h2><button type="button" id="studyHistoryClose" aria-label="Закрыть">✕</button></header><p class="study-history-hint">Последние 80 изменений на этом устройстве. Дата — время обнаружения, а не выставления оценки.</p>${events.length ? events.map(event => `<article class="study-change"><div class="study-change-meta">${event.kind === 'grades' ? 'Оценки' : 'Расписание'} · ${escape(event.period)} · ${stamp(event.time)}</div><h3>${escape(event.title)}</h3><p class="study-change-before">Было: ${escape(event.before)}</p><p>Стало: ${escape(event.after)}</p></article>`).join('') : '<p>Изменений пока нет. Сравним данные при следующем обновлении.</p>'}`;
    document.getElementById('studyHistoryClose').addEventListener('click', () => dialog.close());
    dialog.showModal(); state.seen = Math.max(Date.now(), Number(events[0]?.time || 0)); persist();
  }
  document.addEventListener('click', event => { if (event.target.closest?.('[data-study-history]')) open(); });
  window.unilinkStudy = {bind,grades,schedule,save,read,render,
    offline(value) {offline = value; render();},
    reset(forget = false) {if (forget && key) {try {localStorage.removeItem(key);} catch {}} key = null; state = {}; offline = false; document.getElementById('studyHistoryDialog')?.close(); render();}};
})();
