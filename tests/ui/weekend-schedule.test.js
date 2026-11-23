import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../assets/js/app.js',import.meta.url),'utf8');
function setup(day,lessons=[]){
  const container={innerHTML:''};
  class Evening extends Date {constructor(){super('2026-11-21T20:00:00+05:00');}getHours(){return 20;}getMinutes(){return 0;}getSeconds(){return 0;}}
  const ctx=vm.createContext({Date:Evening,window:{},document:{getElementById:()=>container},
    SCHEDULE:{[day]:lessons},LESSON_TIMES:{1:{start:'09:00',end:'10:45'}},
    selectedDay:day,realTodayName:day,offlineStudyMode:false,platonusSession:true,
    browsedWeekInfo:{studyYear:2026,term:1,week:12},lastRenderedScreenKey:'',
    isViewingTrueCurrentWeek:()=>true,escapeHtml:value=>String(value),
    getShortDayName:day=>day,timeToMins:time=>{const [h,m]=time.split(':').map(Number);return h*60+m;},
    swapContent:(node,html)=>{node.innerHTML=html;},fillDayOffWeather(){}});
  vm.runInContext(source.slice(source.indexOf('  function dayHasClasses('),source.indexOf('  let currentSection')),ctx);
  vm.runInContext(source.slice(source.indexOf('  function lessonParts('),source.indexOf('  function renderUmkdSubjects(')),ctx);
  return {ctx,container};
}
for(const day of ['Суббота','Воскресенье']){
  test(`${day}: lessons stay visible after the last class ends`,()=>{
    const {ctx,container}=setup(day,[{пара:'1',sub:'Web-технологии',room:'423'}]);
    ctx.renderSchedule(false);
    assert.match(container.innerHTML,/list-row/);
    assert.match(container.innerHTML,/Web-технологии/);
    assert.match(container.innerHTML,/09:00/);
    assert.doesNotMatch(container.innerHTML,/dayOffWeatherDetail/);
  });
}
test('empty Sunday never suggests Monday from the past loaded week',()=>{
  const {ctx,container}=setup('Воскресенье');
  ctx.SCHEDULE.Понедельник=[{пара:'1',sub:'Прошлый понедельник'}];
  ctx.renderSchedule(false);
  assert.match(container.innerHTML,/Сегодня без пар/);
  assert.match(container.innerHTML,/следующую неделю/);
  assert.doesNotMatch(container.innerHTML,/Прошлый понедельник/);
});
test('Saturday can suggest a real Sunday lesson',()=>{
  const {ctx,container}=setup('Суббота');
  ctx.SCHEDULE.Воскресенье=[{пара:'1',sub:'Воскресный предмет'}];
  ctx.renderSchedule(false);
  assert.match(container.innerHTML,/Воскресный предмет/);
});

test('Sunday selection clears the previous today marker',()=>{
  const marked=new Set(['СБ']);
  const ctx=vm.createContext({Date:class extends Date {getDay(){return 0;}},selectedDay:'Суббота',realTodayName:'Суббота',
    getShortDayName:()=> 'ВС',document:{querySelectorAll:()=>[{classList:{remove:()=>marked.delete('СБ')}}],
      getElementById:id=>({classList:{add:()=>marked.add(id.slice(4))}})}});
  vm.runInContext(source.slice(source.indexOf('  const DAY_NAMES_BY_INDEX'),source.indexOf('  function getShortDayName(')),ctx);
  vm.runInContext('detectToday(true);',ctx);
  assert.equal(ctx.selectedDay,'Воскресенье');
  assert.deepEqual([...marked],['ВС']);
});
test('selected day highlight follows actual button geometry with seven columns',()=>{
  const indicator={offsetLeft:3,style:{}};
  const ctx=vm.createContext({document:{querySelector:()=>({offsetLeft:265,offsetTop:4,offsetWidth:40,offsetHeight:48}),
    getElementById:id=>id==='dayIndicator'?indicator:{style:{}}}});
  vm.runInContext(source.slice(source.indexOf('  function updateDayIndicator('),source.indexOf('  function initIndicatorsNoAnim(')),ctx);
  ctx.updateDayIndicator();
  assert.equal(indicator.style.transform,'translateX(262px)');
  assert.equal(indicator.style.top,'4px');
  assert.equal(indicator.style.width,'40px');
});
