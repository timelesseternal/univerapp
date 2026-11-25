import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../../assets/js/schedule-prefetch.js', import.meta.url), 'utf8');
function setup() {
  const timers = new Map(), events = {}, calls = [];
  let sequence = 0;
  const ctx = vm.createContext({
    document: {hidden:false, addEventListener:(name,callback)=>{events[name]=callback;}},
    navigator: {onLine:true},
    window: {addEventListener:(name,callback)=>{events[name]=callback;}},
    setTimeout:(callback,delay)=>{const id=++sequence;timers.set(id,{callback,delay});return id;},
    clearTimeout:id=>timers.delete(id),
  });
  vm.runInContext(source, ctx);
  const options = {key:'student-7-term-1-week-4',currentWeek:4,isCurrent:()=>true,canRun:()=>true,
    loadCached:async()=>false,loadWeek:async week=>{calls.push(week);}};
  return {ctx,timers,events,calls,options,api:ctx.window.unilinkSchedulePrefetch,
    async next() {
      const [id,timer]=timers.entries().next().value || [];
      assert.ok(timer,'a queued timer must exist');
      timers.delete(id);await timer.callback();return timer.delay;
    }};
}

test('past weeks load sequentially newest first, reuse cache and never request the current or future week',async()=>{
  const s=setup();s.options.loadCached=async week=>week===2;
  s.api.start(s.options);
  assert.deepEqual(s.calls,[]);
  assert.equal(await s.next(),1500);assert.deepEqual(s.calls,[3]);
  await s.next();assert.deepEqual(s.calls,[3]);
  await s.next();assert.deepEqual(s.calls,[3,1]);
  assert.equal(s.timers.size,0);
  s.api.start(s.options);assert.equal(s.timers.size,0,'same completed job is not restarted');
});

test('background work pauses while hidden or offline and resumes on return',async()=>{
  const s=setup();s.api.start(s.options);
  s.ctx.document.hidden=true;s.events.visibilitychange();assert.equal(s.timers.size,0);
  s.ctx.document.hidden=false;s.events.visibilitychange();await s.next();assert.deepEqual(s.calls,[3]);
  s.ctx.navigator.onLine=false;s.events.offline();assert.equal(s.timers.size,0);
  s.ctx.navigator.onLine=true;s.events.online();await s.next();assert.deepEqual(s.calls,[3,2]);
});

test('foreground loading takes priority and network failures back off without skipping a week',async()=>{
  const s=setup();let busy=true,attempt=0;
  s.options.canRun=()=>!busy;
  s.options.loadWeek=async week=>{s.calls.push(week);if(attempt++===0)throw new Error('rate_limited');};
  s.api.start(s.options);await s.next();assert.deepEqual(s.calls,[]);
  busy=false;await s.next();assert.deepEqual(s.calls,[3]);
  assert.equal(await s.next(),30000);assert.deepEqual(s.calls,[3,3]);
  assert.equal(await s.next(),1500);assert.deepEqual(s.calls,[3,3,2]);
});

test('logout or period changes stop old work, including work awaiting saved cache',async()=>{
  const s=setup();let resolve,current=true;
  s.options.isCurrent=()=>current;
  s.options.loadCached=()=>new Promise(done=>{resolve=done;});
  s.api.start(s.options);const pending=s.next();
  current=false;s.api.stop();resolve(false);await pending;
  assert.deepEqual(s.calls,[]);assert.equal(s.timers.size,0);
});

test('scope replacement waits for the active request and then starts only the new queue',async()=>{
  const s=setup();let finish,started;
  const entered=new Promise(resolve=>{started=resolve;});
  s.options.loadWeek=week=>{s.calls.push(week);started();return new Promise(done=>{finish=done;});};
  s.api.start(s.options);const pending=s.next();await entered;
  assert.deepEqual(s.calls,[3]);assert.equal(s.timers.size,0);
  s.api.start({...s.options,key:'student-8',currentWeek:2,loadWeek:async week=>s.calls.push(`new-${week}`)});
  assert.equal(s.timers.size,0);
  finish();await pending;await s.next();
  assert.deepEqual(s.calls,[3,'new-1']);assert.equal(s.timers.size,0);
});

test('first week needs no prefetch and invalid bounds cannot flood the server',()=>{
  for(const week of [1,0,NaN,55,3.5]){
    const s=setup();s.api.start({...s.options,currentWeek:week});
    assert.equal(s.timers.size,0);
  }
});
