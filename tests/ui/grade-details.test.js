import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {installLoading} from '../helpers/loading.js';
const source=readFileSync(new URL('../../assets/js/grade-details.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(fetch) {
  const ctx=vm.createContext({window:{}});installLoading(ctx);vm.runInContext(source,ctx);
  const api=ctx.window.unilinkGradeDetails;
  const body={innerHTML:'',isConnected:true,querySelector:()=>({addEventListener(){}})};
  const details={open:true,dataset:{gradeIndex:'0'},querySelector:()=>body,matches:()=>true};
  const root={addEventListener(){},removeEventListener(){},querySelectorAll:()=>[details]};
  const context={studentID:7,generation:1,year:2026,term:1,subjects:[{subjectID:9048,queryID:253432,studyGroupId:45903}],fetch};
  api.attach(root,context);
  return {api,body,details,root,context,open(){root.gradeDetailsToggle({target:details});}};
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
