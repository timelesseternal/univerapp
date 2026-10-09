import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStudySummary, parseTranscriptStudy, enrichStudentStudy } from '../../api/_lib/student-study.js';
import gpaHandler from '../../api/gpa.js';

test('cold-start GPA summary returns without loading the transcript',async t=>{
  const originalFetch=global.fetch;t.after(()=>{global.fetch=originalFetch;});
  let calls=0;
  global.fetch=async url=>{
    calls++;assert.ok(url.endsWith('/selfStudentCard/ru'));
    return {ok:true,status:200,json:async()=>({studentID:91,academicGpa:3.25})};
  };
  const session=Buffer.from(JSON.stringify({sid:'sid',token:'token',cookie:'cookie'})).toString('base64');
  const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}};
  await gpaHandler({query:{summary:'1'},headers:{'x-session':session}},res);
  assert.equal(res.code,200);assert.equal(res.body.studentID,91);assert.equal(calls,1);
});

test('authenticated transcript request enriches the profile without exposing other transcript fields', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://platonus.kstu.kz/rest/transcript/load/ru/0');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Sid, 'test-sid');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.courseNumber, []);
    assert.equal(body.includeSubjectUnderStudy, true);
    assert.equal(body.term, -1);
    return { ok: true, status: 200, json: async () => ({ student: {
      personID: 91, groupName: 'DS-24-1к', courseNumber: 3, adress: 'private', actions: [],
    } }) };
  };
  assert.deepEqual(await enrichStudentStudy({ sid: 'test-sid', token: 'token', cookie: 'cookie' },
    { studentID: 91, academicGpa: 3.25 }),
  { studentID: 91, academicGpa: 3.25, studentGroupName: 'DS-24-1к', courseNumber: 3 });
});

test('transcript study details use current fields rather than historical orders or the education programme', () => {
  const data = { student: { personID: 91, groupName: 'DS-24-1к', courseNumber: 3,
    specializationName: 'Data Science', actions: [{ name: 'ФИТ. DS-22-1к' }] } };
  assert.deepEqual(parseTranscriptStudy(data, 91), { studentGroupName: 'DS-24-1к', courseNumber: 3 });
  assert.deepEqual(parseTranscriptStudy(data, 92), {});
  assert.deepEqual(parseTranscriptStudy({ student: { personID: 91, courseNumber: 2026 } }, 91), {});
});

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
