import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../assets/js/app.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  function escapeHtml('),source.indexOf('  function renderProfile(')),context);
test('study details accept named groups and valid courses without treating a calendar year as a course',()=>{
  assert.equal(context.studentGroup({group:{name:'ВТ-24-1'}}),'ВТ-24-1');
  assert.equal(context.studentCourse({courseNumber:'2'}),2);
  assert.equal(context.studentCourse({yearOfStudy:2026}),null);
  assert.equal(context.studentGroup({}),null);
  assert.equal(context.escapeHtml('<b>Группа</b>'),'&lt;b&gt;Группа&lt;/b&gt;');
});

test('an incomplete refresh preserves this students group but never reuses another accounts group',()=>{
  context.platonusStudent={studentID:23,studentGroupName:'DS-24-1к',courseNumber:3,academicGpa:3};
  const refreshed=context.mergeStudentProfile({studentID:23,academicGpa:3.45,courseNumber:3});
  assert.equal(refreshed.studentGroupName,'DS-24-1к');assert.equal(refreshed.academicGpa,3.45);
  assert.equal(context.mergeStudentProfile({studentID:24}).studentGroupName,undefined);
  assert.equal(context.mergeStudentProfile({studentID:23,groupName:'DS-24-2к'}).studentGroupName,'DS-24-2к');
});
