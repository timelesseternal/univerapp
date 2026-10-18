import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
function setup() {
  const elements = new Map(), timers = new Map(), removed = [], written = [];
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
    document, window: {}, AbortSignal, localStorage: { removeItem() {} },
    lsSafe: fn => fn(), localCacheKey: key => key, useCloudStorage: () => false,
    csRemove: async key => { removed.push(key); }, csSet: async (key,value) => { written.push([key,value]); },
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
    ctx, document, elements, removed, written,
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

test('renewed Platonus requests get fresh deadlines and preserve the new session on timeout', async () => {
  const env = setup(); const deadlines = [], calls = [];
  env.ctx.AbortSignal = { timeout(duration) {
    const controller = new AbortController(); deadlines.push({ controller, duration }); return controller.signal;
  } };
  env.ctx.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/session') return { ok: true, json: async () => ({ ok: true, session: 'new' }) };
    if (calls.length === 1) return { ok: false, status: 401 };
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  };
  const request = env.ctx.platonusFetch('/api/schedule');
  const rejection = assert.rejects(request, error => error.name === 'TimeoutError');
  await new Promise(setImmediate);
  assert.deepEqual(deadlines.map(item => item.duration), [35000, 20000, 35000]);
  assert.notEqual(calls[0].options.signal, calls[2].options.signal);
  assert.equal(calls[2].options.credentials, 'same-origin');
  assert.equal(calls[2].options.headers, undefined);
  deadlines[2].controller.abort(new DOMException('timeout', 'TimeoutError')); await rejection;
  assert.equal(env.read('platonusSession'), 'cookie');
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
  env.ctx.fetch = (url, options) => { if (options?.method === 'DELETE') return Promise.resolve({ok:true}); calls++; return new Promise(done => { resolve = done; }); };
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
  env.ctx.fetch = async (url, options) => { if (options?.method === 'DELETE') return {ok:true}; fetches++; return { ok: true, json: async () => ({ ok: true, session: 'new' }) }; };
  const request = env.ctx.submitLogin();
  assert.equal(fetches, 0);
  completeWrite();
  await request;
  assert.ok(env.removed.includes('platonus_session'));
  assert.equal(env.read('platonusSession'), 'cookie');
  assert.equal(fetches, 1);
  assert.equal(env.loads, 1);
  assert.ok(!env.document.body.classList.contains('login-screen'));
});

test('remember me never writes credentials or session to browser storage', async () => {
  const env = setup();
  env.document.getElementById('rememberLoginInput').checked = true;
  env.document.getElementById('loginInput').value = 'user';
  env.document.getElementById('passwordInput').value = 'password';
  await env.ctx.submitLogin(); await env.read('authStorageWork');
  assert.ok(env.written.some(([key,value]) => key === 'platonus_remember' && value === '1'));
  assert.ok(!env.written.some(([key]) => key === 'platonus_session'));
  assert.ok(!env.written.some(([key]) => key === 'platonus_password'));
  assert.ok(env.removed.includes('platonus_password'));
});

test('logout waits for an unfinished login before deleting its cookie', async () => {
  const env=setup(),calls=[];let complete;
  env.document.getElementById('loginInput').value='user';
  env.document.getElementById('passwordInput').value='password';
  env.ctx.fetch=(url,options)=>{
    calls.push([url,options.method]);
    return options.method==='POST'?new Promise(resolve=>{complete=resolve;}):Promise.resolve({ok:true});
  };
  const request=env.ctx.submitLogin();await new Promise(setImmediate);
  env.ctx.logout();await new Promise(setImmediate);
  assert.equal(calls.length,1);
  complete({ok:true,json:async()=>({ok:true})});
  await request;await env.read('authStorageWork');
  assert.deepEqual(calls,[['/api/login','POST'],['/api/session','DELETE']]);
  assert.equal(env.read('platonusSession'),null);assert.equal(env.loads,0);
});

test('without remember me old credentials are removed and silent renewal remains memory-only', async () => {
  const env = setup();
  env.document.getElementById('rememberLoginInput').checked = false;
  env.document.getElementById('loginInput').value = 'user';
  env.document.getElementById('passwordInput').value = 'password';
  await env.ctx.submitLogin(); await env.read('authStorageWork');
  assert.equal(env.read('platonusSession'), 'cookie');
  assert.ok(env.written.some(([key,value]) => key === 'platonus_remember' && value === '0'));
  for (const key of ['platonus_session', 'platonus_login', 'platonus_password']) {
    assert.ok(env.removed.includes(key)); assert.ok(!env.written.some(([saved]) => saved === key));
  }
  env.ctx.csGetMany = () => { throw new Error('must use memory credentials'); };
  assert.equal(await env.ctx.silentRelogin(), true);
  assert.ok(!env.written.some(([key]) => key === 'platonus_session'));
  env.ctx.logout(); await env.read('authStorageWork');
  assert.equal(env.read('platonusSession'), null);
});

test('temporary session-check failures preserve the account and do not delete its cookie', async () => {
  for (const failure of ['offline', 'server', 'invalid-json']) {
    const env = setup(); const calls = [];
    env.ctx.fetch = async (url, options) => {
      calls.push([url, options.method]);
      if (url !== '/api/session') return { status: 401, ok: false };
      if (failure === 'offline') throw new TypeError('offline');
      if (failure === 'server') return { status: 503, ok: false };
      return { status: 200, ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } };
    };
    await assert.rejects(env.ctx.platonusFetch('/api/gpa'));
    assert.equal(env.read('platonusSession'), 'old');
    assert.equal(env.read('platonusStudent.studentID'), 1);
    assert.ok(!calls.some(([,method]) => method === 'DELETE'));
  }
});

