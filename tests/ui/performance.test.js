import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
function storageContext(cloud = true) {
  const local = new Map();
  const calls = [];
  const ctx = vm.createContext({
    tg: cloud ? {
      initData: 'telegram', initDataUnsafe: { user: { id: 42 } },
      isVersionAtLeast: () => true,
      CloudStorage: {
        getItems(keys, cb) { calls.push(keys); cb(null, Object.fromEntries(keys.map(k => [k, 'cloud-value']))); },
        setItem(key, value, cb) { calls.push(key); cb(null); },
        removeItem(key, cb) { calls.push(key); cb(null); },
      },
    } : null,
    localStorage: {
      getItem: key => local.get(key) ?? null,
      setItem: (key, value) => local.set(key, value),
      removeItem: key => local.delete(key),
    },
    setTimeout, clearTimeout,
  });
  const start = app.indexOf('  function useCloudStorage()');
  const end = app.indexOf('  const API_BASE', start);
  vm.runInContext(app.slice(start, end), ctx);
  return { ctx, local, calls };
}

test('warm display data loads without CloudStorage calls', async () => {
  const { ctx, calls } = storageContext();
  await ctx.csSet('platonus_journal_cache', 'journal');
  calls.length = 0;
  assert.equal(await ctx.csGet('platonus_journal_cache'), 'journal');
  assert.equal(calls.length, 0);
});
test('large data survives the CloudStorage value limit locally', async () => {
  const { ctx, calls } = storageContext();
  const large = 'x'.repeat(10000);
  await ctx.csSet('platonus_journal_cache', large);
  assert.equal(await ctx.csGet('platonus_journal_cache'), large);
  assert.equal(calls.length, 0);
});
test('credentials are batched and never mirrored locally in Telegram', async () => {
  const { ctx, local, calls } = storageContext();
  await ctx.csSet('platonus_password', 'secret');
  assert.equal(local.size, 0);
  calls.length = 0;
  const values = await ctx.csGetMany(['platonus_login', 'platonus_password']);
  assert.equal(values.platonus_password, 'cloud-value');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 2);
  assert.equal(local.size, 0);
});
test('removal clears local display data', async () => {
  const { ctx, local } = storageContext();
  await ctx.csSet('platonus_student', 'student');
  await ctx.csRemove('platonus_student');
  assert.equal(local.size, 0);
});
test('browser fallback preserves session storage', async () => {
  const { ctx } = storageContext(false);
  await ctx.csSet('platonus_session', 'session');
  assert.equal(await ctx.csGet('platonus_session'), 'session');
  await ctx.csRemove('platonus_session');
  assert.equal(await ctx.csGet('platonus_session'), null);
});
test('a silent CloudStorage callback cannot hang startup', async () => {
  const { ctx } = storageContext();
  ctx.tg.CloudStorage.getItems = () => {};
  ctx.setTimeout = fn => setTimeout(fn, 1);
  const values = await ctx.csGetMany(['platonus_session']);
  assert.equal(values.platonus_session, undefined);
});
test('parallel expired requests share one relogin', async () => {
  let logins = 0;
  const ctx = vm.createContext({
    API_BASE: '', platonusSession: 'old', authGeneration: 0, authStorageWork: Promise.resolve(),
    sessionCredentials: null, persistLogin: true,
    csGetMany: async () => ({ platonus_login: 'user', platonus_password: 'password' }),
    csSet: async () => {},
    fetch: async () => { logins++; return { ok: true, json: async () => ({ ok: true, session: 'new' }) }; },
  });
  vm.runInContext(app.slice(app.indexOf('  let reloginInFlight'), app.indexOf('  async function platonusFetch')), ctx);
  assert.deepEqual(await Promise.all([ctx.silentRelogin(), ctx.silentRelogin(), ctx.silentRelogin()]), [true, true, true]);
  assert.equal(logins, 1);
});
test('cached studentID lets schedule render while GPA remains pending', async () => {
  let renders = 0;
  const ctx = vm.createContext({
    liveLoadInFlight: false, scheduleLoadFailed: false, authGeneration: 0, ensureAuthGeneration() {},
    platonusStudent: { studentID: 7 }, liveScheduleWeekInfo: { selectedStudyYear: 2026, selectedTerm: 1 },
    currentSection: 'schedule', userNavigatedWeek: false, browsedWeekInfo: null,
    fetchGradesAndUmkd: async () => ({}),
    platonusFetch: path => path === '/api/gpa' ? new Promise(() => {})
      : Promise.resolve({ selectedWeek: 6, selectedTerm: 1, selectedStudyYear: 2026 }),
    buildScheduleEntryFromPlatonus: () => ({ weekInfo: { studyYear: 2026, term: 1, week: 6 }, schedule: {}, lessonTimes: {} }),
    normWeekInfo: x => x, cacheWeekEntry() {}, applyWeekCacheEntry() {},
    detectToday() {}, updateStatusBarAndLive() {}, updateWeekStepperUI() {},
    renderCurrentSection() { renders++; }, saveCachedStudentData() {}, csSet() {}, console,
  });
  vm.runInContext(app.slice(app.indexOf('  async function loadLiveStudentData()'), app.indexOf('  const CITY_COORDS')), ctx);
  await ctx.loadLiveStudentData();
  assert.ok(renders > 0);
  assert.equal(ctx.liveLoadInFlight, false);
});
test('ready grades refresh before the schedule and ignore late data after logout', async () => {
  let completeExtras, completeSchedule, renders = 0;
  const ctx = vm.createContext({
    liveLoadInFlight: false, scheduleLoadFailed: false, authGeneration: 0, ensureAuthGeneration() {},
    platonusStudent: { studentID: 7 }, liveScheduleWeekInfo: { selectedStudyYear: 2026, selectedTerm: 1 },
    currentSection: 'grades', userNavigatedWeek: false, browsedWeekInfo: null,
    liveJournalData: null, liveUmkdData: null,
    fetchGradesAndUmkd: () => new Promise(resolve => { completeExtras = resolve; }),
    platonusFetch: path => path === '/api/gpa' ? new Promise(() => {})
      : new Promise(resolve => { completeSchedule = resolve; }),
    buildScheduleEntryFromPlatonus: () => ({ weekInfo: { studyYear: 2026, term: 1, week: 6 }, schedule: {}, lessonTimes: {} }),
    normWeekInfo: x => x, cacheWeekEntry() {}, applyWeekCacheEntry() {},
    detectToday() {}, updateStatusBarAndLive() {}, updateWeekStepperUI() {},
    renderCurrentSection() { renders++; }, saveCachedStudentData() {}, csSet() {}, console,
  });
  vm.runInContext(app.slice(app.indexOf('  async function loadLiveStudentData()'), app.indexOf('  const CITY_COORDS')), ctx);
  const loading = ctx.loadLiveStudentData();
  for (let n = 0; n < 5; n++) await Promise.resolve();
  completeExtras({ journal: { subjects: ['fresh'] }, umkd: { subjects: [] } });
  for (let n = 0; n < 5; n++) await Promise.resolve();
  assert.equal(ctx.liveJournalData.subjects[0], 'fresh');
  assert.equal(renders, 1);
  ctx.authGeneration++;
  ctx.liveJournalData = null;
  completeSchedule({ selectedWeek: 6, selectedTerm: 1, selectedStudyYear: 2026 });
  await loading;
  assert.equal(ctx.liveJournalData, null);
  assert.equal(renders, 1);
});

