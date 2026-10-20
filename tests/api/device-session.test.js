import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {devicePublicKey,sealDeviceSession,readDeviceSession,deviceChallenge,verifyDeviceProof} from '../../api/_lib/device-session.js';
import {unsealSession,REMEMBER_SECONDS} from '../../api/_lib/security.js';
import handler from '../../api/session.js';
import login from '../../api/login.js';

process.env.UNILINK_SESSION_KEY='03'.repeat(32);
process.env.SUPABASE_URL='https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='server-only';
const session={sid:'private-sid',token:'private-token',cookie:'upstream=private-cookie'};
const host='app.test',headers={host,origin:'https://app.test','x-forwarded-proto':'https'};
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;}});
async function device(){
  const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  const publicKey=await webcrypto.subtle.exportKey('jwk',keys.publicKey);
  return {publicKey,privateKey:keys.privateKey};
}
async function sign(key,challenge){
  return Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,
    new TextEncoder().encode(`unilink-remembered-device-v1\n${challenge}`))).toString('base64url');
}

test('a lost browser cookie is restored only by the original device key',async()=>{
  const original=await device(),other=await device(),now=Date.now();
  const token=sealDeviceSession(session,original.publicKey,host,now);
  assert.ok(!token.includes('private'));
  assert.equal(unsealSession(token),null,'device envelopes are not API session cookies');
  const payload=readDeviceSession(token,host,now);
  assert.deepEqual(payload.session,session);
  const challenge=deviceChallenge(token,host,now),proof=await sign(original.privateKey,challenge);
  assert.equal(verifyDeviceProof(token,host,payload,challenge,proof,now),true);
  assert.equal(verifyDeviceProof(token,host,payload,challenge,await sign(other.privateKey,challenge),now),false);
  assert.equal(verifyDeviceProof(token,host,payload,challenge,proof,now+60000),false);
  assert.equal(verifyDeviceProof(token,'other.test',payload,challenge,proof,now),false);
  assert.equal(readDeviceSession(token,'other.test',now),null);
  assert.equal(readDeviceSession(token,host,now+REMEMBER_SECONDS*1000),null);
});

test('tampering, malformed keys, and proofs reused with another envelope are rejected',async()=>{
  const {publicKey,privateKey}=await device(),now=Date.now();
  const token=sealDeviceSession(session,publicKey,host,now),payload=readDeviceSession(token,host,now);
  const challenge=deviceChallenge(token,host,now),signature=await sign(privateKey,challenge);
  const other=sealDeviceSession(session,publicKey,host,now);
  assert.equal(verifyDeviceProof(other,host,payload,challenge,signature,now),false);
  assert.equal(verifyDeviceProof(token,host,payload,challenge+'x',signature,now),false);
  for(const bad of ['',null,'A'.repeat(85),'A'.repeat(87),signature.slice(0,85)+'!'])
    assert.equal(verifyDeviceProof(token,host,payload,challenge,bad,now),false);
  const parts=token.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
  assert.equal(readDeviceSession(parts.join('.'),host,now),null);
  const shortened=token.split('.');shortened[3]=shortened[3].slice(0,4);
  assert.equal(readDeviceSession(shortened.join('.'),host,now),null);
  for(const bad of [null,{}, {...publicKey,d:'private'}, {...publicKey,crv:'P-384'}, {...publicKey,x:'A'.repeat(43),y:'A'.repeat(43)}])
    assert.throws(()=>devicePublicKey(bad));
});

test('restoration endpoint requires a signed challenge, same origin, and preserves original expiration',async()=>{
  const {publicKey,privateKey}=await device(),issued=Date.now()-20*86400000;
  const deviceSession=sealDeviceSession(session,publicKey,host,issued);
  const challengeReply=response();
  await handler({method:'POST',headers,body:{action:'challenge',deviceSession}},challengeReply);
  assert.equal(challengeReply.code,200);
  assert.equal(challengeReply.headers['Set-Cookie'],undefined);
  const challenge=challengeReply.body.challenge,signature=await sign(privateKey,challenge);
  const restored=response();
  await handler({method:'POST',headers,body:{action:'restore',deviceSession,challenge,signature}},restored);
  assert.equal(restored.code,200);assert.deepEqual(restored.body,{ok:true});
  const cookie=restored.headers['Set-Cookie'],token=cookie.split(';')[0].split('=')[1];
  assert.deepEqual(unsealSession(token),session);
  assert.equal(unsealSession(token,issued+REMEMBER_SECONDS*1000),null);
  assert.ok(Number(cookie.match(/Max-Age=(\d+)/)[1])<=10*86400);
  for(const req of [
    {headers:{...headers,origin:'https://evil.test'},body:{action:'restore',deviceSession,challenge,signature}},
    {headers,body:{action:'restore',deviceSession,challenge,signature:'A'.repeat(86)}},
    {headers,body:{action:'restore',deviceSession}},
    {headers,body:{action:'restore',deviceSession:'d1.forged'}},
  ]){
    const denied=response();await handler({method:'POST',...req},denied);
    assert.ok([401,403].includes(denied.code));assert.equal(denied.headers['Set-Cookie'],undefined);
  }
});