function setupRestore() {
  const env = setup();
  env.ctx.setTimeout = fn => { fn(); return 0; };
  env.ctx.loadCachedStudentData = async () => null;
  env.ctx.csGetMany = async () => ({ platonus_student: '{"studentID":1}', platonus_remember: '1' });
  vm.runInContext(app.slice(app.indexOf('  let restoringLogin'), app.indexOf("  document.addEventListener('DOMContentLoaded'")), env.ctx);
  return env;
}

test('a fresh launch restores a remembered session without asking for credentials', async () => {
  const env = setupRestore();
  vm.runInContext('platonusSession = null; platonusStudent = null;', env.ctx);
  await env.ctx.restoreSavedLogin();
  assert.equal(env.read('platonusSession'), 'cookie');
  assert.equal(env.loads, 1);
  assert.equal(env.document.getElementById('loginOverlay').style.display, 'none');
});

test('offline startup offers retry instead of a password form, then restores the same account', async () => {
  const env = setupRestore();
  vm.runInContext('platonusSession = null;', env.ctx);
  env.ctx.fetch = async () => { throw new TypeError('offline'); };
  await env.ctx.restoreSavedLogin();
  assert.equal(env.document.getElementById('loginFormFields').hidden, true);
  assert.equal(env.document.getElementById('loginRestoreRetry').hidden, false);
  assert.equal(env.loads, 0);
  env.ctx.fetch = async () => ({ ok: true, status: 200, json: async () => ({ok:true}) });
  await env.ctx.restoreSavedLogin();
  assert.equal(env.read('platonusSession'), 'cookie');
  assert.equal(env.loads, 1);
});

test('only a confirmed expired session opens the password form on launch', async () => {
  const env = setupRestore();
  vm.runInContext('platonusSession = null;', env.ctx);
  env.ctx.fetch = async () => ({ ok: false, status: 401 });
  await env.ctx.restoreSavedLogin();
  assert.equal(env.document.getElementById('loginFormFields').hidden, false);
  assert.equal(env.document.getElementById('loginRestoreStatus').hidden, true);
  assert.equal(env.document.getElementById('loginOverlay').style.display, 'flex');
  assert.equal(env.loads, 0);
});

test('cold launch retries missing cookies before showing login and never trusts cached identity alone', async () => {
  for (const recovered of [true, false]) {
    const env = setupRestore(); let calls = 0;
    vm.runInContext('platonusSession = null;', env.ctx);
    env.ctx.fetch = async () => {
      calls++;
      return recovered && calls === 2
        ? { ok: true, status: 200, json: async () => ({ok:true}) }
        : { ok: false, status: 401 };
    };
    await env.ctx.restoreSavedLogin();
    assert.equal(calls, recovered ? 2 : 3);
    assert.equal(env.loads, recovered ? 1 : 0);
    assert.equal(env.read('platonusSession'), recovered ? 'cookie' : null);
  }
});

test('logout waits for device restoration before deleting its late cookie', async () => {
  const env=setup();let completeRestore;
  const calls=[];
  env.ctx.window.unilinkDeviceSession={
    restore:()=>new Promise(resolve=>{completeRestore=resolve;}),
    clear:async()=>{calls.push('clear-device');},
  };
  env.ctx.fetch=async(url,options)=>{
    if(options?.method==='DELETE'){calls.push('delete-cookie');return {ok:true};}
    return {ok:false,status:401};
  };
  const restoring=env.ctx.silentRelogin();
  await new Promise(setImmediate);
  env.ctx.logout();await new Promise(setImmediate);
  assert.ok(calls.includes('clear-device'));
  assert.ok(!calls.includes('delete-cookie'));
  completeRestore(true);
  assert.equal(await restoring,false);
  await env.read('authStorageWork');
  assert.equal(calls.at(-1),'delete-cookie');
  assert.equal(env.read('platonusSession'),null);
});

test('successful remembered login persists the device key before opening the app', async () => {
  const env=setup();const publicKey={kty:'EC',crv:'P-256'};let finishSave,saved,requestBody;
  env.document.getElementById('rememberLoginInput').checked=true;
  env.document.getElementById('loginInput').value='user';
  env.document.getElementById('passwordInput').value='password';
  env.ctx.window.unilinkDeviceSession={prepare:async()=>({publicKey,
    save:value=>{saved=value;return new Promise(resolve=>{finishSave=resolve;});}})};
  env.ctx.fetch=async(url,options)=>{
    requestBody=JSON.parse(options.body);
    return {ok:true,json:async()=>({ok:true,deviceSession:'d1.encrypted'})};
  };
  const signingIn=env.ctx.submitLogin();await new Promise(setImmediate);
  assert.deepEqual(requestBody.devicePublicKey,publicKey);
  assert.equal(saved,'d1.encrypted');assert.equal(env.loads,0);
  finishSave();await signingIn;
  assert.equal(env.loads,1);
  assert.equal(env.read('platonusSession'),'cookie');
});
