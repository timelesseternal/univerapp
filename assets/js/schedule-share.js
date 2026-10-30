/* Export locally: no student data or images are uploaded to a sharing service. */
(() => {
  'use strict';
  function wrap(ctx, value, width) {
    const lines = [];
    let line = '';
    for (const word of String(value || '').split(/\s+/).filter(Boolean)) {
      if (line && ctx.measureText(`${line} ${word}`).width > width) {
        lines.push(line); line = '';
      }
      // Break unusually long codes/URLs too, without cutting off a subject name.
      for (const char of (line ? ' ' : '') + word) {
        if (line && ctx.measureText(line + char).width > width) {
          lines.push(line); line = '';
        }
        line += char;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  function card(model, teachers, accent = '#bda1ed') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_unavailable');
    const font = (size, weight = 500) => `${weight} ${size}px Manrope, sans-serif`;
    const rows = model.lessons.map(lesson => {
      ctx.font = font(34, 800);
      const title = wrap(ctx, lesson.name, 580);
      ctx.font = font(24);
      const meta = [lesson.type, lesson.room, teachers && lesson.teacher]
        .filter(Boolean).flatMap(value => wrap(ctx, value, 580));
      return {lesson, title, meta, height: Math.max(136, title.length * 44 + meta.length * 34 + 48)};
    });
    const height = 354 + (rows.length ? rows.reduce((n, row) => n + row.height, 0) : 160);
    if (height > 16000) throw new Error('card_too_large');
    canvas.width = 900; canvas.height = height;
    const gradient = ctx.createLinearGradient(0, 0, 900, height);
    // Pastel tint keeps dark text readable even with a dark/red custom accent.
    const pastel = '#' + accent.slice(1).match(/../g).map(hex =>
      Math.round(parseInt(hex, 16) * .45 + 255 * .55).toString(16).padStart(2, '0')).join('');
    gradient.addColorStop(0, pastel); gradient.addColorStop(1, '#e3d9fa');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 900, height);
    ctx.fillStyle = '#241b38';
    const text = (value, x, y, size, weight = 500) => {
      ctx.font = font(size, weight); ctx.fillText(String(value), x, y);
    };
    text('UniLink', 52, 78, 29, 800);
    ctx.textAlign = 'right'; text('РАСПИСАНИЕ ДЛЯ ДРУГА', 848, 76, 17, 800); ctx.textAlign = 'left';
    text(model.day, 52, 160, 50, 800);
    text(`Неделя ${model.week} · ${model.term} семестр · ${model.year}–${Number(model.year) + 1}`, 52, 208, 24);
    let y = 258;
    for (const row of rows) {
      ctx.fillStyle = 'rgba(36,27,56,.16)'; ctx.fillRect(52, y, 796, 1);
      ctx.fillStyle = '#241b38';
      text(row.lesson.start, 52, y + 49, 30, 800);
      text(row.lesson.end, 52, y + 85, 23);
      let lineY = y + 49;
      row.title.forEach(line => { text(line, 250, lineY, 34, 800); lineY += 44; });
      lineY += 3;
      row.meta.forEach(line => { text(line, 250, lineY, 24); lineY += 34; });
      y += row.height;
    }
    if (!rows.length) { text('В этот день пар нет', 52, y + 65, 38, 800); y += 160; }
    ctx.fillStyle = 'rgba(36,27,56,.16)'; ctx.fillRect(52, y, 796, 1);
    ctx.fillStyle = '#241b38';
    ctx.font = font(22, 700);
    // Group names are short normally; wrap instead of clipping unexpected values.
    text(wrap(ctx, model.group || 'Учись. Планируй. Делись.', 796)[0] || '', 52, y + 57, 22, 700);
    return canvas;
  }
  let dialog, snapshot, file, imageURL, generation = 0, sharing = false;
  const byId = id => document.getElementById(id);
  function status(message) { byId('scheduleShareStatus').textContent = message; }
  function busy(value) {
    byId('scheduleShareSend').disabled = value || sharing;
    byId('scheduleShareSave').disabled = value;
    byId('scheduleShareTeachers').disabled = !snapshot || sharing;
  }
  function release() {
    generation++; file = null;
    byId('scheduleShareImage')?.removeAttribute('src');
    byId('scheduleShareOpen')?.removeAttribute('href');
    if (imageURL) URL.revokeObjectURL(imageURL);
    imageURL = null;
  }
  function canShareFile() {
    try { return !!(file && navigator.share && navigator.canShare?.({files: [file]})); }
    catch { return false; }
  }
  async function prepare() {
    release();
    const run = generation;
    busy(true);
    byId('scheduleShareImage').hidden = true;
    byId('scheduleShareOpen').hidden = true;
    status('Готовим картинку…');
    try {
      // Keep font loading separate from the user-activated share click.
      if (document.fonts?.load) {
        await Promise.race([Promise.all([document.fonts.load('800 34px Manrope', 'UniLink Расписание Әғ'), document.fonts.load('500 24px Manrope', 'UniLink Расписание Әғ')]).catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 2500))]);
      }
      if (run !== generation || !dialog.open) return;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const canvas = card(snapshot, byId('scheduleShareTeachers').checked, /^#[\da-f]{6}$/i.test(accent) ? accent : undefined);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (run !== generation || !dialog.open) return;
      if (!blob) throw new Error('empty_image');
      file = new File([blob], `unilink-week-${snapshot.week}-${snapshot.day}.png`, {type: 'image/png'});
      imageURL = URL.createObjectURL(blob);
      const image = byId('scheduleShareImage');
      image.src = imageURL; image.hidden = false;
      const open = byId('scheduleShareOpen');
      open.href = imageURL;
      busy(false);
      byId('scheduleShareSend').disabled = !canShareFile();
      status(canShareFile() ? 'Нажми «Поделиться» и выбери WhatsApp или другое приложение.' :
        'Сохрани картинку и прикрепи её в WhatsApp. Можно открыть изображение и сохранить его долгим нажатием.');
      open.hidden = canShareFile();
    } catch {
      if (run === generation && dialog.open) status('Не удалось создать картинку. Закрой окно и попробуй ещё раз.');
    }
  }
  async function share() {
    if (sharing || !canShareFile()) return;
    const run = generation;
    sharing = true; busy(false);
    try {
      // No await before share: Safari needs the activation from this exact tap.
      await navigator.share({files: [file], title: `UniLink · ${snapshot.day}`});
      if (dialog.open && run === generation) status('Картинка передана в меню отправки.');
    } catch (error) {
      if (dialog.open && run === generation && error.name !== 'AbortError') {
        status('Не удалось открыть отправку. Сохрани картинку или открой изображение.');
        byId('scheduleShareOpen').hidden = false;
      }
    } finally { sharing = false; if (dialog.open) { busy(!file); byId('scheduleShareSend').disabled = !canShareFile(); } }
  }
  function save() {
    if (!file || !imageURL) return;
    const link = document.createElement('a');
    link.href = imageURL; link.download = file.name; link.target = '_blank'; link.rel = 'noopener';
    document.body.append(link); link.click(); link.remove();
    byId('scheduleShareOpen').hidden = false;
    status('Если загрузка не началась, открой изображение и сохрани его долгим нажатием. На iPhone файл также можно сохранить через «Поделиться».');
  }
  function open() {
    if (dialog?.open) return;
    snapshot = window.getScheduleShareSnapshot?.();
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'scheduleShareDialog'; dialog.className = 'schedule-share-dialog';
      dialog.setAttribute('aria-labelledby', 'scheduleShareTitle');
      dialog.innerHTML = `<header class="schedule-share-header"><h2 id="scheduleShareTitle">Расписание для друга</h2><button type="button" id="scheduleShareClose" class="schedule-share-close" aria-label="Закрыть"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div class="schedule-share-preview"><img id="scheduleShareImage" alt="Карточка выбранного дня" hidden></div><label class="schedule-share-options"><input id="scheduleShareTeachers" type="checkbox">Показывать преподавателей</label><div class="schedule-share-actions"><button type="button" id="scheduleShareSend" class="schedule-share-primary" disabled>Поделиться</button><button type="button" id="scheduleShareSave" disabled>Сохранить PNG</button></div><a id="scheduleShareOpen" class="schedule-share-open" target="_blank" rel="noopener" hidden>Открыть изображение</a><p class="schedule-share-status" id="scheduleShareStatus" role="status" aria-live="polite"></p>`;
      document.body.append(dialog);
      byId('scheduleShareClose').addEventListener('click', () => window.unilinkMotion ? window.unilinkMotion.closeDialog(dialog) : dialog.close());
      dialog.addEventListener('close', release);
      byId('scheduleShareTeachers').addEventListener('change', prepare);
      byId('scheduleShareSend').addEventListener('click', share);
      byId('scheduleShareSave').addEventListener('click', save);
    }
    dialog.showModal();
    if (!snapshot) {
      release(); busy(true); byId('scheduleShareImage').hidden = true; byId('scheduleShareOpen').hidden = true;
      status('Дождись загрузки выбранной недели и открой карточку ещё раз.');
      return;
    }
    prepare();
  }
  byId('scheduleShareLaunch')?.addEventListener('click', open);
  // Pure layout helpers also used by regression tests for long subjects.
  window.unilinkScheduleShare = {wrap, card};
})();
