const text = value => typeof value === 'string' ? value.trim().slice(0, 500) : '';
const numeric = value => value == null || String(value).trim() === '' ? null : Number(String(value).replace(',', '.'));
const amount = (value, max = 10000) => { const n = numeric(value); return Number.isFinite(n) && n >= 0 && n <= max ? n : null; };

export function normalizeTranscript(data) {
  const studentID = Number(data?.student?.personID);
  // Platonus returns hasReadAccess=false even on a student's populated own
  // transcript. Ownership comes from the self-only route and matching IDs.
  if (!Number.isSafeInteger(studentID) || studentID <= 0) throw new Error('invalid_transcript');
  if (data.transcript?.studentID && Number(data.transcript.studentID) !== studentID) throw new Error('invalid_transcript');
  const periods = new Map();
  const categories = { courses: 'Дисциплины', practices: 'Практика', researches: 'Исследования', finalExams: 'Итоговая аттестация', diplomas: 'Дипломная работа', academicDifferenceSubjects: 'Академическая разница', additionalSubjects: 'Дополнительные дисциплины', rewritableSubjects: 'Перезачёт' };
  for (const [courseKey, courseData] of Object.entries(data.courseData || {})) {
    for (const [category, categoryName] of Object.entries(categories)) {
      for (const row of Array.isArray(courseData?.[category]) ? courseData[category] : []) {
        if (!row || row.deleted) continue;
        const course = Number(row.courseNumber || courseKey), term = Number(row.term);
        if (!Number.isInteger(course) || course < 1 || course > 8 || !Number.isInteger(term)) continue;
        const key = `${course}_${term}`;
        if (!periods.has(key)) periods.set(key, { course, term, gpa: amount(data.termGpaMap?.[key], 4), courseGpa: amount(data.courseGpaMap?.[course], 4), rows: [] });
        const hidden = row.hiddenMark || row.emptyMark || row.ignoreMarks;
        periods.get(key).rows.push({ subject: text(row.courseNameRU) || text(row.courseNameKZ) || text(row.courseNameEN) || 'Дисциплина',
          code: text(row.subjectCodeRU) || text(row.subjectCode) || text(row.displaySubject), category: categoryName,
          credits: amount(row.credits), ects: amount(row.ects),
          percent: hidden ? null : amount(row.transcriptMark?.percent ?? row.percentMark, 100),
          letter: hidden ? '' : text(row.transcriptMark?.alpha || row.alphaMark),
          points: hidden ? null : amount(row.transcriptMark?.inPoints ?? row.markInPoints, 4),
          traditional: hidden ? '' : text(row.transcriptMark?.traditional),
          retakes: amount(row.reExamCount), repeats: amount(row.retake),
        });
      }
    }
  }
  return { studentID, gpa: amount(data.transcript?.gpa, 4), credits: amount(data.transcript?.totalCreditsCount),
    assimilatedCredits: amount(data.transcript?.totalAssimilatedCreditsCount),
    periods: [...periods.values()].sort((a, b) => a.course - b.course || a.term - b.term) };
}

function plainText(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim().slice(0, 600);
}

// Calendar dates describe teaching periods, not the date on which a mark was entered.
function calendarRange(value, academicYear) {
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const parts = String(value).toLowerCase().replace(/\u00a0/g, ' ').replace(/[–—−]/g, '-')
    .replace(/^с\s+/, '').replace(/\s+по\s+/, '-').trim().split(/\s*-\s*/);
  if (!parts.length || parts.length > 2) return null;
  function date(part, fallback) {
    const match = part.trim().match(/^(\d{1,2})(?:\.(\d{1,2})(?:\.(\d{4}))?|\s+([а-яё]+)(?:\s+(\d{4})(?:\s*г\.?)?)?)?$/);
    if (!match) return null;
    const day = Number(match[1]), month = match[2] ? Number(match[2]) : match[4] ? months.indexOf(match[4]) + 1 : fallback?.month;
    const year = Number(match[3] || match[5] || (month >= 7 ? academicYear : academicYear + 1));
    if (!month || year < academicYear || year > academicYear + 1) return null;
    const stamp = new Date(Date.UTC(year, month - 1, day));
    if (stamp.getUTCFullYear() !== year || stamp.getUTCMonth() !== month - 1 || stamp.getUTCDate() !== day) return null;
    return { month, iso: stamp.toISOString().slice(0, 10) };
  }
  const end = date(parts.at(-1));
  const start = parts.length === 1 ? end : date(parts[0], end);
  return start && end && start.iso <= end.iso ? { start: start.iso, end: end.iso } : null;
}

