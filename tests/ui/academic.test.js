import {installLoading} from '../helpers/loading.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../assets/js/academic.js', import.meta.url), 'utf8');
function setup() {
  const nodes = {};
  for (const kind of ['calendar', 'transcript']) nodes[`${kind}Container`] = { innerHTML: '', dataset: {}, querySelectorAll: () => [], querySelector: () => null };
  const context = vm.createContext({ window: {}, document: { getElementById: id => nodes[id] }, Date });
  installLoading(context);
  vm.runInContext(source, context);
  return { api: context.window.univerAcademic, nodes };
}
const data = id => ({ studentID: id, year: '2026–2027', semesters: [{ name: 'Осенний семестр', groups: [{ name: 'Сессия', rows: [{ label: 'Сессия', value: '14 декабря–2 января' }] }] }] });

test('transcript opens the current course and term rather than the final future period',async()=>{
  for(const term of [1,2]){
    const ui=setup();
    const periods=[1,2,3].flatMap(course=>[1,2].map(term=>({course,term,rows:[],gpa:0,courseGpa:0})));
    await ui.api.open('transcript',{student:{studentID:7},currentPeriod:{course:3,term},fetch:async()=>({studentID:7,periods})});
    const html=ui.nodes.transcriptContainer.innerHTML;
    const opened=[...html.matchAll(/<details[^>]*\sopen><summary><span>([^<]+)/g)].map(match=>match[1]);
    assert.deepEqual(opened,[`3 курс · ${term} семестр`]);
  }
});

test('an unknown current period never defaults to a future semester',async()=>{
  const ui=setup();
  await ui.api.open('transcript',{student:{studentID:7},fetch:async()=>({studentID:7,periods:[{course:3,term:2,rows:[]}]})});
  assert.doesNotMatch(ui.nodes.transcriptContainer.innerHTML,/<details[^>]*\sopen>/);
});
test('academic screen shares in-flight loads and reuses the warm account cache', async () => {
  const ui = setup(); let calls = 0, resolve;
  const waiting = new Promise(r => { resolve = r; });
  const options = { student: { studentID: 7 }, fetch: () => { calls++; return waiting; } };
  const first = ui.api.open('calendar', options), second = ui.api.open('calendar', options);
  assert.equal(calls, 1); resolve(data(7)); await Promise.all([first, second]);
  assert.match(ui.nodes.calendarContainer.innerHTML, /14 декабря/);
  let replacements = 0;
  const rendered = ui.nodes.calendarContainer.innerHTML;
  Object.defineProperty(ui.nodes.calendarContainer, 'innerHTML', { get: () => rendered, set: () => { replacements++; } });
  await ui.api.open('calendar', options); assert.equal(calls, 1);
  assert.equal(replacements, 0, 'warm reopening preserves the existing DOM');
});
test('an off-screen response is cached and rendered on reopening without another request', async () => {
  const ui = setup(); let resolve, calls = 0;
  const options = { student: { studentID: 7 }, fetch: () => { calls++; return new Promise(r => { resolve = r; }); } };
  const load = ui.api.open('calendar', options); ui.api.onSection('profile'); resolve(data(7)); await load;
  assert.match(ui.nodes.calendarContainer.innerHTML, /content-loading/);
  await ui.api.open('calendar', options); assert.match(ui.nodes.calendarContainer.innerHTML, /14 декабря/); assert.equal(calls, 1);
});
test('logout prevents old responses from painting or warming the next session', async () => {
  const ui = setup(); let resolve;
  const old = ui.api.open('calendar', { student: { studentID: 7 }, fetch: () => new Promise(r => { resolve = r; }) });
  ui.api.reset(); resolve(data(7)); await old; assert.equal(ui.nodes.calendarContainer.innerHTML, '');
  let calls = 0; await ui.api.open('calendar', { student: { studentID: 8 }, fetch: async () => { calls++; return data(8); } });
  assert.equal(calls, 1); assert.match(ui.nodes.calendarContainer.innerHTML, /Осенний семестр/);
});
test('document text is escaped before insertion', async () => {
  const ui = setup(), calendar = data(7); calendar.semesters[0].name = '<img src=x onerror=alert(1)>';
  await ui.api.open('calendar', { student: { studentID: 7 }, fetch: async () => calendar });
  assert.ok(ui.nodes.calendarContainer.innerHTML.includes('&lt;img'));
  assert.equal(ui.nodes.calendarContainer.innerHTML.includes('<img'), false);
});

test('prefetch warms both documents without opening a screen, then opening reuses the data',async()=>{
  const ui=setup(),calls=[];
  const options={student:{studentID:7},fetch:async path=>{calls.push(path);return path.endsWith('calendar')?data(7):{studentID:7,periods:[]};}};
  await ui.api.prefetch(options);
  assert.deepEqual(calls,['/api/calendar','/api/transcript']);
  assert.equal(ui.nodes.calendarContainer.innerHTML,'');assert.equal(ui.nodes.transcriptContainer.innerHTML,'');
  await ui.api.open('calendar',options);await ui.api.open('transcript',options);
  assert.equal(calls.length,2);assert.match(ui.nodes.calendarContainer.innerHTML,/Осенний семестр/);
  assert.doesNotMatch(ui.nodes.transcriptContainer.innerHTML,/content-loading/);
});

test('opening during prefetch shares the in-flight request and shows only the profile-style indicator',async()=>{
  const ui=setup();let finish,calls=0;
  const options={student:{studentID:7},fetch:path=>{
    calls++;return path.endsWith('calendar')?new Promise(resolve=>{finish=resolve;}):Promise.resolve({studentID:7,periods:[]});
  }};
  const warm=ui.api.prefetch(options),opening=ui.api.open('calendar',options);
  assert.equal(calls,2);assert.match(ui.nodes.calendarContainer.innerHTML,/content-loading-arrow/);
  assert.doesNotMatch(ui.nodes.calendarContainer.innerHTML,/Загружаем из Platonus|academic-loading/);
  finish(data(7));await Promise.all([warm,opening]);assert.equal(calls,2);
  assert.match(ui.nodes.calendarContainer.innerHTML,/Осенний семестр/);
});

test('failed prefetch is silent, leaves the other document usable and allows a later retry',async()=>{
  const ui=setup();let fail=true,calls=0;
  const options={student:{studentID:7},fetch:async path=>{
    calls++;if(path.endsWith('calendar')){if(fail)throw new Error('offline');return data(7);}
    return {studentID:7,periods:[]};
  }};
  await ui.api.prefetch(options);assert.equal(ui.nodes.calendarContainer.innerHTML,'');
  await ui.api.open('transcript',options);assert.equal(calls,2);
  fail=false;await ui.api.open('calendar',options);assert.equal(calls,3);
  assert.match(ui.nodes.calendarContainer.innerHTML,/Осенний семестр/);
});

test('logout invalidates prefetched responses and the next account cannot reuse them',async()=>{
  const ui=setup(),finish=[];
  const old=ui.api.prefetch({student:{studentID:7},fetch:()=>new Promise(resolve=>finish.push(resolve))});
  ui.api.reset();finish[0](data(7));finish[1]({studentID:7,periods:[]});await old;
  let calls=0;await ui.api.open('calendar',{student:{studentID:8},fetch:async()=>{calls++;return data(8);}});
  assert.equal(calls,1);assert.match(ui.nodes.calendarContainer.innerHTML,/Осенний семестр/);
});
