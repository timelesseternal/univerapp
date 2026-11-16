import test from 'node:test';import assert from 'node:assert/strict';import {createECDH,randomBytes} from 'node:crypto';
import {encryptPushKey,decryptPushKey,pushSubscription,processPushNotifications} from '../../api/_lib/push.js';
import handler from '../../api/chat.js';import {COOKIE_NAME,tokenHash} from '../../api/_lib/chat.js';
const user='11111111-1111-4111-8111-111111111111';
function subscription(endpoint='https://fcm.googleapis.com/fcm/send/device') {const key=createECDH('prime256v1');key.generateKeys();return {endpoint,keys:{auth:randomBytes(16).toString('base64url'),p256dh:key.getPublicKey().toString('base64url')}};}
const reply=(data,status=200)=>({ok:status<400,status,json:async()=>data});
function setup(t,fetcher) {
  const saved={fetch:global.fetch,url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,session:process.env.UNILINK_SESSION_KEY};
  global.fetch=fetcher;process.env.SUPABASE_URL='https://push-test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='sb_secret_test';process.env.UNILINK_SESSION_KEY='c'.repeat(64);
  t.after(()=>{global.fetch=saved.fetch;for(const [name,value] of [['SUPABASE_URL',saved.url],['SUPABASE_SERVICE_ROLE_KEY',saved.key],['UNILINK_SESSION_KEY',saved.session]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
}
async function call(action,method,body) {
  const res={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;}};
  await handler({method,query:{action},body,headers:{host:'univer.test',origin:'https://univer.test',cookie:`${COOKIE_NAME}=${'a'.repeat(64)}`}},res);return res;
}
test('subscriptions reject private URLs and malformed keys; VAPID secrets remain encrypted',t=>{
  setup(t,()=>{throw new Error('Unexpected request');});
  const original=subscription();assert.equal(pushSubscription(original).endpoint,original.endpoint);
  for(const endpoint of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.test/a','https://user:secret@web.push.apple.com/a','https://web.push.apple.com:444/a'])
    assert.throws(()=>pushSubscription({...original,endpoint}));
  assert.throws(()=>pushSubscription({...original,keys:{auth:'x',p256dh:'x'}}));
  const encrypted=encryptPushKey('private-vapid-key');assert.notEqual(encrypted,'private-vapid-key');assert.equal(decryptPushKey(encrypted),'private-vapid-key');
  process.env.UNILINK_SESSION_KEY='d'.repeat(64);assert.throws(()=>decryptPushKey(encrypted));
});
test('push registration and Telegram preferences use the session identity, never a browser userID',async t=>{
  const calls=[];setup(t,async(url,options)=>{if(url.includes('/chat_sessions?'))return reply([{user_id:user}]);calls.push({url,body:JSON.parse(options.body)});return reply(true);});
  const sub=subscription();assert.equal((await call('push-subscription','POST',{subscription:sub,disableTelegram:true,userID:'forged'})).code,200);
  assert.equal(calls[0].body.p_user_id,user);assert.equal(calls[0].body.p_session_hash,tokenHash('a'.repeat(64)));assert.equal(calls[0].body.p_disable_telegram,true);
  assert.equal((await call('notification-preferences','POST',{telegramEnabled:false,userID:'forged'})).code,200);
  assert.equal(calls[1].body.user_id,user);assert.equal(calls[1].body.telegram_enabled,false);
  assert.equal((await call('notification-preferences','POST',{telegramEnabled:'yes'})).code,400);
});
test('server delivery sends without a recipient request and removes expired provider subscriptions',async t=>{
  const sub=subscription(),job={messageID:'1',subscriptionID:'22222222-2222-4222-8222-222222222222',lease:'33333333-3333-4333-8333-333333333333',owner:user,conversationID:user,name:'Собеседник',text:'Привет',subscription:sub};
  let finish,deleted=false,deferred;setup(t,async(url,options)=>{
    if(url.endsWith('/chat_claim_push'))return reply([job]);
    if(url.includes('chat_push_keyring?'))return reply([{public_key:sub.keys.p256dh,private_encrypted:encryptPushKey('private-key')}]);
    if(url.endsWith('/chat_finish_push')){finish=JSON.parse(options.body);return reply(true);}
    if(url.includes('chat_push_jobs?')){deferred=JSON.parse(options.body);return reply([]);}
    if(options.method==='DELETE'){deleted=true;return reply([]);}throw new Error('Unexpected request');
  });
  let sent;
  await processPushNotifications(user,{send:async(target,payload,options)=>{sent={target,payload:JSON.parse(payload),options};}});
  assert.equal(sent.payload.owner,user);assert.equal(sent.payload.body,'Привет');assert.equal(finish.p_state,'sent');assert.equal(sent.options.TTL,86400);
  await processPushNotifications(user,{send:async()=>{throw {statusCode:410};}});assert.equal(deleted,true);
  await processPushNotifications(user,{send:async()=>{throw {statusCode:429,headers:{'retry-after':'120'}};}});
  assert.ok(Date.parse(deferred.leased_until)>Date.now()+110000);
});
test('configuration exposes the public VAPID key but never its encrypted or private counterpart',async t=>{
  const sub=subscription();setup(t,async url=>{
    if(url.includes('/chat_sessions?'))return reply([{user_id:user}]);
    if(url.includes('chat_notification_preferences?'))return reply([{telegram_enabled:false}]);
    if(url.includes('chat_push_keyring?'))return reply([{public_key:sub.keys.p256dh,private_encrypted:encryptPushKey('private-key')}]);
    throw new Error('Unexpected request');
  });
  const result=await call('push-config','GET');
  assert.equal(result.code,200);assert.deepEqual(Object.keys(result.body).sort(),['publicKey','telegramEnabled']);
  assert.equal(result.body.telegramEnabled,false);assert.doesNotMatch(JSON.stringify(result.body),/private-key|private_encrypted/);
});

test('foreground suppression applies only to the active device and finishes its leased job without sending a push',async t=>{
  const sub=subscription(),activeID='22222222-2222-4222-8222-222222222222',backgroundID='44444444-4444-4444-8444-444444444444';
  const hash='a'.repeat(64),otherHash='b'.repeat(64),finished=[],suppressed=[],sent=[];
  const base={messageID:'1',lease:'33333333-3333-4333-8333-333333333333',owner:user,conversationID:user,name:'Друг',text:'Привет',subscription:sub};
  const jobs=[{...base,subscriptionID:activeID},{...base,subscriptionID:backgroundID}];
  setup(t,async(url,options)=>{
    if(url.endsWith('/chat_claim_push'))return reply(jobs);
    if(url.includes('chat_push_subscriptions?')) {
      assert.equal(options.method,'GET');assert.match(url,/select=id,user_id,session_hash/);
      return reply([{id:activeID,user_id:user,session_hash:hash},{id:backgroundID,user_id:user,session_hash:otherHash}]);
    }
    if(url.includes('chat_presence?')) {
      assert.match(url,/online_until=gt\./);assert.ok(url.includes(hash)&&url.includes(otherHash));
      return reply([{token_hash:hash}]);
    }
    if(url.includes('chat_push_keyring?'))return reply([{public_key:sub.keys.p256dh,private_encrypted:encryptPushKey('private-key')}]);
    if(url.includes('chat_push_jobs?')){suppressed.push({url,body:JSON.parse(options.body)});return reply([]);}
    if(url.endsWith('/chat_finish_push')){finished.push(JSON.parse(options.body));return reply(true);}
    throw new Error('Unexpected request');
  });
  await processPushNotifications(user,{send:async(...args)=>sent.push(args)});
  assert.equal(sent.length,1);assert.equal(finished[0].p_subscription_id,backgroundID);
  assert.equal(suppressed.length,1);assert.deepEqual(suppressed[0].body,{state:'suppressed',leased_until:null});
  assert.ok(suppressed[0].url.includes(`subscription_id=eq.${activeID}`));
  assert.ok(suppressed[0].url.includes(`lease=eq.${base.lease}&state=eq.sending`));
});

test('an active device does not contact the push provider or create VAPID keys',async t=>{
  const id='22222222-2222-4222-8222-222222222222',hash='a'.repeat(64);let suppressed=0;
  setup(t,async(url,options)=>{
    if(url.endsWith('/chat_claim_push'))return reply([{subscriptionID:id,owner:user,messageID:'1',lease:user}]);
    if(url.includes('chat_push_subscriptions?'))return reply([{id,user_id:user,session_hash:hash}]);
    if(url.includes('chat_presence?'))return reply([{token_hash:hash}]);
    if(url.includes('chat_push_jobs?')){suppressed++;assert.equal(JSON.parse(options.body).state,'suppressed');return reply([]);}
    throw new Error('Unexpected VAPID/provider request');
  });
  let sends=0;await processPushNotifications(user,{send:async()=>{sends++;}});
  assert.equal(suppressed,1);assert.equal(sends,0);
});

test('hidden or expired activity, a different account, and unavailable presence never suppress background delivery',async t=>{
  for(const mode of ['inactive','other-account','unavailable'])await t.test(mode,async t=>{
    const sub=subscription(),id='22222222-2222-4222-8222-222222222222',hash='a'.repeat(64);let sent=0,finished;
    setup(t,async(url,options)=>{
      if(url.endsWith('/chat_claim_push'))return reply([{messageID:'1',subscriptionID:id,lease:user,owner:user,conversationID:user,subscription:sub}]);
      if(url.includes('chat_push_subscriptions?'))return reply([{id,user_id:mode==='other-account'?id:user,session_hash:hash}]);
      if(url.includes('chat_presence?')){if(mode==='unavailable')throw new Error('offline');return reply([]);}
      if(url.includes('chat_push_keyring?'))return reply([{public_key:sub.keys.p256dh,private_encrypted:encryptPushKey('private-key')}]);
      if(url.endsWith('/chat_finish_push')){finished=JSON.parse(options.body);return reply(true);}
      throw new Error('Unexpected suppression');
    });
    await processPushNotifications(user,{send:async()=>{sent++;}});
    assert.equal(sent,1);assert.equal(finished.p_state,'sent');
  });
});