export function calendarGradingPeriods(calendar) {
  const years = calendar.year?.match(/^(20\d{2})[–-](20\d{2})$/);
  if (!years || Number(years[2]) !== Number(years[1]) + 1) return [];
  const studyYear = Number(years[1]), periods = [];
  for (const semester of calendar.semesters || []) {
    const term = /осенн/i.test(semester.name) ? 1 : /весенн/i.test(semester.name) ? 2 : null;
    if (!term) continue;
    const rows = semester.groups.flatMap(group => group.rows);
    const read = pattern => {
      const matches = rows.filter(row => pattern.test(row.label.trim()));
      return matches.length === 1 ? calendarRange(matches[0].value, studyYear) : null;
    };
    const start = read(/^Начало семестра$/i), end = read(/^Конец семестра$/i);
    const first = read(/^(?:РК\s*1|Рубежный контроль\s*1)$/i);
    const second = read(/^(?:РК\s*2|Рубежный контроль\s*2)$/i);
    if (!start || !first || !second || start.start > first.start || first.end >= second.start
      || (end && second.end > end.end)) continue;
    const next = new Date(first.end + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
    // Weekend entries still belong to RK1; RK2 starts when the next teaching week opens.
    while ([0, 6].includes(next.getUTCDay())) next.setUTCDate(next.getUTCDate() + 1);
    if (next.toISOString().slice(0, 10) > second.start) continue;
    const firstEnd = new Date(next); firstEnd.setUTCDate(firstEnd.getUTCDate() - 1);
    periods.push({ studyYear, term, periods: [
      { id: 'rk1', start: start.start, end: firstEnd.toISOString().slice(0, 10) },
      { id: 'rk2', start: next.toISOString().slice(0, 10), end: second.end },
    ] });
  }
  // Duplicate semester definitions are ambiguous; do not choose one arbitrarily.
  return periods.filter(item => periods.filter(other => other.term === item.term).length === 1);
}
export function parseAcademicCalendar(html) {
  // Extract plain text only; never forward or execute the Platonus page/scripts.
  const clean = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const header = clean.match(/<td\b[^>]*class=["'][^"']*\bplainHeader\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
  if (!header) throw new Error('invalid_calendar');
  const title = plainText(header[1]), year = title.match(/(20\d{2})\s*[-–]\s*(20\d{2})/);
  const semesters = [];
  let semester, group;
  for (const token of clean.slice(header.index).matchAll(/<h([45])\b[^>]*>([\s\S]*?)<\/h\1>|<tr\b[^>]*>((?:(?!<tr\b|<h[45]\b)[\s\S])*?)<\/tr>/gi)) {
    if (token[1] === '4') {
      semester = { name: plainText(token[2]), groups: [{ name: 'Учебный период', rows: [] }] };
      group = semester.groups[0]; semesters.push(semester);
    } else if (token[1] === '5' && semester) {
      group = { name: plainText(token[2]), rows: [] }; semester.groups.push(group);
    } else if (semester && token[3]) {
      const cells = [...token[3].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
      const name = cells.find(c => /\btdPeriodName\b/.test(c[1]));
      const value = cells.find(c => /\btdPeriod\b/.test(c[1]));
      if (name && value && plainText(name[2]) && plainText(value[2])) group.rows.push({ label: plainText(name[2]), value: plainText(value[2]) });
    }
  }
  const visible = semesters.map(s => ({ ...s, groups: s.groups.filter(g => g.rows.length) })).filter(s => s.groups.length);
  if (!visible.length) throw new Error('invalid_calendar');
  const calendar = { title, year: year ? `${year[1]}–${year[2]}` : '', semesters: visible };
  return { ...calendar, gradingPeriods: calendarGradingPeriods(calendar) };
}
