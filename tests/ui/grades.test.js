import {installLoading} from '../helpers/loading.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../assets/js/app.js',import.meta.url),'utf8');

test('grade fields remain text and an upstream color cannot inject SVG attributes',()=>{
  const ctx=vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('  function orderGradeMetrics('),source.indexOf('  function studentGroup(')),ctx);
  const attack='<img src=x onerror="alert(1)">';
  const html=ctx.buildGradeCardHtml({subjectName:attack,tutorList:attack,centerMark:75,
    color:'red" onload="alert(1)',exams:[{name:attack,mark:attack}]},0);
  assert.doesNotMatch(html,/<img|stroke="red" onload/);
  assert.match(html,/&lt;img/);assert.match(html,/stroke="var\(--accent\)"/);
  const valid=ctx.buildGradeCardHtml({color:'#aabbcc',centerMark:75,exams:[]},0);
  assert.match(valid,/stroke="#aabbcc"/);assert.match(valid,/>75%</);
});
function setup(journal,failed=false){
  const element={innerHTML:''};
  const ctx=vm.createContext({document:{getElementById:()=>element},platonusStudent:{studentID:7},liveJournalData:journal,
    gradesLoadFailed:failed,swapContent:(target,html)=>{target.innerHTML=html;},buildGradeCardHtml:()=>'<article>Предмет</article>'});
  installLoading(ctx);
  vm.runInContext(source.slice(source.indexOf('  function renderGrades('),source.indexOf('  function renderCurrentSection(')),ctx);
  return {ctx,element};
}
test('an empty journal displays automatic loading without a Platonus warning or refresh button',()=>{
  const ui=setup([]);ui.ctx.renderGrades(false);
  assert.match(ui.element.innerHTML,/content-loading/);assert.doesNotMatch(ui.element.innerHTML,/notice-panel|Platonus|пустой|Оценок пока нет|retryGrades|<button/);
});

test('empty journals retry promptly and never overwrite cached grades or recap with emptiness',async()=>{
  let now=0,calls=0,saves=0,captures=0;
  const saved=[{subjectName:'Предмет'}];
  const responses=[[],saved,[]];
  const ctx=vm.createContext({Date:{now:()=>now},window:{UniverWrapped:{capture(){captures++;}}},
    platonusStudent:{studentID:7},authGeneration:1,currentSection:'grades',gradesLoadFailed:false,
    liveJournalData:saved,platonusFetch:async()=>{calls++;return responses.shift();},renderGrades(){},saveCachedStudentData(){saves++;}});
  vm.runInContext(source.slice(source.indexOf('  let journalRequest'),source.indexOf('  function retryGrades')),ctx);
  assert.equal(await ctx.fetchJournal(2026,1),null);
  assert.equal(ctx.liveJournalData,saved);assert.equal(saves,0);assert.equal(captures,0);
  await ctx.fetchJournal(2026,1);assert.equal(calls,1);
  now=15000;await ctx.fetchJournal(2026,1);assert.equal(calls,2);assert.equal(saves,1);
  now=45000;assert.equal(await ctx.fetchJournal(2026,1),null);
  assert.equal(ctx.liveJournalData,saved);assert.equal(saves,1);assert.equal(captures,1);
});

test('an empty response for another semester cannot keep the previous semester cards',async()=>{
  const ctx=vm.createContext({window:{},platonusStudent:{studentID:7},authGeneration:1,currentSection:'grades',
    liveJournalData:null,platonusFetch:async path=>path.includes('term=1')?[{subjectName:'Первый семестр'}]:[],
    renderGrades(){},saveCachedStudentData(){}});
  vm.runInContext(source.slice(source.indexOf('  let journalRequest'),source.indexOf('  function retryGrades')),ctx);
  await ctx.fetchJournal(2026,1);await ctx.fetchJournal(2026,2);
  assert.equal(ctx.liveJournalData,null);
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
    liveJournalData:null,liveUmkdData:null,platonusFetch:path=>{calls++;return path.includes('/umkd')?Promise.resolve({records:[]}):new Promise(()=>{});},
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
