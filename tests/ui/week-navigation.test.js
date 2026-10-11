import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const info = week => ({ studyYear: 2026, term: 1, week });
const oldWeek = () => ({ weekInfo: info(8), lessonTimes: { 1: { start: '08:00', end: '09:50' } },
  schedule: { Понедельник: [{ пара: '1', sub: 'Старая пара', type: 0 }] } });
const emptyResponse = () => ({ selectedStudyYear: 2026, selectedTerm: 1, selectedWeek: 8, timetable: { days: {} } });
function setup() {
  const storage = new Map(), views = [], calls = [], elements = new Map();
  const context = vm.createContext({
    platonusStudent: { studentID: 7 }, weekScheduleCache: {}, trueCurrentWeekInfo: null,
    browsedWeekInfo: info(7), SCHEDULE: {}, LESSON_TIMES: {}, liveScheduleWeekInfo: null,
    userNavigatedWeek: false, weekStepBusy: false, authGeneration: 1, MAX_TERM_WEEKS: 15, window: {},
    csGet: async key => storage.get(key), csSet: async (key, value) => storage.set(key, value),
    platonusFetch: async path => { calls.push(path); return emptyResponse(); },
    haptic() {}, detectToday() {}, updateStatusBarAndLive() {}, saveCachedStudentData() {}, isViewingTrueCurrentWeek: () => false,
    renderSchedule() { views.push(JSON.parse(JSON.stringify(context.SCHEDULE))); },
    console: { error() {} },
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { disabled: false, classList: { toggle() {} } });
      return elements.get(id);
    } },
  });
  vm.runInContext(app.slice(app.indexOf('  function normWeekInfo('), app.indexOf('  // ============ КЭШ ДАННЫХ')), context);
  vm.runInContext(app.slice(app.indexOf('  const PLT_DAY_NAMES'), app.indexOf('  function orderGradeMetrics(')), context);
  vm.runInContext(app.slice(app.indexOf('  function updateWeekStepperUI('), app.indexOf('  function updateStatusBarAndLive(')), context);
  return { context, storage, views, calls, elements };
}

test('rapid week taps share the storage lookup and restore the stepper after a network failure', async () => {
  const ui = setup(); let finishStorage, lookups = 0;
  ui.context.csGet = () => { lookups++; return new Promise(resolve => { finishStorage = resolve; }); };
  ui.context.platonusFetch = async path => { ui.calls.push(path); throw new DOMException('timeout', 'TimeoutError'); };
  const first = ui.context.stepWeek(1); await ui.context.stepWeek(1);
  assert.equal(lookups, 1); assert.equal(ui.context.weekStepBusy, true);
  assert.equal(ui.elements.get('weekNextBtn').disabled, true);
  finishStorage(null); await first;
  assert.equal(ui.calls.length, 1); assert.equal(ui.context.weekStepBusy, false);
  assert.equal(ui.elements.get('weekNextBtn').disabled, false);
  assert.equal(ui.context.browsedWeekInfo.week, 7);
});

test('logout during storage lookup prevents old cached data from reaching the new account', async () => {
  const ui = setup(); let finishStorage;
  ui.context.csGet = () => new Promise(resolve => { finishStorage = resolve; });
  const first = ui.context.stepWeek(1);
  // The application logout increments the generation and resets this lock.
  ui.context.authGeneration++; ui.context.platonusStudent = { studentID: 8 }; ui.context.weekStepBusy = false;
  finishStorage(JSON.stringify(oldWeek())); await first;
  assert.equal(ui.views.length, 0); assert.equal(ui.calls.length, 0);
  assert.deepEqual(Object.keys(ui.context.weekScheduleCache), []);
  assert.equal(ui.context.weekStepBusy, false);
});

test('a malformed saved week falls back to the network instead of rendering invalid lessons', async () => {
  const ui = setup();
  ui.storage.set('platonus_week_7-2026-1-8', JSON.stringify({ ...oldWeek(), schedule: { Понедельник: [null] } }));
  await ui.context.stepWeek(1);
  assert.equal(ui.calls.length, 1); assert.deepEqual(ui.views, [{}]);
  assert.equal(ui.context.weekStepBusy, false);
});

test('only a successful empty refresh replaces cached lessons on screen and disk', async () => {
  for (const fails of [true, false]) {
    const ui = setup(); const key = 'platonus_week_7-2026-1-8';
    ui.storage.set(key, JSON.stringify(oldWeek()));
    let finishRefresh;
    ui.context.platonusFetch = () => new Promise((resolve, reject) => {
      finishRefresh = () => fails ? reject(new Error('platonus_unreachable')) : resolve(emptyResponse());
    });
    await ui.context.stepWeek(1);
    assert.equal(ui.views[0].Понедельник[0].sub, 'Старая пара');
    finishRefresh(); await new Promise(setImmediate);
    if (fails) {
      assert.equal(ui.views.length, 1);
      assert.equal(JSON.parse(ui.storage.get(key)).schedule.Понедельник[0].sub, 'Старая пара');
    } else {
      assert.deepEqual(ui.views.at(-1), {});
      assert.deepEqual(JSON.parse(ui.storage.get(key)).schedule, {});
    }
    assert.equal(ui.context.weekStepBusy, false);
  }
});
