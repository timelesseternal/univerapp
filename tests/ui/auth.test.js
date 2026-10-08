import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
function setup() {
  const elements = new Map(), timers = new Map(), removed = [];
  let timerID = 0, loads = 0;
  function element() {
    const classes = new Set();
    return {
      style: {}, value: '', type: 'text', disabled: false, innerHTML: '', textContent: '',
      classList: {
        add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
        toggle(name, state) { if (state) classes.add(name); else classes.delete(name); },
      },
      setAttribute() {},
    };
  }
  const document = {
    body: element(),
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    querySelectorAll: () => [],
  };
  const ctx = vm.createContext({
    document, window: {}, localStorage: { removeItem() {} },
    lsSafe: fn => fn(), localCacheKey: key => key, useCloudStorage: () => false,
    csRemove: async key => { removed.push(key); }, csSet: async () => {},
    csGetMany: async () => ({ platonus_login: 'user', platonus_password: 'password' }),
    haptic() {}, closeUmkdFile() {}, switchSection() {}, updateWeekStepperUI() {},
    initIndicatorsNoAnim() {}, initTabIndicatorNoAnim() {}, requestAnimationFrame() {},
    loadLiveStudentData() { loads++; },
    SCHEDULE: {}, LESSON_TIMES: {}, browsedWeekInfo: null, trueCurrentWeekInfo: null,
    trueCurrentSchedule: {}, trueCurrentLessonTimes: {}, weekStepBusy: false,
    selectedUmkdSubject: null, lastRenderedScreenKey: '',
    setTimeout: fn => { timers.set(++timerID, fn); return timerID; },
    clearTimeout: id => timers.delete(id),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, session: 'new' }) }),
  });
  vm.runInContext(app.slice(app.indexOf('  const API_BASE'), app.indexOf('  const PLT_DAY_NAMES')), ctx);
  vm.runInContext("platonusSession = 'old'; platonusStudent = { studentID: 1 };", ctx);
  return {
    ctx, document, elements, removed,
    read: expression => vm.runInContext(expression, ctx),
    flushTimers() { for (const fn of [...timers.values()]) fn(); timers.clear(); },
    get loads() { return loads; },
  };
}

test('logout restores the login screen and cancels its old hide timer', () => {
  const env = setup();
  env.ctx.showLoginOverlay(false);
  env.ctx.logout();
  env.flushTimers();
  assert.equal(env.document.getElementById('loginOverlay').style.display, 'flex');
  assert.ok(!env.document.getElementById('loginOverlay').classList.contains('hidden'));
  assert.ok(env.document.body.classList.contains('login-screen'));
  assert.equal(env.read('platonusSession'), null);
  assert.equal(env.read('platonusStudent'), null);
  assert.equal(env.document.getElementById('loginSubmitBtn').disabled, false);
  assert.equal(env.document.getElementById('passwordInput').type, 'password');
});

test('a late response from the old account is discarded', async () => {
  const env = setup();
  let resolve;
  env.ctx.fetch = () => new Promise(done => { resolve = done; });
  const request = env.ctx.platonusFetch('/api/gpa');
  env.ctx.logout();
  resolve({ ok: true, status: 200, json: async () => ({ studentID: 1 }) });
  await assert.rejects(request, /session_changed/);
  assert.equal(env.read('platonusStudent'), null);
});

test('a late 401 cannot trigger a relogin after deliberate logout', async () => {
  const env = setup();
  let resolve, calls = 0;
  env.ctx.fetch = () => { calls++; return new Promise(done => { resolve = done; }); };
  const request = env.ctx.platonusFetch('/api/gpa');
  env.ctx.logout();
  resolve({ ok: false, status: 401 });
  await assert.rejects(request, /session_changed/);
  assert.equal(calls, 1);
});

test('an unfinished silent relogin cannot restore a signed-out session', async () => {
  const env = setup();
  let resolve;
  env.ctx.fetch = () => new Promise(done => { resolve = done; });
  const request = env.ctx.silentRelogin();
  await new Promise(setImmediate);
  env.ctx.logout();
  resolve({ ok: true, json: async () => ({ ok: true, session: 'obsolete' }) });
  assert.equal(await request, false);
  assert.equal(env.read('platonusSession'), null);
});

test('signing in again waits for old credential cleanup and opens the application', async () => {
  const env = setup();
  let completeWrite, fetches = 0;
  env.ctx.oldWrite = new Promise(done => { completeWrite = done; });
  vm.runInContext('authStorageWork = oldWrite;', env.ctx);
  env.ctx.logout();
  env.document.getElementById('loginInput').value = 'user';
  env.document.getElementById('passwordInput').value = 'password';
  env.ctx.fetch = async () => { fetches++; return { ok: true, json: async () => ({ ok: true, session: 'new' }) }; };
  const request = env.ctx.submitLogin();
  assert.equal(fetches, 0);
  completeWrite();
  await request;
  assert.ok(env.removed.includes('platonus_session'));
  assert.equal(env.read('platonusSession'), 'new');
  assert.equal(fetches, 1);
  assert.equal(env.loads, 1);
  assert.ok(!env.document.body.classList.contains('login-screen'));
});
