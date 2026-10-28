import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {installLoading} from '../helpers/loading.js';

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
  const storage = new Map();
  const ctx = vm.createContext({
    document, window: {}, navigator:{onLine:true}, AbortSignal, localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
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
  installLoading(ctx);
  vm.runInContext(app.slice(app.indexOf('  const API_BASE'), app.indexOf('  const PLT_DAY_NAMES')), ctx);
  vm.runInContext("platonusSession = 'old'; platonusStudent = { studentID: 1 };", ctx);
  return {
    ctx, document, elements, removed, written, storage,
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

test('checking a saved login uses the shared indicator while retry retains an actionable error',()=>{
  const env=setup();env.ctx.setLoginRestoreState('checking');
  assert.match(env.document.getElementById('loginRestoreMessage').innerHTML,/content-loading-arrow/);
  assert.equal(env.document.getElementById('loginRestoreRetry').hidden,true);
  env.ctx.setLoginRestoreState('retry');
  assert.match(env.document.getElementById('loginRestoreMessage').textContent,/Не удалось проверить/);
  assert.equal(env.document.getElementById('loginRestoreRetry').hidden,false);
});

test('an offline logout prevents a later launch from reusing an old cookie',async()=>{
  const env=setup();env.ctx.fetch=async()=>{throw new Error('offline');};
  env.ctx.logout();await env.read('authStorageWork');
  assert.equal(env.storage.get('signed_out'),'1');
  let calls=0;env.ctx.fetch=async()=>{calls++;return {ok:true,json:async()=>({ok:true})};};
  assert.equal(await env.ctx.silentRelogin(),false);assert.equal(calls,0);
});

test('renewed Platonus requests get fresh deadlines and preserve the new session on timeout', async () => {
  const env = setup(); const deadlines = [], calls = [];
  env.ctx.window.unilinkDeviceSession={restore:async(_,refresh)=>{
    assert.equal(refresh,true);
    await env.ctx.fetch('/api/session',{method:'POST',signal:env.ctx.AbortSignal.timeout(20000)});
    return true;
  }};
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
    env.ctx.window.unilinkDeviceSession={restore:async()=>{
      const response=await env.ctx.fetch('/api/session',{method:'POST'});
      if(!response.ok)throw new Error('session_check_unavailable');
      await response.json();return true;
    }};
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

test('parallel upstream failures share one real renewal even when the app cookie still exists',async()=>{
  const env=setup();let renewals=0,renewed=false,complete;
  env.ctx.window.unilinkDeviceSession={restore:async(current,refresh)=>{
    assert.equal(refresh,true);renewals++;
    await new Promise(resolve=>{complete=resolve;});
    assert.equal(current(),true);renewed=true;return true;
  }};
  env.ctx.fetch=async()=>renewed?{ok:true,status:200,json:async()=>({value:'fresh'})}:{ok:false,status:401};
  const requests=[env.ctx.platonusFetch('/api/gpa'),env.ctx.platonusFetch('/api/schedule')];
  await new Promise(setImmediate);assert.equal(renewals,1);complete();
  assert.equal((await Promise.all(requests)).length,2);assert.equal(env.read('platonusSession'),'cookie');
  assert.equal(env.storage.get('signed_out'),undefined);
});

test('an in-flight cookie check cannot substitute for a requested upstream renewal',async()=>{
  const env=setup();let finish,renewals=0;
  env.ctx.fetch=()=>new Promise(resolve=>{finish=resolve;});
  env.ctx.window.unilinkDeviceSession={restore:async(_,refresh)=>{assert.equal(refresh,true);renewals++;return true;}};
  const checking=env.ctx.silentRelogin();await new Promise(setImmediate);
  const renewal=env.ctx.silentRelogin(true);
  finish({ok:true,status:200,json:async()=>({ok:true})});
  assert.equal(await checking,true);assert.equal(await renewal,true);assert.equal(renewals,1);
});

test('automatic expiration does not erase a remembered device or mark deliberate sign-out',async()=>{
  const env=setup();let cleared=0;
  env.ctx.window.unilinkDeviceSession={restore:async()=>false,clear:async()=>{cleared++;}};
  env.ctx.fetch=async()=>({ok:false,status:401});
  await assert.rejects(env.ctx.platonusFetch('/api/gpa'),/session_expired/);
  await env.read('authStorageWork');
  assert.equal(cleared,0);assert.equal(env.storage.get('signed_out'),undefined);
});

test('one route rejecting a fresh upstream session cannot erase the signed-in account',async()=>{
  const env=setup();let cleared=0;
  env.ctx.window.unilinkDeviceSession={restore:async()=>true,clear:async()=>{cleared++;}};
  env.ctx.fetch=async()=>({ok:false,status:401});
  await assert.rejects(env.ctx.platonusFetch('/api/grades'),/platonus_auth_unavailable/);
  assert.equal(env.read('platonusSession'),'cookie');assert.equal(env.read('platonusStudent.studentID'),1);
  assert.equal(cleared,0);assert.equal(env.storage.get('signed_out'),undefined);
});

function setupRestore() {
  const env = setup();
  env.ctx.setTimeout = fn => { fn(); return 0; };
  env.ctx.loadCachedStudentData = async () => null;
  env.ctx.csGetMany = async () => ({ platonus_student: '{"studentID":1}', platonus_remember: '1' });
  vm.runInContext(app.slice(app.indexOf('  let restoringLogin'), app.indexOf("  document.addEventListener('DOMContentLoaded'")), env.ctx);
  return env;
}

test('remembered offline launch opens only local study data without inventing an authenticated session',async()=>{
  const env=setupRestore();env.ctx.navigator.onLine=false;
  env.read('platonusSession = null');
  const saved={weekInfo:{studyYear:2026,term:1,week:9},schedule:{Вторник:[]},lessonTimes:{}};
  let applied=0,offline=false,network=0;
  env.ctx.fetch=async()=>{network++;throw new Error('offline');};
  env.ctx.window.unilinkStudy={bind(){},read:()=>({scheduleEntry:saved,exams:[],examsAt:1000}),offline:value=>{offline=value;}};
  env.ctx.applyWeekCacheEntry=entry=>{assert.equal(entry,saved);applied++;};
  env.ctx.detectToday=()=>{};env.ctx.renderCurrentSection=()=>{};
  await env.ctx.restoreSavedLogin();
  assert.equal(network,0);assert.equal(applied,1);assert.equal(offline,true);
  assert.equal(env.read('platonusSession'),null);assert.equal(env.read('offlineStudyMode'),true);
  assert.equal(env.document.body.classList.contains('login-screen'),false);
});

test('offline study restoration requires remembering the account and respects explicit sign-out',async()=>{
  const env=setupRestore();env.ctx.navigator.onLine=false;
  const saved={platonus_student:'{"studentID":1}',platonus_remember:'1'};
  env.ctx.window.unilinkStudy={bind(){throw new Error('must_not_read_private_cache');}};
  assert.equal(await env.ctx.activateOfflineStudy({...saved,platonus_remember:'0'}),false);
  env.storage.set('signed_out','1');
  assert.equal(await env.ctx.activateOfflineStudy(saved),false);
});

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

test('optional storage failures never block a successful login in a restricted WebView',async()=>{
  for(const failure of ['prepare','save','clear','unsupported']){
    const env=setup();
    env.document.getElementById('rememberLoginInput').checked=failure!=='clear';
    env.document.getElementById('loginInput').value='student';
    env.document.getElementById('passwordInput').value='password';
    env.ctx.window.unilinkDeviceSession={
      prepare:async()=>{
        if(failure==='prepare')throw new Error('indexeddb_blocked');
        if(failure==='unsupported')return null;
        return {publicKey:{kty:'EC'},save:async()=>{throw new Error('key_cannot_be_cloned');}};
      },
      clear:async()=>{if(failure==='clear')throw new Error('storage_blocked');},
    };
    await env.ctx.submitLogin();await env.read('authStorageWork');
    assert.equal(env.loads,1,failure);
    assert.equal(env.read('platonusSession'),'cookie',failure);
    assert.ok(!env.document.body.classList.contains('login-screen'),failure);
    assert.equal(env.document.getElementById('passwordInput').value,'',failure);
  }
});
