import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../assets/js/app.js',import.meta.url),'utf8');
function setup(journal,failed=false){
  const element={innerHTML:''};
  const ctx=vm.createContext({document:{getElementById:()=>element},platonusStudent:{studentID:7},liveJournalData:journal,
    gradesLoadFailed:failed,swapContent:(target,html)=>{target.innerHTML=html;},buildGradeCardHtml:()=>'<article>Предмет</article>'});
  vm.runInContext(source.slice(source.indexOf('  function renderGrades('),source.indexOf('  function renderCurrentSection(')),ctx);
  return {ctx,element};
}
test('an empty journal displays an explanation without a manual refresh button',()=>{
  const ui=setup([]);ui.ctx.renderGrades(false);
  assert.match(ui.element.innerHTML,/Оценок пока нет/);assert.doesNotMatch(ui.element.innerHTML,/retryGrades|<button/);
});
test('a failed refresh preserves cached cards and announces automatic retry',()=>{
  const ui=setup([{}],true);ui.ctx.renderGrades(false);
  assert.match(ui.element.innerHTML,/сохранённые данные/);assert.match(ui.element.innerHTML,/<article>/);
  assert.match(ui.element.innerHTML,/автоматически/);assert.doesNotMatch(ui.element.innerHTML,/<button/);
});
test('a failed cold load displays an error instead of an endless spinner',()=>{
  const ui=setup(null,true);ui.ctx.renderGrades(false);
  assert.match(ui.element.innerHTML,/Не удалось загрузить оценки/);assert.doesNotMatch(ui.element.innerHTML,/загружаются/);
});
test('grades render while UMKD is pending, and repeated journal requests are shared',async()=>{
  let renders=0,calls=0;
  const ctx=vm.createContext({platonusStudent:{studentID:7},authGeneration:1,currentSection:'grades',gradesLoadFailed:false,
    liveJournalData:null,platonusFetch:path=>{calls++;return path.includes('/grades')?Promise.resolve([{subjectName:'Предмет'}]):new Promise(()=>{});},
    renderGrades(){renders++;},saveCachedStudentData(){}});
  vm.runInContext(source.slice(source.indexOf('  let journalRequest'),source.indexOf('  function retryGrades')),ctx);
  ctx.fetchGradesAndUmkd(2026,1);
  await ctx.fetchJournal(2026,1);
  assert.equal(renders,1);assert.equal(calls,2);assert.equal(ctx.liveJournalData[0].subjectName,'Предмет');
});

test('UMKD renders without waiting for grades and fresh responses are reused',async()=>{
  let renders=0,calls=0;
  const ctx=vm.createContext({platonusStudent:{studentID:7},authGeneration:1,currentSection:'umkd',selectedUmkdSubject:null,
    liveJournalData:null,liveUmkdData:null,platonusFetch:path=>{calls++;return path.includes('/umkd')?Promise.resolve({subjects:[]}):new Promise(()=>{});},
    renderUmkdSubjects(){renders++;},saveCachedStudentData(){}});
  vm.runInContext(source.slice(source.indexOf('  let journalRequest'),source.indexOf('  function retryGrades')),ctx);
  ctx.fetchGradesAndUmkd(2026,1);
  await ctx.fetchUmkd(2026,1);
  await ctx.fetchUmkd(2026,1);
  assert.equal(renders,1);assert.equal(calls,2);
});

test('grades reuse fresh data, explicit refresh bypasses freshness, and another login cannot reuse it',async()=>{
  let calls=0;
  const ctx=vm.createContext({platonusStudent:{studentID:7},authGeneration:1,currentSection:'schedule',
    liveJournalData:null,platonusFetch:async()=>{calls++;return [];},saveCachedStudentData(){}});
  vm.runInContext(source.slice(source.indexOf('  let journalRequest'),source.indexOf('  function retryGrades')),ctx);
  await ctx.fetchJournal(2026,1);await ctx.fetchJournal(2026,1);
  assert.equal(calls,1);
  await ctx.fetchJournal(2026,1,true);assert.equal(calls,2);
  ctx.authGeneration++;await ctx.fetchJournal(2026,1);assert.equal(calls,3);
});

test('academic refresh pauses when hidden and retries the visible section automatically',()=>{
  const calls=[];
  const ctx=vm.createContext({document:{hidden:true},platonusSession:'session',
    liveScheduleWeekInfo:{selectedStudyYear:2026,selectedTerm:1},currentSection:'grades',
    fetchJournal:(...args)=>calls.push(['grades',...args]),fetchUmkd:(...args)=>calls.push(['umkd',...args])});
  vm.runInContext(source.slice(source.indexOf('  function refreshVisibleAcademicData()'),source.indexOf('  const CITY_COORDS')),ctx);
  ctx.refreshVisibleAcademicData();assert.equal(calls.length,0);
  ctx.document.hidden=false;ctx.refreshVisibleAcademicData();
  assert.deepEqual(calls,[['grades',2026,1]]);
  ctx.currentSection='umkd';ctx.refreshVisibleAcademicData();assert.deepEqual(calls[1],['umkd',2026,1]);
});
