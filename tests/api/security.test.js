import test from 'node:test';
import assert from 'node:assert/strict';
import {sealSession,unsealSession,readWebSession,setWebSession,SESSION_SECONDS,REMEMBER_SECONDS} from '../../api/_lib/security.js';
import handler from '../../api/session.js';
import login from '../../api/login.js';
process.env.UNILINK_SESSION_KEY='02'.repeat(32);
process.env.SUPABASE_URL='https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='server-only';
const session={sid:'private-sid',token:'private-token',cookie:'upstream=secret'};
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;}});
test('remembered sessions survive eight hours and expire after thirty days',()=>{
  const now=Date.now(),remembered=sealSession(session,now,true),temporary=sealSession(session,now,false);
  assert.equal(unsealSession(temporary,now+SESSION_SECONDS*1000),null);
  assert.deepEqual(unsealSession(remembered,now+SESSION_SECONDS*1000),session);
  assert.deepEqual(unsealSession(remembered,now+REMEMBER_SECONDS*1000-1),session);
  assert.equal(unsealSession(remembered,now+REMEMBER_SECONDS*1000),null);
  const res=response();setWebSession({headers:{'x-forwarded-proto':'https'}},res,remembered,true);
  assert.match(res.headers['Set-Cookie'],/Max-Age=2592000/);
  const expiry = res.headers['Set-Cookie'].match(/Expires=([^;]+)/)?.[1];
  assert.ok(Math.abs(Date.parse(expiry)-(now+REMEMBER_SECONDS*1000))<2000);
  assert.match(res.headers['Set-Cookie'],/HttpOnly; SameSite=Strict; Secure/);
});
test('session encryption authenticates every field and expires; legacy forged bundles are rejected',()=>{
  const now=Date.now(),a=sealSession(session,now),b=sealSession(session,now);
  assert.notEqual(a,b);assert.deepEqual(unsealSession(a,now),session);
  assert.equal(unsealSession(a,now+SESSION_SECONDS*1000),null);
  const parts=a.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
  assert.equal(unsealSession(parts.join('.'),now),null);
  assert.equal(unsealSession('v1.invalid.payload.tag'),null);
  const shortened=a.split('.');shortened[3]=Buffer.from(shortened[3],'base64url').subarray(0,4).toString('base64url');
  assert.equal(unsealSession(shortened.join('.'),now),null,'truncated GCM tags cannot weaken authentication');
  assert.equal(readWebSession({headers:{'x-session':Buffer.from(JSON.stringify(session)).toString('base64')}}),null);
  assert.equal(readWebSession({headers:{cookie:'unilink_session='+a,origin:'https://evil.test',host:'app.test'}}),null);
  assert.equal(readWebSession({headers:{cookie:'unilink_session='+a,'sec-fetch-site':'cross-site'}}),null);
  assert.throws(()=>sealSession({...session,token:'bad\r\nHeader: yes'}));
});
test('session endpoints expose only status, prevent cross-site writes and clear the HttpOnly cookie',async()=>{
  const headers={cookie:'unilink_session='+sealSession(session),host:'app.test',origin:'https://app.test','x-forwarded-proto':'https'};
  const res=response();await handler({method:'GET',headers},res);
  assert.equal(res.code,200);assert.deepEqual(res.body,{ok:true});assert.match(res.headers['Cache-Control'],/no-store/);
  const denied=response();await handler({method:'DELETE',headers:{...headers,origin:'https://evil.test'}},denied);assert.equal(denied.code,403);assert.equal(denied.headers['Set-Cookie'],undefined);
  const out=response();await handler({method:'DELETE',headers},out);assert.match(out.headers['Set-Cookie'],/HttpOnly; SameSite=Strict; Secure; Max-Age=0/);
  for(const remember of [false,true]){
    const cookie=response();setWebSession({headers},cookie,sealSession(session),remember);
    assert.equal(cookie.headers['Set-Cookie'].includes('Max-Age='),remember);
    assert.equal(cookie.headers['Set-Cookie'].includes('Expires='),remember);
  }
});
test('login rate limits and configuration failures stop requests before Platonus',async t=>{
  const req={method:'POST',headers:{host:'app.test'},body:{login:'User',password:'secret'}};
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls++;assert.match(url,/\/rpc\/security_login_attempt$/);
    const keys=JSON.parse(options.body);assert.match(keys.p_ip_key,/^[a-f0-9]{64}$/);assert.match(keys.p_account_key,/^[a-f0-9]{64}$/);
    assert.ok(!options.body.includes('User'));
    return {ok:true,json:async()=>({allowed:false,retryAfter:120})};
  });
  const limited=response();await login(req,limited);assert.equal(limited.code,429);assert.equal(limited.headers['Retry-After'],'120');assert.equal(calls,1);
  const denied=response();await login({...req,headers:{origin:'https://evil.test',host:'app.test'}},denied);assert.equal(denied.code,403);assert.equal(calls,1);
  const key=process.env.UNILINK_SESSION_KEY;delete process.env.UNILINK_SESSION_KEY;
  try{const unavailable=response();await login(req,unavailable);assert.equal(unavailable.code,503);assert.equal(calls,1);}finally{process.env.UNILINK_SESSION_KEY=key;}
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('database_offline');});
  const offline=response();await login(req,offline);assert.equal(offline.code,503);assert.equal(offline.headers['Set-Cookie'],undefined);
});
