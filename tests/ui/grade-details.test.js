import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {installLoading} from '../helpers/loading.js';
const source=readFileSync(new URL('../../assets/js/grade-details.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(fetch, {calendar, now = '2026-11-16T12:00:00Z'} = {}) {
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  const ctx=vm.createContext({window:{},Date:Clock});installLoading(ctx);vm.runInContext(source,ctx);
  const api=ctx.window.unilinkGradeDetails;
  const buttons = new Map();
  const body={isConnected:true,contains:()=>true,html:'',
    set innerHTML(value) {
      this.html=value; buttons.clear();
      for(const match of value.matchAll(/data-grade-period="([^"]+)"/g)) buttons.set(match[1],{
        dataset:{gradePeriod:match[1]}, addEventListener(name,fn){this[name]=fn;}, focus(){},
      });
    },
    get innerHTML(){return this.html;},
    querySelectorAll:()=>[...buttons.values()],
    querySelector:selector=>selector.startsWith('[data-grade-period=')?buttons.get(selector.match(/"([^"]+)"/)[1]):({addEventListener(){}}),
  };
  const details={open:true,dataset:{gradeIndex:'0'},querySelector:()=>body,matches:()=>true};
  const root={addEventListener(){},removeEventListener(){},querySelectorAll:()=>[details]};
  const context={studentID:7,generation:1,year:2026,term:1,subjects:[{subjectID:9048,queryID:253432,studyGroupId:45903}],fetch,calendar};
  api.attach(root,context);
  return {api,body,details,root,context,open(){root.gradeDetailsToggle({target:details});},choose(id){buttons.get(id).click();}};
}
const groups=[{name:'Лекция',tutor:'Преподаватель',marks:[{date:'2026-10-02',mark:85}]}];
test('real journal subjectID and queryID select each subject rather than its studyGroupId',async()=>{
  const calls=[];
  const ui=setup(async url=>{calls.push(url);return {groups:calls.length===1?groups:[]};});
  ui.open();await flush();
  assert.equal(calls[0],'/api/grade-details?year=2026&term=1&subjectID=9048&queryID=253432');
  ui.context.subjects.push({subjectID:9053,queryID:253578,studyGroupId:45928});
  ui.details.dataset.gradeIndex='1';ui.open();await flush();
  assert.equal(calls[1],'/api/grade-details?year=2026&term=1&subjectID=9053&queryID=253578');
  assert.match(ui.body.innerHTML,/Оценок за контрольные точки пока нет/);
  ui.details.dataset.gradeIndex='0';ui.open();await flush();
  assert.match(ui.body.innerHTML,/02\.10\.2026/);assert.equal(calls.length,2);
});
test('disclosures share pending requests, reuse results, and preserve open state across rerenders',async()=>{
  let resolve,calls=0;const work=new Promise(done=>{resolve=done;});
  const ui=setup(()=>{calls++;return work;});ui.open();ui.open();
  assert.equal(calls,1);assert.match(ui.body.innerHTML,/content-loading/);
  resolve({groups});await flush();assert.match(ui.body.innerHTML,/02\.10\.2026/);assert.match(ui.body.innerHTML,/>85</);
  ui.open();await flush();assert.equal(calls,1);
  ui.details.open=false;ui.api.attach(ui.root,ui.context);await flush();assert.equal(ui.details.open,true);assert.equal(calls,1);
});
test('confirmed emptiness and fetch failures have distinct messages',async()=>{
  const empty=setup(async()=>({groups:[]}));empty.open();await flush();assert.match(empty.body.innerHTML,/Оценок за контрольные точки пока нет/);
  const failed=setup(async()=>{throw new Error('offline');});failed.open();await flush();
  assert.match(failed.body.innerHTML,/Попробовать снова/);assert.doesNotMatch(failed.body.innerHTML,/Оценок за контрольные точки пока нет/);
});

