import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../assets/js/sw.js', import.meta.url), 'utf8');
function worker(cached, fetch, cacheStorage, deadline = AbortSignal) {
  const handlers = {}; const writes = [];
  let claimed = 0;
  vm.runInNewContext(source, {
    URL, AbortSignal: deadline, fetch, caches: cacheStorage || { open: async () => ({ match: async () => cached, put: async (...args) => writes.push(args) }) },
    self: { location: { origin: 'https://univer.test' }, clients: {claim:async()=>{claimed++;}}, addEventListener: (name, fn) => { handlers[name] = fn; } },
  });
  return { writes, handlers, get claimed(){return claimed;}, request(path) {
    const event = { request: { method: 'GET', url: `https://univer.test${path}`, headers: { has: () => false } },
      waitUntil(promise) { this.work = promise; }, respondWith(promise) { this.response = promise; } };
    handlers.fetch(event); return event;
  } };
}
const response = { ok: true, clone() { return this; } };
test('warm code displays while the network is pending and updates its public cache afterwards', async () => {
  let resolve;
  const cached = {};
  const ui = worker(cached, () => new Promise(done => { resolve = done; }));
  const event = ui.request('/assets/js/app.js');
  assert.equal(await event.response, cached);
  assert.equal(ui.writes.length, 0);
  resolve(response); await event.work;
  assert.equal(ui.writes.length, 1);
});
test('cold code waits for the network and private endpoints bypass the worker', async () => {
  let calls = 0;
  const ui = worker(null, async () => { calls++; return response; });
  assert.equal(await ui.request('/assets/css/app.css').response, response);
  const event = ui.request('/api/chat?action=inbox');
  assert.equal(event.response, undefined);
  assert.equal(calls, 1);
});
test('warm code remains available when background refresh fails', async () => {
  const cached = {};
  const ui = worker(cached, async () => { throw new Error('offline'); });
  const event = ui.request('/assets/js/app.js');
  assert.equal(await event.response, cached);
  await event.work;
});

test('blocked or full cache storage cannot break successful HTML, script or font loads',async()=>{
  for(const failAt of ['open','match','put'])for(const path of ['/','/assets/js/app.js','/assets/fonts/manrope/latin.woff2']){
    const storage={open:async()=>{
      if(failAt==='open')throw new Error('blocked');
      return {match:async()=>{if(failAt==='match')throw new Error('blocked');return null;},put:async()=>{if(failAt==='put')throw new Error('quota');}};
    }};
    const ui=worker(null,async()=>response,storage),event=ui.request(path);
    assert.equal(await event.response,response,`${failAt}: ${path}`);await event.work;
  }
});

test('activation retains recent public shells and never deletes unrelated caches',async()=>{
  const current=/const CACHE_NAME = '([^']+)'/.exec(source)[1],deleted=[];
  const names=['univer-shell-oldest','univer-private-data','other-app', 'univer-shell-previous-2','univer-shell-previous-1',current];
  const ui=worker(null,async()=>response,{keys:async()=>names,delete:async name=>{deleted.push(name);}});
  // Claim is intentionally separate from storage access: a blocked cache must
  // not prevent the browser from activating the new worker.
  let work;ui.handlers.activate({waitUntil(promise){work=promise;}});
  await work;assert.equal(ui.claimed,1);
  assert.deepEqual(deleted,['univer-shell-oldest']);
  const blocked=worker(null,async()=>response,{keys:async()=>{throw new Error('blocked');}});
  blocked.handlers.activate({waitUntil(promise){work=promise;}});await work;assert.equal(blocked.claimed,1);
});

test('previous public shell serves as fallback when a new worker has no cached files and the network fails',async()=>{
  const previous={version:'previous'};
  for(const status of ['offline',503])for(const path of ['/','/assets/js/app.js','/assets/fonts/manrope/latin.woff2']){
    const ui=worker(null,async()=>{if(status==='offline')throw new Error('offline');return {ok:false,status};},{
      keys:async()=>['univer-shell-previous'],open:async name=>({match:async()=>name==='univer-shell-previous'?previous:null}),
    });
    const event=ui.request(path);assert.equal(await event.response,previous);await event.work;
  }
});

test('a stalled navigation has a deadline and can restore saved HTML instead of hanging indefinitely',async()=>{
  const cached={saved:true},expired=AbortSignal.abort(new Error('timeout'));
  const ui=worker(cached,async(request,{signal})=>{assert.equal(signal,expired);throw signal.reason;},undefined,
    {timeout(ms){assert.equal(ms,10000);return expired;}});
  const event=ui.request('/');assert.equal(await event.response,cached);
});
