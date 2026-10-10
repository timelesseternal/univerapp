const text = value => typeof value === 'string' ? value.trim().slice(0, 500) : '';
const numeric = value => value == null || String(value).trim() === '' ? null : Number(String(value).replace(',', '.'));
const amount = (value, max = 10000) => { const n = numeric(value); return Number.isFinite(n) && n >= 0 && n <= max ? n : null; };

export function normalizeTranscript(data) {
  const studentID = Number(data?.student?.personID);
  if (!Number.isSafeInteger(studentID) || studentID <= 0 || data.hasReadAccess === false) throw new Error('invalid_transcript');
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
  return { title, year: year ? `${year[1]}–${year[2]}` : '', semesters: visible };
}