test('grade detail errors explain format, timeout, profile and offline failures without rendering raw upstream data',async()=>{
  for(const [message,expected] of [
    ['request_failed: grade_details_unavailable | GD_FORMAT',/неподдерживаемый формат оценок \(GD_FORMAT\)/],
    ['request_failed: grade_details_unavailable | GD_TIMEOUT',/отвечает слишком долго \(GD_TIMEOUT\)/],
    ['request_failed: grade_details_unavailable | GD_PROFILE',/проверить учебный профиль \(GD_PROFILE\)/],
    ['request_failed: grade_details_unavailable | GD_UPSTREAM',/не отдаёт данные предмета \(GD_UPSTREAM\)/],
    ['offline',/Нет подключения к интернету/],
    ['<img src=x onerror=alert(1)>',/Не удалось загрузить контрольные точки/],
  ]) {
    const ui=setup(async()=>{throw new Error(message);});ui.open();await flush();
    assert.match(ui.body.innerHTML,expected);assert.match(ui.body.innerHTML,/Попробовать снова/);
    assert.doesNotMatch(ui.body.innerHTML,/<img|onerror|Оценок за контрольные точки пока нет/);
  }
});

test('the exact server format code remains visible while client parsing failures request an app update',async()=>{
  const server=setup(async()=>{throw new Error('request_failed: grade_details_unavailable | GD_FORMAT_MARK_NUMBER_NEG1');});
  server.open();await flush();assert.match(server.body.innerHTML,/\(GD_FORMAT_MARK_NUMBER_NEG1\)/);
  const client=setup(async()=>({groups:[{name:'Lectures',marks:[{date:'2026-11-01',mark:{private:'secret'}}]}]}));
  client.open();await flush();assert.match(client.body.innerHTML,/GD_FORMAT_UI/);assert.match(client.body.innerHTML,/Обнови приложение через профиль/);
  assert.doesNotMatch(client.body.innerHTML,/secret/);
});
test('reset discards late results from an old account and forces a fresh request',async()=>{
  let resolve,calls=0;const ui=setup(()=>{calls++;return new Promise(done=>{resolve=done;});});ui.open();
  ui.api.reset();resolve({groups});await flush();assert.doesNotMatch(ui.body.innerHTML,/02\.10\.2026/);
  ui.open();assert.equal(calls,1);
  ui.api.attach(ui.root,{...ui.context,generation:2});ui.open();assert.equal(calls,2);resolve({groups:[]});await flush();
});
test('group names and teachers are escaped; zero marks remain visible',()=>{
  const ui=setup(async()=>({groups:[]}));
  const html=ui.api.groupsHtml([{name:'<img src=x>',tutor:'<script>',marks:[{date:'2026-09-15',mark:0}]}]);
  assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&lt;img/);assert.match(html,/>0</);
  assert.throws(()=>ui.api.groupsHtml([{marks:[{date:'bad',mark:85}]}]));
});

test('fractional Platonus marks display at most two decimal places',()=>{
  const ui=setup(async()=>({groups:[]}));
  const html=ui.api.groupsHtml([{name:'Лекция',marks:[{date:'2026-10-24',mark:82.85714285714286},{date:'2026-10-25',mark:85}]}]);
  assert.match(html,/>82,86</);assert.match(html,/>85</);assert.doesNotMatch(html,/857142/);
});

test('every lesson group is visible immediately with all its marks on one row',async()=>{
  let calls=0;
  const marks=Array.from({length:9},(_,i)=>({date:`2026-10-${String(i+1).padStart(2,'0')}`,mark:80+i}));
  const ui=setup(async()=>{calls++;return {groups:[{name:'NBD-1-L',marks},{name:'NBD-1-Lab',marks:[{date:'2026-10-20',mark:95}]},{name:'NBD-1-SRSP',marks:[]}]};});
  ui.open();await flush();
  assert.match(ui.body.innerHTML,/Лекции/);assert.match(ui.body.innerHTML,/Лабораторные/);assert.match(ui.body.innerHTML,/СРСП/);
  assert.equal((ui.body.innerHTML.match(/<time /g)||[]).length,10);
  assert.equal((ui.body.innerHTML.match(/<tbody><tr>/g)||[]).length,2);
  assert.match(ui.body.innerHTML,/>88</);assert.match(ui.body.innerHTML,/>95</);
  assert.match(ui.body.innerHTML,/Оценок за контрольные точки пока нет/);
  assert.doesNotMatch(ui.body.innerHTML,/data-grade-group|data-grade-page|grade-point-tabs/);
  ui.open();await flush();assert.equal(calls,1);
});

