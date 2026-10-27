import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../../assets/js/schedule-share.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup({supported = true, share = async () => {}, deferred = false, model} = {}) {
  const nodes = new Map(), drawn = [], encodings = [], revoked = [];
  function element(id) {
    return {id, checked: false, disabled: false, hidden: false, events: {},
      addEventListener(type, callback) {this.events[type] = callback;},
      setAttribute() {}, removeAttribute(name) {delete this[name];},
      showModal() {this.open = true;}, close() {this.open = false; this.events.close?.();},
      click() {return this.events.click?.();}, remove() {}};
  }
  const context = {font: '', measureText: text => ({width: [...text].length * 19}),
    createLinearGradient: () => ({addColorStop() {}}), fillRect() {},
    fillText(text) {drawn.push(text);}};
  const document = {getElementById(id) {if (!nodes.has(id)) nodes.set(id, element(id)); return nodes.get(id);},
    documentElement: {}, body: {append() {}},
    createElement(tag) {return tag === 'canvas' ? {getContext: () => context,
      toBlob(callback) {if (deferred) encodings.push(callback); else callback(new Blob(['png'], {type: 'image/png'}));}}
      : element(tag);}};
  const snapshot = model === undefined ? {day:'Вторник', week:9, year:2026, term:1, group:'ИТ-23', lessons:[
    {name:'Очень длинная дисциплина '.repeat(9), type:'Лабораторная', room:'Корпус 1, ауд. 430а', teacher:'Преподаватель', start:'09:00',end:'10:45'}]} : model;
  const ctx = vm.createContext({document, window:{getScheduleShareSnapshot: () => snapshot},
    navigator:{share, canShare: () => supported}, Blob, File, setTimeout,
    URL:{createObjectURL: () => 'blob:preview',revokeObjectURL: url => revoked.push(url)},
    getComputedStyle: () => ({getPropertyValue: () => '#000000'})});
  vm.runInContext(source, ctx);
  return {nodes, drawn, encodings, revoked, api:ctx.window.unilinkScheduleShare,
    async open() {document.getElementById('scheduleShareLaunch').click(); await flush();}};
}
test('PNG layout wraps long subjects, preserves times and only includes teachers when requested', () => {
  const s = setup();
  const model = {day:'Вторник',week:9,year:2026,term:1,group:'ИТ-23',lessons:[
    {name:'Дисциплина'.repeat(90),teacher:'Учитель',start:'09:00',end:'10:45',room:'423'}]};
  const canvas = s.api.card(model, false);
  assert.equal(canvas.width,900); assert.ok(canvas.height > 1000);
  assert.ok(s.drawn.includes('09:00')); assert.ok(!s.drawn.includes('Учитель'));
  s.api.card(model,true); assert.ok(s.drawn.includes('Учитель'));
  const lines=s.api.wrap({measureText:s=>({width:s.length})},'ABCDEFGHIJKLMNOPQRSTUVWXYZ',6);
  assert.equal(lines.join(''),'ABCDEFGHIJKLMNOPQRSTUVWXYZ'); assert.ok(lines.every(line=>line.length<=6));
});
test('share receives the prebuilt PNG synchronously in the click handler; cancellation is quiet', async () => {
  let received;
  const s=setup({share:data=>{received=data;return Promise.reject(Object.assign(new Error(),{name:'AbortError'}));}});
  await s.open();
  const promise=s.nodes.get('scheduleShareSend').click();
  assert.equal(received.files[0].type,'image/png');
  assert.match(received.files[0].name,/week-9/);
  await promise;
  assert.doesNotMatch(s.nodes.get('scheduleShareStatus').textContent,/Не удалось/);
});
test('unsupported file sharing offers PNG download and image fallback', async () => {
  const s=setup({supported:false}); await s.open();
  assert.equal(s.nodes.get('scheduleShareSend').disabled,true);
  assert.equal(s.nodes.get('scheduleShareSave').disabled,false);
  assert.equal(s.nodes.get('scheduleShareOpen').hidden,false);
  assert.equal(s.nodes.get('scheduleShareOpen').href,'blob:preview');
});
test('closing during PNG encoding discards late private image results',async()=>{
  const s=setup({deferred:true}); await s.open();
  s.nodes.get('scheduleShareClose').click();
  s.encodings[0](new Blob(['png'])); await flush();
  assert.equal(s.nodes.get('scheduleShareImage').src,undefined);
  assert.equal(s.nodes.get('scheduleShareSave').disabled,true);
});
test('unloaded week cannot be exported as an empty day',async()=>{
  const s=setup({model:null}); await s.open();
  assert.equal(s.nodes.get('scheduleShareSave').disabled,true);
  assert.match(s.nodes.get('scheduleShareStatus').textContent,/Дождись загрузки/);
});
test('snapshot uses the selected day and browsed week, sorts lessons and blocks week transitions',()=>{
  const app=readFileSync(new URL('../../assets/js/app.js',import.meta.url),'utf8');
  const getter=app.slice(app.indexOf('  function getScheduleShareSnapshot()'),app.indexOf('  function lessonTitleHtml'));
  const ctx=vm.createContext({platonusSession:true,browsedWeekInfo:{week:8,studyYear:2026,term:1},weekStepBusy:false,
    selectedDay:'Среда',SCHEDULE:{'Вторник':[{пара:1,sub:'Другой день'}],'Среда':[{пара:3,sub:'Третья'},{пара:1,sub:'Первая'}]},
    LESSON_TIMES:{1:{start:'09:00',end:'10:45'},3:{start:'13:10',end:'14:55'}},platonusStudent:{},
    studentGroup:()=> 'ИТ-23',lessonParts:item=>({name:item.sub,type:''}),formatRoomLabel:()=> 'Ауд. 423'});
  vm.runInContext(getter,ctx);
  const snapshot=vm.runInContext('getScheduleShareSnapshot()',ctx);
  assert.equal(snapshot.week,8);assert.equal(snapshot.day,'Среда');
  assert.deepEqual(Array.from(snapshot.lessons,lesson=>lesson.name),['Первая','Третья']);
  assert.equal(snapshot.lessons[1].start,'13:10');
  ctx.weekStepBusy=true;assert.equal(vm.runInContext('getScheduleShareSnapshot()',ctx),null);
});
