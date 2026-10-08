import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStudySummary, enrichStudentStudy } from '../../api/_lib/student-study.js';

const html = `<input name="studentID" value="185082">
  <select name="courseNumber"><option value="0" selected>Все</option><option value="4">4</option></select>
  <span>Группа образовательных программ Информационные технологии (B057)</span>
  <span>Образовательная программа Data Science (6B06105)</span>
  <span style="text-decoration:underline">Курс 3 </span>`;
test('course comes from the student summary; B057 is not a study group', () => {
  assert.deepEqual(parseStudySummary(html, 185082), { courseNumber: 3 });
});
test('another student page and a login page cannot supply study details', () => {
  assert.deepEqual(parseStudySummary(html, 123), {});
  assert.deepEqual(parseStudySummary('<span>Курс 3</span>', 185082), {});
});
test('an explicitly labelled study group is read separately from the education programme', () => {
  assert.deepEqual(parseStudySummary(html + '<span>Учебная группа: ИС-23-1</span>', 185082), { courseNumber: 3, studentGroupName: 'ИС-23-1' });
});
test('unavailable HTML preserves the GPA profile and missing details', async () => {
  const student = { studentID: 185082, academicGpa: 3.25 };
  assert.equal(await enrichStudentStudy({}, student, Promise.resolve(null)), student);
  assert.deepEqual(await enrichStudentStudy({}, student, Promise.resolve(html)), { ...student, courseNumber: 3 });
});