test('login issues a device-bound envelope only for an explicit remembered login with a valid public key',async t=>{
  const {publicKey}=await device();
  t.mock.method(globalThis,'fetch',async url=>String(url).includes('/rpc/security_login_attempt')
    ? {ok:true,json:async()=>({allowed:true})}
    : {ok:true,status:200,json:async()=>({login_status:'success',sid:session.sid,auth_token:session.token}),
      headers:{getSetCookie:()=>[session.cookie+'; HttpOnly']}});
  for(const remember of [true,false]){
    const result=response();
    await login({method:'POST',headers,body:{login:'student',password:'password',remember,devicePublicKey:publicKey}},result);
    assert.equal(result.code,200);
    if(remember){
      const payload=readDeviceSession(result.body.deviceSession,host);
      assert.deepEqual(payload.session,session);
      assert.deepEqual(payload.credentials,{login:'student',password:'password'});
      assert.equal(JSON.stringify(result.body).includes('password'),false);
    }
    else assert.equal(result.body.deviceSession,undefined);
    assert.equal(result.body.session,undefined);
  }
  const denied=response();
  await login({method:'POST',headers,body:{login:'student',password:'password',remember:true,devicePublicKey:{}}},denied);
  assert.equal(denied.code,400);assert.equal(denied.headers['Set-Cookie'],undefined);
});

test('a device proof renews expired Platonus credentials without extending the remembered deadline',async t=>{
  const {publicKey,privateKey}=await device(),issued=Date.now()-20*86400000;
  const credentials={login:'student',password:'secret-for-renewal'};
  const deviceSession=sealDeviceSession(session,publicKey,host,issued,{credentials});
  const expires=readDeviceSession(deviceSession,host).expires;
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(String(url).includes('/rpc/security_login_attempt'))return {ok:true,json:async()=>({allowed:true})};
    assert.equal(url,'https://platonus.kstu.kz/rest/api/login');calls++;
    assert.equal(JSON.parse(options.body).password,credentials.password);
    return {ok:true,status:200,json:async()=>({login_status:'success',sid:'fresh-sid',auth_token:'fresh-token'}),headers:{getSetCookie:()=>['fresh=cookie; Secure']}};
  });
  const challenge=deviceChallenge(deviceSession,host),signature=await sign(privateKey,challenge);
  const result=response();
  await handler({method:'POST',headers,body:{action:'restore',deviceSession,challenge,signature,refresh:true}},result);
  assert.equal(result.code,200);assert.equal(calls,1);
  const payload=readDeviceSession(result.body.deviceSession,host);
  assert.equal(payload.session.sid,'fresh-sid');assert.equal(payload.expires,expires);
  assert.deepEqual(payload.credentials,credentials);
  const cookie=unsealSession(result.headers['Set-Cookie'].split(';')[0].split('=')[1]);
  assert.equal(cookie.sid,'fresh-sid');assert.equal(cookie.credentials,undefined);
  assert.ok(!JSON.stringify(result.body).includes(credentials.password));
});

test('renewal rejects unsigned proofs before touching Platonus, and temporary failures do not clear cookies',async t=>{
  const {publicKey,privateKey}=await device();
  const deviceSession=sealDeviceSession(session,publicKey,host,Date.now(),{credentials:{login:'student',password:'secret'}});
  const challenge=deviceChallenge(deviceSession,host),signature=await sign(privateKey,challenge);
  let upstream=0,limited=false;
  t.mock.method(globalThis,'fetch',async url=>{
    if(String(url).includes('/rpc/security_login_attempt'))return {ok:true,json:async()=>({allowed:!limited})};
    upstream++;return {ok:false,status:503};
  });
  const denied=response();
  await handler({method:'POST',headers,body:{action:'restore',deviceSession,challenge,refresh:true}},denied);
  assert.equal(denied.code,401);assert.equal(upstream,0);
  const failed=response();
  await handler({method:'POST',headers,body:{action:'restore',deviceSession,challenge,signature,refresh:true}},failed);
  assert.equal(failed.code,502);assert.equal(failed.headers['Set-Cookie'],undefined);
  limited=true;const blocked=response();
  await handler({method:'POST',headers,body:{action:'restore',deviceSession,challenge,signature,refresh:true}},blocked);
  assert.equal(blocked.code,429);assert.equal(upstream,1);
});
