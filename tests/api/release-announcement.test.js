import test from 'node:test';
import assert from 'node:assert/strict';
import {announcementText,announceRelease} from '../../scripts/announce-release.mjs';
const version='a'.repeat(64),notes={changes:['Все разделы оценок видны сразу']};
const env={SUPABASE_URL:'https://database.invalid',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test',TELEGRAM_BOT_TOKEN:'test-token'};
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
test('release broadcasts verify production, deduplicate recipients and retry only known rate limits',async()=>{
  const ledger=new Set(),states=[],sent=[],delays=[];let limited=true;
  const fetchImpl=async(url,options)=>{
    if(url.includes('/version.json'))return response({version});
    if(url.includes('chat_telegram_links?'))return response([{telegram_id:1},{telegram_id:1},{telegram_id:2}]);
    const body=JSON.parse(options.body);
    if(options.method==='PATCH'){states.push(body.state);return response([]);}
    if(url.includes('chat_release_deliveries?')) {
      if(ledger.has(body.telegram_id))return response([]);
      ledger.add(body.telegram_id);return response([body]);
    }
    sent.push(body);
    if(limited){limited=false;return response({ok:false,error_code:429,parameters:{retry_after:2}},429);}
    return response({ok:true,result:{message_id:3}});
  };
  const first=await announceRelease({env,version,notes,fetchImpl,sleep:async ms=>delays.push(ms)});
  assert.equal(first.sent,2);assert.equal(sent.length,3);assert.equal(delays[0],2000);
  assert.deepEqual(states,['sent','sent']);assert.match(sent[1].text,/Что нового в unLink\./);
  assert.equal(sent[1].reply_markup.inline_keyboard[0][0].url,'https://univerapp.vercel.app');
  const again=await announceRelease({env,version,notes,fetchImpl,sleep:async()=>{}});
  assert.equal(again.skipped,2);assert.equal(sent.length,3);
});
test('missing configuration and an old production release never notify users',async()=>{
  assert.ok((await announceRelease({env:{},fetchImpl:()=>{throw new Error('Unexpected request');}})).skipped);
  let calls=0;
  const result=await announceRelease({env,version,notes,fetchImpl:async()=>{calls++;return response({version:'b'.repeat(64)});}});
  assert.ok(result.skipped);assert.equal(calls,1);
  assert.throws(()=>announcementText(version,{changes:[]}));
});
test('an ambiguous Telegram timeout is recorded and does not cause duplicate delivery',async()=>{
  let claimed=false,sends=0,state;
  const fetchImpl=async(url,options)=>{
    if(url.includes('/version.json'))return response({version});
    if(url.includes('chat_telegram_links?'))return response([{telegram_id:1}]);
    if(options.method==='PATCH'){state=JSON.parse(options.body).state;return response([]);}
    if(url.includes('chat_release_deliveries?')){if(claimed)return response([]);claimed=true;return response([{}]);}
    sends++;throw new Error('Network timeout');
  };
  assert.equal((await announceRelease({env,version,notes,fetchImpl,sleep:async()=>{}})).uncertain,1);
  assert.equal(state,'uncertain');
  await announceRelease({env,version,notes,fetchImpl,sleep:async()=>{}});assert.equal(sends,1);
});