test('all inline and standalone JavaScript parses', () => {
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  for (const name of ['appearance.js', 'app.js', 'chat.js', 'background.js', 'sw.js']) new vm.Script(fs.readFileSync(new URL(`../../assets/js/${name}`, import.meta.url), 'utf8'));
});

test('the page references existing local assets in the expected script order', () => {
  const root = new URL('../../', import.meta.url);
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"\s]+)"/g)) {
    assert.ok(fs.existsSync(new URL(match[1], root)), `Missing ${match[1]}`);
  }
  assert.ok(html.indexOf('telegram-web-app.js') < html.indexOf('assets/js/app.js'));
  assert.ok(html.indexOf('assets/js/app.js') < html.indexOf('assets/js/background.js'));
  const background = fs.readFileSync(new URL('../../assets/js/background.js', import.meta.url), 'utf8');
  assert.ok(!background.includes('background.mp4'));
  assert.ok(background.includes("getContext('2d'"));
});

test('the relocated worker retains root scope and caches the complete public shell', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const workerHeaders = config.headers.find(entry => entry.source === '/assets/js/sw.js');
  assert.ok(workerHeaders.headers.some(h => h.key === 'Service-Worker-Allowed' && h.value === '/'));
  assert.ok(app.includes("register('./assets/js/sw.js', { scope: '/' })"));
  const worker = fs.readFileSync(new URL('../../assets/js/sw.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({ self: { addEventListener() {} } });
  vm.runInContext(worker + '\n globalThis.shellPaths = [...SHELL_PATHS];', ctx);
  const assets = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"\s]+)"/g)].map(match => '/' + match[1]);
  for (const path of assets) assert.ok(ctx.shellPaths.includes(path), `Shell cache misses ${path}`);
  assert.ok(ctx.shellPaths.every(path => !path.startsWith('/api/') && !path.endsWith('.mp4')));
});