const calendar = () => ({ studentID:7, gradingPeriods:[{studyYear:2026,term:1,periods:[
  {id:'rk1',start:'2026-09-01',end:'2026-10-24'}, {id:'rk2',start:'2026-10-25',end:'2026-12-12'},
]}] });
const periodGroups = [{name:'WT-Lab', marks:[
  {date:'2026-08-31',mark:11}, {date:'2026-09-01',mark:85}, {date:'2026-10-24',mark:0},
  {date:'2026-10-25',mark:95}, {date:'2026-12-12',mark:77}, {date:'2026-12-13',mark:33},
]}];
test('current RK defaults from calendar dates; switching periods preserves boundary marks and needs no fetch', async () => {
  let calls=0, calendarCalls=0;
  const ui=setup(async()=>{calls++;return {groups:periodGroups};},{calendar:async()=>{calendarCalls++;return calendar();}});
  ui.open(); await flush();
  assert.match(ui.body.innerHTML,/data-grade-period="rk2" aria-pressed="true"/);
  assert.match(ui.body.innerHTML,/25\.10\.2026 — 12\.12\.2026/);
  assert.match(ui.body.innerHTML,/>95</);assert.match(ui.body.innerHTML,/>77</);
  assert.doesNotMatch(ui.body.innerHTML,/>85</);
  ui.choose('rk1');
  assert.match(ui.body.innerHTML,/>85</);assert.match(ui.body.innerHTML,/>0</);
  assert.doesNotMatch(ui.body.innerHTML,/>95</);
  ui.open();await flush();assert.match(ui.body.innerHTML,/data-grade-period="rk1" aria-pressed="true"/);
  ui.choose('all');
  assert.equal((ui.body.innerHTML.match(/<time /g)||[]).length,6);
  assert.match(ui.body.innerHTML,/Вне периодов РК/);assert.match(ui.body.innerHTML,/>11</);assert.match(ui.body.innerHTML,/>33</);
  assert.equal(calls,1);assert.equal(calendarCalls,1);
});

test('RK1 is selected through its last day and an empty RK2 keeps all lesson groups visible', async () => {
  const ui=setup(async()=>({groups:[{name:'WT-L',marks:[{date:'2026-09-10',mark:90}]},{name:'WT-Lab',marks:[]}]}),
    {calendar:async()=>calendar(),now:'2026-10-24T12:00:00Z'});
  ui.open();await flush();assert.match(ui.body.innerHTML,/data-grade-period="rk1" aria-pressed="true"/);
  ui.choose('rk2');assert.match(ui.body.innerHTML,/Лекции/);assert.match(ui.body.innerHTML,/Лабораторные/);
  assert.match(ui.body.innerHTML,/Оценок за контрольные точки пока нет/);assert.doesNotMatch(ui.body.innerHTML,/>90</);
});

test('missing calendar, wrong account or semester, and invalid dates show every mark without guessing', async () => {
  const other=calendar();other.studentID=8;
  const wrongTerm=calendar();wrongTerm.gradingPeriods[0].term=2;
  const bad=calendar();bad.gradingPeriods[0].periods[0].end='2026-02-30';
  for(const data of [{studentID:7},other,wrongTerm,bad,null]) {
    const ui=setup(async()=>({groups:periodGroups}),{calendar:async()=>{if(data===null)throw new Error('offline');return data;}});
    ui.open();await flush();
    assert.match(ui.body.innerHTML,/Не удалось определить границы/);
    assert.equal((ui.body.innerHTML.match(/<time /g)||[]).length,6);
    assert.match(ui.body.innerHTML,/data-grade-period="rk1" aria-pressed="false" disabled/);
  }
});

