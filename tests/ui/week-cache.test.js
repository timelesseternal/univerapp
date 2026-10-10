import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
function setup() {
  const storage = new Map();
  const context = vm.createContext({
    platonusStudent: { studentID: 7 }, weekScheduleCache: {}, trueCurrentWeekInfo: null,
    window: {}, normWeekInfo: value => value,
    csSet: async (key, value) => storage.set(key, value), csGet: async key => storage.get(key),
  });
  vm.runInContext(app.slice(app.indexOf('  function weekCacheKey('), app.indexOf('  function applyWeekCacheEntry(')), context);
  return { context, storage };
}
const entry = () => ({ weekInfo: { studyYear: 2026, term: 1, week: 7 }, lessonTimes: {}, schedule: { Понедельник: [] } });

test('a confirmed empty week overwrites a previously saved lesson', async () => {
  const { context, storage } = setup();
  const old = entry(); old.schedule.Понедельник.push({ sub: 'Старая пара' });
  context.cacheWeekEntry(old); context.cacheWeekEntry(entry());
  assert.deepEqual(JSON.parse(storage.get('platonus_week_7-2026-1-7')).schedule.Понедельник, []);
  assert.ok(await context.loadPersistedWeekEntry('7-2026-1-7'));
});

test('broken or mismatched cached weeks are ignored', async () => {
  const { context, storage } = setup();
  for (const invalid of ['not JSON', 'null', JSON.stringify({ ...entry(), schedule: { Понедельник: {} } }), JSON.stringify({ ...entry(), weekInfo: { studyYear: 2026, term: 1, week: 8 } })]) {
    storage.set('platonus_week_7-2026-1-7', invalid);
    assert.equal(await context.loadPersistedWeekEntry('7-2026-1-7'), null);
  }
});
