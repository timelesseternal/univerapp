/* Recaps contain observed Platonus snapshots, never attendance or inferred weeks. */
(() => {
  const memory = new Map();
  const number = value => value == null || String(value).trim() === '' ? null : Number(String(value).replace(',', '.'));
  const validGpa = value => { const n = number(value); return Number.isFinite(n) && n >= 0 && n <= 4 ? n : null; };
  const minute = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function keyFor(student, period) {
    const id = Number(student?.studentID), year = Number(period?.studyYear), term = Number(period?.term);
    return Number.isInteger(id) && id > 0 && year >= 2000 && year <= 2100 && Number.isInteger(term) && term > 0 && term <= 4
      ? `univer_recap_${id}_${year}_${term}` : null;
  }
  function read(key) {
    if (memory.has(key)) return memory.get(key);
    let data;
    try { data = JSON.parse(localStorage.getItem(key)); } catch { /* Private browsing/storage denial. */ }
    if (!data || data.version !== 1 || !data.weeks || typeof data.weeks !== 'object' || Array.isArray(data.weeks) || !Array.isArray(data.history)) data = { version: 1, weeks: {}, history: [], journal: [] };
    if (!Array.isArray(data.journal)) data.journal = [];
    data.history = data.history.filter(sample => sample && typeof sample.day === 'string' && validGpa(sample.gpa) !== null);
    memory.set(key, data);
    return data;
  }
  function capture({ student, period, entry, journal }) {
    const key = keyFor(student, period);
    if (!key) return;
    const data = read(key);
    if (entry && keyFor(student, entry.weekInfo) === key) {
      const week = Number(entry.weekInfo.week);
      if (Number.isInteger(week) && week >= 1 && week <= 60) {
        // Keep only fields required for statistics; do not persist teachers, messages or tokens.
        data.weeks[week] = Object.entries(entry.schedule || {}).flatMap(([day, lessons]) =>
          (Array.isArray(lessons) ? lessons : []).filter(l => l && typeof l === 'object').map(l => ({
            day, subject: String(l.subjectTitle || l.sub || '').slice(0, 200),
            slot: String(l.пара), start: entry.lessonTimes?.[l.пара]?.start,
            end: entry.lessonTimes?.[l.пара]?.end,
          })));
      }
    }
    if (Array.isArray(journal)) data.journal = journal.filter(s => s && typeof s === 'object').map(s => ({
      subject: String(s.subjectName || '').slice(0, 200), mark: number(s.centerMark),
    }));
    const gpa = validGpa(student.academicGpa);
    if (gpa !== null) {
      const now = new Date(), day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      const last = data.history.at(-1);
      if (last?.day === day) last.gpa = gpa;
      else data.history.push({ day, gpa });
      data.history = data.history.slice(-200);
    }
    data.updatedAt = Date.now();
    try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* Memory recap still works. */ }
  }
  function statistics(data) {
    const days = new Map(), subjects = new Map();
    let lessons = 0, minutes = 0, timedLessons = 0, earliest = null, early = 0;
    Object.values(data.weeks || {}).forEach(week => {
      const seen = new Set();
      (Array.isArray(week) ? week : []).forEach(l => {
        const identity = JSON.stringify([l.day, l.slot, l.subject]);
        if (seen.has(identity)) return;
        seen.add(identity);
        lessons++;
        days.set(l.day, (days.get(l.day) || 0) + 1);
        subjects.set(l.subject, (subjects.get(l.subject) || 0) + 1);
        const start = minute(l.start), end = minute(l.end);
        if (start !== null) {
          if (earliest === null || start < earliest) earliest = start;
          if (start < 600) early++;
        }
        if (start !== null && end !== null && end > start && end <= 1440) { minutes += end - start; timedLessons++; }
      });
    });
    const top = map => [...map].sort((a, b) => b[1] - a[1])[0] || null;
    const marks = (data.journal || []).filter(s => s.subject && Number.isFinite(s.mark) && s.mark > 0 && s.mark <= 100);
    const best = marks.sort((a, b) => b.mark - a.mark)[0] || null;
    return { weeks: Object.keys(data.weeks || {}).length, lessons, minutes, timedLessons, early,
      earliest: earliest === null ? null : `${String(Math.floor(earliest / 60)).padStart(2, '0')}:${String(earliest % 60).padStart(2, '0')}`,
      busiest: top(days), subject: top(subjects), best };
  }
  function stories(student, period, data) {
    const s = statistics(data), gpa = validGpa(student.academicGpa), base = data.history?.[0];
    const delta = base && gpa !== null ? gpa - base.gpa : 0;
    const coverage = s.weeks ? `Учтено недель: ${s.weeks} · по загруженному расписанию` : 'Расписание ещё загружается. Итоги появятся автоматически.';
    const fmt = n => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
    return [
      { kind: 'cover', tag: 'ТВОЯ УЧЕБНАЯ ИСТОРИЯ', value: 'Твой\nсеместр.', title: student.studentName || 'Это твоя история',
        text: `${period.studyYear} / ${Number(period.studyYear) + 1} · семестр ${period.term}`, note: 'Промежуточные итоги. Они растут вместе с тобой.' },
      { kind: 'volume', tag: 'ТЫ БЫЛ В РАСПИСАНИИ', value: s.lessons ? String(s.lessons) : '—', title: 'пар в твоём ритме',
        text: s.timedLessons ? `${fmt(s.minutes / 60)} часов занятий${s.timedLessons < s.lessons ? ' с известным временем' : ''}. И это без домашки.` : 'Каждая загруженная неделя добавляет новую главу.', note: `${coverage}. Это план занятий, не посещаемость.` },
      { kind: 'day', tag: 'ДЕНЬ С ХАРАКТЕРОМ', value: s.busiest?.[0] || 'Скоро', title: s.busiest ? 'забрал больше всего пар' : 'Твой ритм ещё проявится',
        text: s.busiest ? `${s.busiest[1]} занятий в учтённых неделях. На этот день нужен особый запас сил.` : 'Открой расписание — и мы найдём самый насыщенный день.', note: coverage },
      { kind: 'morning', tag: 'ТВОЙ УТРЕННИЙ РЕЖИМ', value: s.earliest || '—', title: 'самое раннее начало',
        text: s.early ? `${s.early} занятий начинались до 10:00. Будильник явно в теме.` : s.earliest ? 'Ранних пар до 10:00 в учтённом расписании нет.' : 'Время занятий пока недоступно.', note: coverage },
      { kind: 'subject', tag: 'В ГЛАВНОЙ РОЛИ', value: s.subject ? String(s.subject[1]) : '—', title: s.subject?.[0] || 'Твой главный предмет ещё впереди',
        text: 'Эта дисциплина чаще остальных встречается в твоём расписании.', note: coverage },
      { kind: 'result', tag: 'ЕСТЬ ЧЕМ ГОРДИТЬСЯ', value: s.best ? fmt(s.best.mark) : gpa !== null ? gpa.toFixed(2).replace('.', ',') : '—',
        title: s.best?.subject || (gpa !== null ? 'Твой академический GPA' : 'Результаты ещё впереди'),
        text: s.best ? 'Самый высокий текущий показатель в журнале. Хорошая точка для следующей цели.' : 'Оценки дополнят эту историю, когда загрузится журнал.',
        note: s.best ? 'Текущий показатель Platonus, не итоговая оценка за экзамен.' : 'Шкала GPA: от 0 до 4.' },
      { kind: 'final', tag: 'ЭТО ТВОЙ UNILINK RECAP', value: 'Продолжение\nза тобой.', title: student.studentName || 'Твой семестр',
        text: `${s.lessons} пар · ${s.weeks} учтённых недель · GPA ${gpa === null ? '—' : gpa.toFixed(2).replace('.', ',')}`,
        note: Math.abs(delta) >= .005 ? `GPA ${delta > 0 ? '+' : ''}${delta.toFixed(2).replace('.', ',')} с первого сохранённого замера (${base.day}).` : 'Сохрани эту главу. Следующая будет другой.' },
    ];
  }

  let dialog = null, previousFocus = null, current = 0, slides = [], currentStudent, currentPeriod, currentData;
  function render() {
    const s = slides[current];
    dialog.querySelector('.wrapped-progress').innerHTML = slides.map((_, i) => `<button type="button" data-slide="${i}" class="${i <= current ? 'is-seen' : ''}" aria-label="История ${i + 1}" ${i === current ? 'aria-current="step"' : ''}></button>`).join('');
    dialog.querySelector('.wrapped-stage').innerHTML = `<article class="wrapped-story wrapped-${s.kind}" aria-label="История ${current + 1} из ${slides.length}"><div class="wrapped-art" aria-hidden="true"><i></i><i></i><i></i></div><div class="wrapped-story-content"><p class="wrapped-tag">${escape(s.tag)}</p><div class="wrapped-value">${escape(s.value).replace(/\n/g, '<br>')}</div><h2>${escape(s.title)}</h2><p class="wrapped-description">${escape(s.text)}</p><p class="wrapped-note">${escape(s.note)}</p>${s.kind === 'final' ? '<button type="button" class="wrapped-save">Сохранить карточку ↗</button><p class="wrapped-save-status" role="status"></p>' : ''}</div></article>`;
    dialog.querySelector('.wrapped-count').textContent = `${current + 1} / ${slides.length}`;
    dialog.querySelector('.wrapped-prev').disabled = current === 0;
    dialog.querySelector('.wrapped-next').disabled = current === slides.length - 1;
  }
  function go(step) { current = Math.max(0, Math.min(slides.length - 1, current + step)); render(); }
  function close() { dialog?.close(); }
  function open({ student, period }) {
    const key = keyFor(student, period);
    if (!key) return;
    capture({ student, period });
    currentStudent = student; currentPeriod = period; currentData = read(key);
    slides = stories(student, period, currentData); current = 0;
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'wrapped-dialog'; dialog.setAttribute('aria-label', 'Твой семестр в историях');
      dialog.innerHTML = '<div class="wrapped-shell"><header class="wrapped-header"><span>UNILINK RECAP</span><button type="button" class="wrapped-close" aria-label="Закрыть истории">✕</button></header><nav class="wrapped-progress" aria-label="Истории семестра"></nav><div class="wrapped-stage" aria-live="polite"></div><footer class="wrapped-footer"><button type="button" class="wrapped-prev" aria-label="Предыдущая история">←</button><span class="wrapped-count"></span><button type="button" class="wrapped-next" aria-label="Следующая история">→</button></footer></div>';
      document.body.append(dialog);
      dialog.addEventListener('click', e => {
        if (e.target.closest('.wrapped-close')) close();
        if (e.target.closest('.wrapped-prev')) go(-1);
        if (e.target.closest('.wrapped-next')) go(1);
        const dot = e.target.closest('[data-slide]');
        if (dot) { current = Number(dot.dataset.slide); render(); }
        if (e.target.closest('.wrapped-save')) saveCard();
      });
      dialog.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      });
      let touch;
      const stage = dialog.querySelector('.wrapped-stage');
      stage.addEventListener('touchstart', e => { touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
      stage.addEventListener('touchend', e => {
        if (!touch) return;
        const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
        touch = null;
      }, { passive: true });
      dialog.addEventListener('close', () => {
        document.body.classList.remove('wrapped-open');
        if (previousFocus?.isConnected) previousFocus.focus();
      });
    }
    previousFocus = document.activeElement;
    render(); document.body.classList.add('wrapped-open'); dialog.showModal(); dialog.querySelector('.wrapped-close').focus();
  }
  function drawCard(student, period, data, accent) {
    const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
    const c = canvas.getContext('2d'), s = statistics(data), gpa = validGpa(student.academicGpa);
    c.fillStyle = '#101519'; c.fillRect(0, 0, 1080, 1920);
    c.strokeStyle = accent; c.lineWidth = 3;
    for (let i = 0; i < 14; i++) { c.beginPath(); c.ellipse(950, 550, 300 + i * 34, 600 + i * 25, -.5, 0, Math.PI * 2); c.stroke(); }
    c.fillStyle = '#101519'; c.fillRect(65, 820, 950, 1030);
    c.textAlign = 'left'; c.fillStyle = accent; c.font = '700 30px Manrope, sans-serif'; c.fillText('UNILINK RECAP', 80, 130);
    c.fillStyle = '#ffffff'; c.font = '800 120px Manrope, sans-serif'; c.fillText('Мой', 80, 340); c.fillText('семестр.', 80, 490);
    c.font = '500 32px Manrope, sans-serif'; c.fillText(`${period.studyYear} / ${Number(period.studyYear) + 1} · семестр ${period.term}`, 80, 575);
    function lines(text, y, size, color, limit = 2) {
      c.font = `600 ${size}px Manrope, sans-serif`; c.fillStyle = color;
      const words = String(text).split(/\s+/);
      for (let row = 0; row < limit && words.length; row++) {
        let line = words.shift();
        if (row === limit - 1) { line = [line, ...words].join(' '); words.length = 0; }
        else while (words.length && c.measureText(`${line} ${words[0]}`).width <= 910) line += ` ${words.shift()}`;
        if (c.measureText(line).width > 910) {
          while (line.length && c.measureText(`${line}…`).width > 910) line = line.slice(0, -1);
          line += '…';
        }
        c.fillText(line, 80, y); y += size * 1.35;
      }
    }
    lines(student.studentName || 'Студент', 900, 46, '#ffffff');
    c.fillStyle = accent; c.font = '800 144px Manrope, sans-serif'; c.fillText(String(s.lessons), 80, 1160);
    c.fillStyle = '#b9c5cb'; c.font = '500 38px Manrope, sans-serif'; c.fillText('пар в загруженном расписании', 80, 1230);
    c.fillStyle = accent; c.font = '800 120px Manrope, sans-serif'; c.fillText(gpa === null ? '—' : gpa.toFixed(2).replace('.', ','), 80, 1430);
    c.fillStyle = '#b9c5cb'; c.font = '500 38px Manrope, sans-serif'; c.fillText('академический GPA / 4,0', 80, 1500);
    lines(s.subject ? `Главный предмет: ${s.subject[0]}` : 'Продолжение за мной.', 1640, 34, '#ffffff');
    c.fillStyle = '#b9c5cb'; c.font = '500 26px Manrope, sans-serif'; c.fillText(`Промежуточные итоги · учтено недель: ${s.weeks}`, 80, 1810);
    return canvas;
  }
  async function saveCard() {
    const button = dialog.querySelector('.wrapped-save'), status = dialog.querySelector('.wrapped-save-status');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      // Use a direct downloadable preview: sharing after async canvas work loses iOS user activation.
      const canvas = drawCard(currentStudent, currentPeriod, currentData, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#9ac6b7');
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('export_failed');
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `unilink-recap-${currentPeriod.studyYear}-${currentPeriod.term}.png`; link.textContent = 'Открыть карточку'; link.target = '_blank'; link.rel = 'noopener';
      status.replaceChildren(link); link.click();
      const hint = document.createElement('span'); hint.textContent = ' На iPhone: открой картинку → Поделиться → Сохранить изображение.'; status.append(hint);
      setTimeout(() => URL.revokeObjectURL(url), 300000);
    } catch { status.textContent = 'Не удалось сохранить. Попробуй ещё раз.'; }
    finally { button.disabled = false; }
  }
  window.UniverWrapped = { capture, open, statistics, stories, keyFor };
})();
