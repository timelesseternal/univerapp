import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../assets/js/study-history.js',import.meta.url),'utf8');
function setup(storage = new Map(), blocked = false) {
  let now=1000;
  const ctx=vm.createContext({window:{},Date:class extends Date {static now(){return now;}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(blocked)throw new Error('quota');storage.set(k,v);},removeItem:k=>storage.delete(k)},
    document:{getElementById:()=>null,querySelectorAll:()=>[],addEventListener(){}}});
  vm.runInContext(source,ctx);
  const api=ctx.window.unilinkStudy;
  api.bind({studentID:7},'test');
  return {api,storage,state:()=>JSON.parse(storage.get('test:study-v1:7')),tick(){now+=1000;}};
}
const grade = mark => [{subjectName:'Базы данных',subjectID:9048,exams:[{name:'РК 1',mark}]}];
const entry = (room='423',week=9) => ({cachedAt:1000,weekInfo:{studyYear:2026,term:1,week},lessonTimes:{1:{start:'09:00',end:'10:45'}},
  schedule:{'Вторник':[{пара:'1',sub:'Базы данных',teacher:'Преподаватель',room}]}});
test('initial snapshots and identical refreshes create no notifications; grade changes survive reload',()=>{
  const s=setup();s.api.grades('2026/1',grade('80'));s.api.grades('2026/1',grade('80'));
  assert.equal(s.state().events.length,0);
  s.tick();s.api.grades('2026/1',grade('85'));
  assert.equal(s.state().events[0].before,'80');assert.equal(s.state().events[0].after,'85');
  const reopened=setup(s.storage);assert.equal(reopened.state().events.length,1);
  s.api.grades('2026/1',[]);assert.equal(s.state().events.length,1);
});
test('schedule changes compare the same week, catch room changes and cancellations, and ignore ordering',()=>{
  const s=setup();s.api.schedule(entry());s.api.schedule(entry('423',10));
  assert.equal(s.state().events.length,0);
  s.tick();s.api.schedule(entry('430а'));
  assert.match(s.state().events[0].after,/430а/);
  const empty=entry();empty.schedule.Вторник=[];s.tick();s.api.schedule(empty);
  assert.equal(s.state().events[0].after,'Убрано');
});
test('offline copies retain empty exams, isolate accounts and are removed on deliberate logout',()=>{
  const s=setup();s.api.save({student:{studentID:7},scheduleEntry:entry(),exams:[{subject:'Базы данных'}],examsAt:1000});
  s.api.save({student:{studentID:7},exams:[],examsAt:2000});
  assert.equal(s.api.read().exams.length,0);assert.equal(s.api.read().scheduleEntry.weekInfo.week,9);
  s.api.bind({studentID:8},'test');assert.equal(s.api.read(),null);
  s.api.bind({studentID:7},'test');assert.equal(s.api.read().examsAt,2000);
  s.api.reset(true);s.api.bind({studentID:7},'test');assert.equal(s.api.read(),null);
});
test('offline state never records changes or overwrites saved snapshots; blocked storage stays usable',()=>{
  const s=setup();s.api.grades('2026/1',grade('80'));s.api.offline(true);s.api.grades('2026/1',grade('85'));
  assert.equal(s.state().events.length,0);
  assert.doesNotThrow(()=>setup(new Map(),true).api.schedule(entry()));
});
