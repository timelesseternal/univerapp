import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTranscript, parseAcademicCalendar } from '../../api/_lib/academic-documents.js';
import calendarHandler from '../../api/calendar.js';
import transcriptHandler from '../../api/transcript.js';

const calendarHTML = `<script>private</script><table><tr><td class="plainHeader"><b>Академический календарь<br>на 2026 - 2027 учебный год</b></td></tr><tr><td><table><tr><td>
<h4>Осенний семестр</h4><table><tr><td class="tdPeriodName">Начало семестра</td><td class="tdPeriod">1 сентября</td></tr></table>
<h5>Рубежные контроли</h5><table><tr><td class="tdPeriodName">РК 1</td><td class="tdPeriod">19–24 октября</td></tr></table>
<!--<h4>False semester</h4>--><h4>Весенний семестр</h4><table><tr><td class="tdPeriodName">Конец семестра</td><td class="tdPeriod">8 мая</td></tr></table>
<h5>Практика</h5><table><tr><td class="tdPeriodName">Практика &amp; отчёт</td><td class="tdPeriod">24 мая–26 июня</td></tr></table>
</td></tr></table></td></tr></table>`;
const transcript = () => ({ student: { personID: 7, adress: 'private', actions: ['private'] }, hasReadAccess: true,
  transcript: { studentID: 7, gpa: '3.45', totalCreditsCount: '120', totalAssimilatedCreditsCount: '110' },
  courseData: { 1: { courses: [{ courseNumber: 1, term: 1, courseNameRU: 'Математика', subjectCodeRU: 'MAT1', credits: 5, ects: 5,
    transcriptMark: { percent: '99.0', alpha: 'A', inPoints: '4.0', traditional: 'Отлично' }, retake: 0, reExamCount: 0, private: 'secret' }] } },
  termGpaMap: { '1_1': 3.58 }, courseGpaMap: { 1: 3.56 } });
test('calendar parser handles nested layout tables and preserves semester groups', () => {
  const result = parseAcademicCalendar(calendarHTML);
  assert.equal(result.year, '2026–2027');
  assert.deepEqual(result.semesters.map(s => s.name), ['Осенний семестр', 'Весенний семестр']);
  assert.equal(result.semesters[0].groups[0].rows[0].value, '1 сентября');
  assert.equal(result.semesters[0].groups[1].rows[0].value, '19–24 октября');
  assert.equal(result.semesters[1].groups[1].rows[0].label, 'Практика & отчёт');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.throws(() => parseAcademicCalendar('<html>Войти</html>'), /invalid_calendar/);
});
test('transcript contains only academic fields with numeric marks and GPA', () => {
  const result = normalizeTranscript(transcript());
  assert.equal(result.studentID, 7); assert.equal(result.gpa, 3.45);
  assert.equal(result.periods[0].gpa, 3.58); assert.equal(result.periods[0].rows[0].points, 4);
  assert.equal(result.periods[0].rows[0].percent, 99);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('hidden marks and deleted subjects are not exposed; mismatched identity is rejected', () => {
  const data = transcript(); const rows = data.courseData[1].courses;
  rows.push({ ...rows[0], deleted: true }); rows[0].hiddenMark = true;
  const result = normalizeTranscript(data); assert.equal(result.periods[0].rows.length, 1);
  assert.equal(result.periods[0].rows[0].percent, null); assert.equal(result.periods[0].rows[0].letter, '');
  data.transcript.studentID = 8; assert.throws(() => normalizeTranscript(data), /invalid_transcript/);
  data.transcript.studentID = 7; data.hasReadAccess = false;
  assert.equal(normalizeTranscript(data).periods[0].rows.length, 1);
});
const session = Buffer.from(JSON.stringify({ sid: 'sid', token: 'token', cookie: 'cookie' })).toString('base64');
const response = () => ({ setHeader(k,v) { (this.headers ||= {})[k] = v; }, status(code) { this.code = code; return this; }, json(data) { this.body = data; } });
test('document routes require session and GET', async () => {
  for (const handler of [calendarHandler, transcriptHandler]) {
    let res = response(); await handler({ method: 'GET', headers: {} }, res); assert.equal(res.code, 401);
    res = response(); await handler({ method: 'POST', headers: {} }, res); assert.equal(res.code, 405);
  }
});
test('calendar and transcript fetch the signed-in account only and reject expired sessions', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; });
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push(url); assert.equal(options.headers.Sid, 'sid');
    if (url.endsWith('/calendarview')) return { ok: true, status: 200, text: async () => calendarHTML };
    if (url.endsWith('/selfStudentCard/ru')) return { ok: true, status: 200, json: async () => ({ studentID: 7 }) };
    assert.ok(url.endsWith('/transcript/load/ru/0')); assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body); assert.deepEqual(body.courseNumber, []); assert.equal(body.includeSubjectUnderStudy, true);
    return { ok: true, status: 200, json: async () => transcript() };
  };
  for (const handler of [calendarHandler, transcriptHandler]) {
    const res = response(); await handler({ method: 'GET', query: { studentID: 999 }, headers: { 'x-session': session } }, res);
    assert.equal(res.code, 200); assert.equal(res.body.studentID, 7); assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  assert.equal(calls.some(url => url.includes('999')), false);
  global.fetch = async () => ({ ok: false, status: 401 });
  for (const handler of [calendarHandler, transcriptHandler]) {
    const res = response(); await handler({ headers: { 'x-session': session } }, res); assert.equal(res.code, 401);
  }
});