test('grades are visible while calendar is pending and an explicit All selection survives its response', async () => {
  let finish;
  const ui=setup(async()=>({groups:periodGroups}),{calendar:()=>new Promise(resolve=>{finish=resolve;})});
  ui.open();await flush();assert.match(ui.body.innerHTML,/Определяем периоды/);
  assert.equal((ui.body.innerHTML.match(/<time /g)||[]).length,6);
  ui.choose('all');finish(calendar());await flush();
  assert.match(ui.body.innerHTML,/data-grade-period="all" aria-pressed="true"/);
  assert.equal((ui.body.innerHTML.match(/<time /g)||[]).length,6);
});

test('logout discards a late calendar response', async () => {
  let finish;
  const ui=setup(async()=>({groups:periodGroups}),{calendar:()=>new Promise(resolve=>{finish=resolve;})});
  ui.open();await flush();const before=ui.body.innerHTML;ui.api.reset();finish(calendar());await flush();
  assert.equal(ui.body.innerHTML,before);
});

test('trend sorts dates, combines same-day marks and weights the overall mean by the number of marks', () => {
  const ui=setup(async()=>({groups:[]}));
  const data=ui.api.trendData([{marks:[{date:'2026-10-05',mark:100},{date:'2026-10-01',mark:0}]},
    {marks:[{date:'2026-10-01',mark:80},{date:'2026-10-01',mark:40}]}]);
  assert.equal(data.count,4);assert.equal(data.mean,55);
  assert.equal(data.points[0].date,'2026-10-01');assert.equal(data.points[0].mean,40);assert.equal(data.points[0].count,3);
  assert.equal(data.points[1].mean,100);assert.equal(data.change,60);
});

test('empty and single-date trends have no invented change; invalid dates and marks are rejected', () => {
  const ui=setup(async()=>({groups:[]}));
  const empty=ui.api.trendData([{marks:[]}]);assert.equal(empty.mean,null);assert.equal(empty.change,null);assert.equal(empty.count,0);
  const single=ui.api.trendData([{marks:[{date:'2026-10-01',mark:0}]}]);assert.equal(single.mean,0);assert.equal(single.change,null);
  for(const point of [{date:'2026-02-30',mark:80},{date:'2026-10-01',mark:NaN},{date:'2026-10-01',mark:101},{date:'bad',mark:50}]) {
    assert.throws(()=>ui.api.trendData([{marks:[point]}]),/invalid_point/);
  }
});

