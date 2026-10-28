import {installLoading} from '../helpers/loading.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../assets/js/app.js',import.meta.url),'utf8');
function setup(fetch){
  const element={innerHTML:''};
  const ctx=vm.createContext({navigator:{onLine:true},offlineStudyMode:false,saveCachedStudentData(){},authGeneration:1,currentSection:'exams',platonusFetch:fetch,
    document:{getElementById:()=>element},swapContent:(el,html)=>{el.innerHTML=html;}});
  installLoading(ctx);
  vm.runInContext(source.slice(source.indexOf('  function escapeHtml('),source.indexOf('  function studentGroup(')),ctx);
  vm.runInContext(source.slice(source.indexOf('  let EXAMS_SCHEDULE'),source.indexOf('  let restoringLogin')),ctx);
  return {ctx,element};
}
test('exams show loading first and share a request; confirmed data is reused',async()=>{
  let finish,calls=0;
  const ui=setup(async path=>{assert.equal(path,'/api/exams');calls++;return new Promise(resolve=>{finish=resolve;});});
  ui.ctx.renderExams(false);assert.match(ui.element.innerHTML,/content-loading/);assert.doesNotMatch(ui.element.innerHTML,/notice-panel/);
  const first=ui.ctx.fetchExams(),second=ui.ctx.fetchExams();assert.equal(first,second);
  finish({exams:[]});await first;assert.match(ui.element.innerHTML,/пока пусто/);
  await ui.ctx.fetchExams();assert.equal(calls,1);
});
test('exams sort by calendar dates, escape server text and preserve saved cards on refresh failure',async()=>{
  let fail=false;
  const ui=setup(async()=>{if(fail)throw new Error('offline');return {exams:[
    {subject:'Второй',date:'02.01.2027',time:'10:00',room:'423'},
    {subject:'<img src=x>',date:'12.12.2026',time:'09:00',room:'<script>'}]};});
  await ui.ctx.fetchExams();assert.ok(ui.element.innerHTML.indexOf('&lt;img')<ui.element.innerHTML.indexOf('Второй'));
  assert.doesNotMatch(ui.element.innerHTML,/<img|<script/);assert.match(ui.element.innerHTML,/&lt;script&gt;/);
  fail=true;await ui.ctx.fetchExams(true);assert.match(ui.element.innerHTML,/Не удалось обновить/);assert.match(ui.element.innerHTML,/Второй/);
});
test('late exam responses from a previous account are discarded',async()=>{
  let finish;const ui=setup(()=>new Promise(resolve=>{finish=resolve;}));
  const work=ui.ctx.fetchExams();ui.ctx.authGeneration++;
  finish({exams:[{subject:'Чужие данные'}]});await work;
  ui.ctx.renderExams(false);assert.doesNotMatch(ui.element.innerHTML,/Чужие данные/);
});
