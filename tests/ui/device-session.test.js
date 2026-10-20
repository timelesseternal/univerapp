import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {indexedDBFixture} from '../helpers/indexeddb.js';
import {sealDeviceSession,readDeviceSession} from '../../api/_lib/device-session.js';
import {unsealSession} from '../../api/_lib/security.js';
import handler from '../../api/session.js';

process.env.UNILINK_SESSION_KEY='04'.repeat(32);
const source=readFileSync(new URL('../../assets/js/device-session.js',import.meta.url),'utf8');
const session={sid:'upstream-sid',token:'upstream-token',cookie:'upstream=cookie'};
const host='app.test';
process.env.SUPABASE_URL='https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='server-only';
function browser(database,fetch,telegram){
  const window={crypto:webcrypto,location:{host},...(telegram?{Telegram:{WebApp:telegram}}:{})};
  vm.runInNewContext(source,{window,indexedDB:database,fetch,TextEncoder,Uint8Array,btoa,AbortSignal,setTimeout,clearTimeout});
  return window.unilinkDeviceSession;
}
function server(){
  const calls=[];let cookie;
  return {calls,get cookie(){return cookie;},fetch:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    const res={setHeader(name,value){if(name==='Set-Cookie')cookie=value;},status(code){this.code=code;return this;},json(value){this.body=value;}};
    await handler({method:options.method,headers:{host,origin:'https://'+host,'x-forwarded-proto':'https'},body},res);
    return {status:res.code,ok:res.code===200,json:async()=>res.body};
  }};
}

test('remembered login survives script shutdown and missing cookies without retaining a password or exportable key',async()=>{
  const database=indexedDBFixture(),backend=server(),first=browser(database,backend.fetch);
  const prepared=await first.prepare();
  await prepared.save(sealDeviceSession(session,prepared.publicKey,host));
  const stored=database.records.get('remembered-login');
  assert.equal(stored.privateKey.extractable,false);
  await assert.rejects(webcrypto.subtle.exportKey('jwk',stored.privateKey));
  assert.ok(!JSON.stringify(stored).includes('upstream-'));
  assert.equal(stored.password,undefined);
  const reopened=browser(database,backend.fetch);
  assert.equal(await reopened.restore(),true);
  assert.deepEqual(backend.calls.map(body=>body.action),['challenge','restore']);
  assert.deepEqual(unsealSession(backend.cookie.split(';')[0].split('=')[1]),session);
  await reopened.clear();
  assert.equal(await browser(database,backend.fetch).restore(),false);
  assert.equal(database.records.size,0);
});

test('temporary server failure keeps remembered login so the next attempt can recover',async()=>{
  const database=indexedDBFixture(),backend=server();
  const first=browser(database,backend.fetch),prepared=await first.prepare();
  await prepared.save(sealDeviceSession(session,prepared.publicKey,host));
  const offline=browser(database,async()=>({ok:false,status:503}));
  await assert.rejects(offline.restore(),/session_check_unavailable/);
  assert.equal(database.records.size,1);
  assert.equal(await browser(database,backend.fetch).restore(),true);
});

test('expired remembered logins are cleared and never restore a cookie',async()=>{
  const database=indexedDBFixture(),backend=server(),first=browser(database,backend.fetch);
  const prepared=await first.prepare();
  await prepared.save(sealDeviceSession(session,prepared.publicKey,host,Date.now()-31*86400000));
  assert.equal(await browser(database,backend.fetch).restore(),false);
  assert.equal(database.records.size,0);
  assert.equal(backend.cookie,undefined);
});

test('signing out while a challenge is pending prevents sending the restoration request',async()=>{
  const database=indexedDBFixture(),backend=server(),first=browser(database,backend.fetch);
  const prepared=await first.prepare();
  await prepared.save(sealDeviceSession(session,prepared.publicKey,host));
  let current=true,complete,started;
  const challengeStarted=new Promise(resolve=>{started=resolve;});
  const reopened=browser(database,async(url,options)=>{
    started();return new Promise(resolve=>{complete=()=>backend.fetch(url,options).then(resolve);});
  });
  const restoring=reopened.restore(()=>current);
  const rejected=assert.rejects(restoring,/session_changed/);
  await challengeStarted;current=false;await reopened.clear();complete();
  await rejected;
  assert.deepEqual(backend.calls.map(body=>body.action),['challenge']);
  assert.equal(backend.cookie,undefined);
  assert.equal(database.records.size,0);
});

test('denied local storage fails promptly without claiming that login is remembered',async()=>{
  const denied={open(){throw new Error('blocked');}},backend=server(),client=browser(denied,backend.fetch);
  await assert.rejects(client.prepare(),/blocked/);
  assert.equal(await client.restore(),false);
  assert.equal(backend.calls.length,0);
});

