import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {indexedDBFixture} from '../helpers/indexeddb.js';
import {sealDeviceSession} from '../../api/_lib/device-session.js';
import {unsealSession} from '../../api/_lib/security.js';
import handler from '../../api/session.js';

process.env.UNILINK_SESSION_KEY='04'.repeat(32);
const source=readFileSync(new URL('../../assets/js/device-session.js',import.meta.url),'utf8');
const session={sid:'upstream-sid',token:'upstream-token',cookie:'upstream=cookie'};
const host='app.test';
function browser(database,fetch){
  const window={crypto:webcrypto};
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
  await assert.rejects(client.restore(),/device_storage_unavailable/);
  assert.equal(backend.calls.length,0);
});