test('static semester trend is the fourth view and the other views contain only mark tables', async () => {
  let calls=0;
  const ui=setup(async()=>{calls++;return {groups:periodGroups};},{calendar:async()=>calendar()});
  ui.open();await flush();
  assert.deepEqual([...ui.body.innerHTML.matchAll(/data-grade-period="([^"]+)"/g)].map(match=>match[1]),['rk1','rk2','all','trend']);
  for(const id of ['rk1','rk2','all']) {
    ui.choose(id);assert.doesNotMatch(ui.body.innerHTML,/grade-trend-chart/);assert.match(ui.body.innerHTML,/<table/);
  }
  ui.choose('trend');
  assert.match(ui.body.innerHTML,/Динамика оценок/);assert.match(ui.body.innerHTML,/За весь семестр/);
  assert.equal((ui.body.innerHTML.match(/class="grade-trend-dot"/g)||[]).length,6);
  assert.match(ui.body.innerHTML,/Последняя дата к первой: \+22 б\./);
  assert.match(ui.body.innerHTML,/role="img"/);
  assert.doesNotMatch(ui.body.innerHTML,/role="button"|data-grade-trend-point|grade-trend-selection|<table/);
  assert.equal((ui.body.innerHTML.match(/<button /g)||[]).length,4);
  ui.open();await flush();assert.match(ui.body.innerHTML,/data-grade-period="trend" aria-pressed="true"/);
  assert.equal(calls,1);
});

test('single-day trend has no change and an empty semester has no chart', async () => {
  const ui=setup(async()=>({groups}),{calendar:async()=>calendar(),now:'2026-10-10T12:00:00Z'});
  ui.open();await flush();ui.choose('trend');
  assert.match(ui.body.innerHTML,/Для сравнения нужна ещё одна дата/);
  assert.match(ui.body.innerHTML,/cx="168\.00"/);assert.doesNotMatch(ui.body.innerHTML,/<polyline/);
  assert.match(ui.body.innerHTML,/шкала 0–100/);
  const empty=setup(async()=>({groups:[]}));empty.open();await flush();empty.choose('trend');
  assert.match(empty.body.innerHTML,/пока нет оценок для графика/);assert.doesNotMatch(empty.body.innerHTML,/<svg/);
});

test('trend is available without a calendar and stays selected when a pending calendar resolves', async () => {
  let finish;
  const ui=setup(async()=>({groups:periodGroups}),{calendar:()=>new Promise(resolve=>{finish=resolve;})});
  ui.open();await flush();ui.choose('trend');
  assert.match(ui.body.innerHTML,/grade-trend-chart/);assert.doesNotMatch(ui.body.innerHTML,/Не удалось определить|Определяем периоды/);
  finish(calendar());await flush();assert.match(ui.body.innerHTML,/data-grade-period="trend" aria-pressed="true"/);
  const missing=setup(async()=>({groups:periodGroups}),{calendar:async()=>{throw new Error('offline');}});
  missing.open();await flush();missing.choose('trend');assert.match(missing.body.innerHTML,/grade-trend-chart/);
});

test('attendance renders in RK tables but is excluded from grade counters and trend calculations',async()=>{
  const entries=[{name:'WT-Lab',marks:[{mark:null,status:'absent',date:'2026-09-15'},
    {mark:null,status:'absent',date:'2026-10-30'},{mark:90,date:'2026-10-30'},{mark:0,date:'2026-11-01'},
    {mark:null,status:'absent',date:'2026-12-15'}]}];
  const ui=setup(async()=>({groups:entries}),{calendar:async()=>calendar()});ui.open();await flush();
  assert.match(ui.body.innerHTML,/aria-label="Отсутствие на занятии">н</);
  assert.match(ui.body.innerHTML,/среднее и график эта отметка не входит/);
  assert.match(ui.body.innerHTML,/РК 2<span>2<\/span>/);
  const trend=ui.api.trendData(entries);assert.equal(trend.count,2);assert.equal(trend.mean,45);assert.equal(trend.points.length,2);
  ui.choose('all');assert.equal((ui.body.innerHTML.match(/grade-point-absence/g)||[]).length,3);
  assert.match(ui.body.innerHTML,/Вне периодов РК/);
  ui.choose('trend');assert.match(ui.body.innerHTML,/>45<\/strong>/);
  assert.equal((ui.body.innerHTML.match(/class="grade-trend-dot"/g)||[]).length,2);
});

test('attendance-only subjects remain readable and do not create a numeric grade or trend',async()=>{
  const ui=setup(async()=>({groups:[{name:'WT-Lab',marks:[{mark:null,status:'absent',date:'2026-11-01'}]}]}),{calendar:async()=>calendar()});
  ui.open();await flush();assert.match(ui.body.innerHTML,/>н<\/span>/);assert.doesNotMatch(ui.body.innerHTML,/Оценок за контрольные точки пока нет/);
  ui.choose('trend');assert.match(ui.body.innerHTML,/пока нет оценок для графика/);assert.doesNotMatch(ui.body.innerHTML,/<svg/);
});
