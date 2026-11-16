import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../assets/js/schedule-dates.js',import.meta.url),'utf8');
function setup(){
  const nodes=new Map();
  function element(){return {children:[],textContent:'',setAttribute(){},replaceChildren(...children){this.children=children;},append(child){this.children.push(child);},querySelector(){return null;}};}
  const ctx=vm.createContext({window:{},document:{createElement:element,getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}}});
  vm.runInContext(source,ctx);return {api:ctx.window.unilinkScheduleDates,nodes};
}
test('calendar start anchors week twelve and handles year boundaries without using the current day',()=>{
  const {api}=setup();
  assert.deepEqual(Array.from(api.dates('2026-09-01',12),date=>date.toISOString().slice(0,10)),['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21','2026-11-22']);
  assert.equal(api.dates('2026-12-30',2)[0].toISOString().slice(0,10),'2027-01-04');
  assert.equal(api.dates('2026-02-30',1),null);assert.equal(api.dates('2026-09-01',0),null);
});
test('late calendar results cannot paint the previous week and calendars are isolated by student',async()=>{
  const {api,nodes}=setup();let resolve,calls=0;
  const calendar=()=>{calls++;return new Promise(done=>{resolve=done;});};
  const request=week=>({student:{studentID:7},weekInfo:{studyYear:2026,term:1,week},calendar});
  const old=api.render(request(11));const current=api.render(request(12));await Promise.resolve();
  resolve({studentID:7,gradingPeriods:[{studyYear:2026,term:1,periods:[{start:'2026-09-01'}]}]});
  await Promise.all([old,current]);assert.equal(calls,1);
  assert.equal(nodes.get('btn-ПН').children[1].textContent,'16');
  assert.equal(nodes.get('weekStepLabel').children.at(-1).textContent,'16.11–22.11');
  await api.render({...request(12),student:{studentID:8},calendar:async()=>({studentID:7})});
  assert.equal(nodes.get('btn-ПН').children[1].textContent,'—');
});
