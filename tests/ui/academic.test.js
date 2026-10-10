import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../assets/js/academic.js', import.meta.url), 'utf8');
function setup() {
  const nodes = {};
  for (const kind of ['calendar', 'transcript']) nodes[`${kind}Container`] = { innerHTML: '', dataset: {}, querySelectorAll: () => [], querySelector: () => null };
  const context = vm.createContext({ window: {}, document: { getElementById: id => nodes[id] }, Date });
  vm.runInContext(source, context);
  return { api: context.window.univerAcademic, nodes };
}
const data = id => ({ studentID: id, year: '2026–2027', semesters: [{ name: 'Осенний семестр', groups: [{ name: 'Сессия', rows: [{ label: 'Сессия', value: '14 декабря–2 января' }] }] }] });
test('academic screen shares in-flight loads and reuses the warm account cache', async () => {
  const ui = setup(); let calls = 0, resolve;
  const waiting = new Promise(r => { resolve = r; });
  const options = { student: { studentID: 7 }, fetch: () => { calls++; return waiting; } };
  const first = ui.api.open('calendar', options), second = ui.api.open('calendar', options);
  assert.equal(calls, 1); resolve(data(7)); await Promise.all([first, second]);
  assert.match(ui.nodes.calendarContainer.innerHTML, /14 декабря/);
  await ui.api.open('calendar', options); assert.equal(calls, 1);
});
test('an off-screen response is cached and rendered on reopening without another request', async () => {
  const ui = setup(); let resolve, calls = 0;
  const options = { student: { studentID: 7 }, fetch: () => { calls++; return new Promise(r => { resolve = r; }); } };
  const load = ui.api.open('calendar', options); ui.api.onSection('profile'); resolve(data(7)); await load;
  assert.match(ui.nodes.calendarContainer.innerHTML, /Загружаем/);
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
