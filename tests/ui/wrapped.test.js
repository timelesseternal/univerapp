import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../../assets/js/wrapped.js', import.meta.url), 'utf8');
function setup(denied = false) {
  const store = new Map();
  const context = vm.createContext({ window: {}, Date, localStorage: {
    getItem: k => store.get(k), setItem: (k, v) => { if (denied) throw Error('denied'); store.set(k, v); },
  } });
  vm.runInContext(source, context);
  return { ...context.window.UniverWrapped, store };
}
const student = { studentID: 42, academicGpa: 3.45, studentName: 'Тестовый студент' };
const period = { studyYear: 2026, term: 1, week: 6 };
function entry(week = 6) { return { weekInfo: { ...period, week }, schedule: {
  Понедельник: [{ пара: '1', subjectTitle: 'Методы оптимизации' }, { пара: '2', subjectTitle: 'Web' }],
  Вторник: [{ пара: '1', subjectTitle: 'Методы оптимизации' }],
}, lessonTimes: { 1: { start: '09:00', end: '10:45' }, 2: { start: '10:55', end: '12:40' } } }; }
test('recap replaces week snapshots instead of doubling totals and isolates account/semester', () => {
  const api = setup();
  api.capture({ student, period, entry: entry() }); api.capture({ student, period, entry: entry() });
  api.capture({ student, period, entry: entry(7) });
  api.capture({ student: { ...student, studentID: 99 }, period, entry: entry() });
  api.capture({ student, period: { ...period, term: 2 }, entry: entry() });
  const data = JSON.parse(api.store.get(api.keyFor(student, period)));
  const s = api.statistics(data);
  assert.equal(s.weeks, 2); assert.equal(s.lessons, 6); assert.equal(s.minutes, 630);
  assert.equal(s.early, 4); assert.equal(s.earliest, '09:00');
  assert.equal(s.busiest[0], 'Понедельник'); assert.equal(s.subject[0], 'Методы оптимизации');
  assert.equal(JSON.parse(api.store.get(api.keyFor(student, { ...period, term: 2 }))).weeks['6'], undefined);
  assert.equal(data.history.length, 1);
});
test('missing grades and invalid times are not reported as achievements', () => {
  const api = setup(), data = { weeks: { 1: [
    { day: 'Понедельник', slot: '1', subject: 'Web', start: '09:00', end: '10:45' },
    { day: 'Понедельник', slot: '1', subject: 'Web', start: '09:00', end: '10:45' },
    { day: 'Понедельник', slot: '2', subject: 'Web', start: '28:70', end: '29:90' },
  ] }, journal: [{ subject: 'Web', mark: null }, { subject: 'Math', mark: 200 }], history: [] };
  const s = api.statistics(data);
  assert.equal(s.lessons, 2); assert.equal(s.minutes, 105); assert.equal(s.timedLessons, 1); assert.equal(s.best, null);
  const slides = api.stories({ ...student, academicGpa: null }, period, data);
  assert.equal(slides[5].value, '—'); assert.match(slides[1].note, /не посещаемость/);
  assert.match(slides[1].text, /с известным временем/);
});
test('highest current journal mark is identified without claiming it is an exam result', () => {
  const api = setup();
  api.capture({ student, period, journal: [{ subjectName: 'Web', centerMark: '93,5' }, { subjectName: 'Math', centerMark: '' }] });
  const data = JSON.parse(api.store.get(api.keyFor(student, period)));
  assert.equal(api.statistics(data).best.mark, 93.5);
  assert.match(api.stories(student, period, data)[5].note, /не итоговая оценка/);
});
test('recap remains available when browser storage is denied', () => {
  const api = setup(true);
  assert.doesNotThrow(() => api.capture({ student, period, entry: entry() }));
  assert.equal(api.keyFor({ studentID: 0 }, period), null);
});