function nativeStorage(){
  const values=new Map();
  return {values,
    setItem(key,value,callback){values.set(key,value);queueMicrotask(()=>callback(null,true));},
    getItem(key,callback){queueMicrotask(()=>callback(null,values.get(key) ?? null));},
    removeItem(key,callback){values.delete(key);queueMicrotask(()=>callback(null,true));},
  };
}
function telegram(storage,id=42){
  return {initData:'telegram-fixture',initDataUnsafe:{user:{id}},isVersionAtLeast:()=>true,
    SecureStorage:storage,CloudStorage:{setItem(){throw new Error('must not store credentials in cloud');}}};
}

test('browser and Telegram renew upstream login, persist the rotated envelope and recover after reopening',async t=>{
  t.mock.method(globalThis,'fetch',async url=>String(url).includes('/rpc/security_login_attempt')
    ? {ok:true,json:async()=>({allowed:true})}
    : {ok:true,status:200,json:async()=>({login_status:'success',sid:'renewed',auth_token:'new-token'}),
      headers:{getSetCookie:()=>['new=cookie; Secure']}});
  for(const native of [false,true]){
    const database=indexedDBFixture(),storage=nativeStorage(),tg=native?telegram(storage):undefined,backend=server();
    const first=browser(database,backend.fetch,tg),prepared=await first.prepare();
    const old=sealDeviceSession(session,prepared.publicKey,host,Date.now(),{credentials:{login:'student',password:'not-readable'}});
    await prepared.save(old);const expires=readDeviceSession(old,host).expires;
    const reopened=browser(database,backend.fetch,tg);
    assert.equal(await reopened.restore(()=>true,true),true);
    const saved=database.records.get(native?'remembered-login-tg-42':'remembered-login');
    assert.notEqual(saved.deviceSession,old);
    assert.equal(readDeviceSession(saved.deviceSession,host).session.sid,'renewed');
    assert.equal(readDeviceSession(saved.deviceSession,host).expires,expires);
    assert.equal(JSON.stringify(saved).includes('not-readable'),false);
    assert.equal(JSON.stringify(backend.calls).includes('not-readable'),false);
    assert.equal(backend.calls.at(-1).refresh,true);
    const restart=browser(native?undefined:database,backend.fetch,tg);
    assert.equal(await restart.restore(),true);
    assert.equal(unsealSession(backend.cookie.split(';')[0].split('=')[1]).sid,'renewed');
  }
});

test('a delayed or rejected proof does not delete the remembered device',async()=>{
  const database=indexedDBFixture(),backend=server(),first=browser(database,backend.fetch);
  const prepared=await first.prepare();await prepared.save(sealDeviceSession(session,prepared.publicKey,host));
  const rejected=browser(database,async(url,options)=>JSON.parse(options.body).action==='challenge'
    ? backend.fetch(url,options):{ok:false,status:401,json:async()=>({error:'invalid_device_proof'})});
  await assert.rejects(rejected.restore(),/session_check_unavailable/);
  assert.equal(database.records.size,1);
  assert.equal(await browser(database,backend.fetch).restore(),true);
});

test('Telegram restores remembered login from native secure storage after its WebView storage is lost',async()=>{
  const storage=nativeStorage(),backend=server();
  const unavailable={open(){throw new Error('webview_storage_blocked');}};
  const first=browser(unavailable,backend.fetch,telegram(storage));
  const prepared=await first.prepare();
  await prepared.save(sealDeviceSession(session,prepared.publicKey,host));
  assert.equal(storage.values.size,1);
  assert.ok(![...storage.values.values()][0].includes('upstream-'));
  const reopened=browser(undefined,backend.fetch,telegram(storage));
  assert.equal(await reopened.restore(),true);
  assert.deepEqual(unsealSession(backend.cookie.split(';')[0].split('=')[1]),session);
  await reopened.clear();
  assert.equal(storage.values.size,0);
  assert.equal(await browser(undefined,backend.fetch,telegram(storage)).restore(),false);
});

test('an unavailable Telegram secure store falls back to a non-exportable IndexedDB key',async()=>{
  const storage={getItem:(key,cb)=>cb('unavailable'),setItem:(key,value,cb)=>cb('unavailable'),removeItem:(key,cb)=>cb('unavailable')};
  const database=indexedDBFixture(),backend=server(),tg=telegram(storage);
  const first=browser(database,backend.fetch,tg),prepared=await first.prepare();
  await prepared.save(sealDeviceSession(session,prepared.publicKey,host));
  assert.equal(database.records.get('remembered-login-tg-42').privateKey.extractable,false);
  assert.equal(await browser(database,backend.fetch,tg).restore(),true);
  assert.equal(await browser(database,backend.fetch,telegram(storage,99)).restore(),false);
});

test('older Telegram versions keep the browser persistence path without calling unsupported native APIs',async()=>{
  const storage={getItem(){throw new Error('unsupported');},setItem(){throw new Error('unsupported');},removeItem(){throw new Error('unsupported');}};
  const tg={...telegram(storage),isVersionAtLeast:()=>false};
  const database=indexedDBFixture(),backend=server(),first=browser(database,backend.fetch,tg);
  const prepared=await first.prepare();await prepared.save(sealDeviceSession(session,prepared.publicKey,host));
  assert.equal(await browser(database,backend.fetch,tg).restore(),true);
});
