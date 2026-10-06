import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyTelegram, processNotifications, appLink } from '../api/_lib/telegram.js';
const token='test-bot-token';
function signed(fields) {
  const params=new URLSearchParams(fields);
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  const check=[...params.entries()].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${k}=${v}`).join('\n');
  params.set('hash',createHmac('sha256',secret).update(check).digest('hex'));
  return params.toString();
}
const identity=()=>signed({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:1234,first_name:'Студент'})});
test('Telegram identities require a valid signature and fresh timestamp',()=>{
  assert.equal(verifyTelegram(identity(),token),1234);
  assert.throws(()=>verifyTelegram(identity().replace('1234','9876'),token));
  assert.throws(()=>verifyTelegram(identity(),token+'wrong'));
  assert.throws(()=>verifyTelegram(signed({auth_date:'1',user:'{"id":1234}'}),token));
  assert.throws(()=>verifyTelegram(identity()+'&auth_date=1',token));
});
function environment(t,fetch) {
  const values={TELEGRAM_BOT_TOKEN:token,TELEGRAM_BOT_USERNAME:'kstuds_bot',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'secret'};
  const oldFetch=global.fetch; const old={};
  for(const [key,value] of Object.entries(values)) { old[key]=process.env[key]; process.env[key]=value; }
  global.fetch=fetch;
  t.after(()=>{global.fetch=oldFetch;for(const key of Object.keys(values)){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}});
}
const reply=(result)=>({ok:true,json:async()=>result});
const job={id:'1',lease:'lease',telegramID:'1234',conversationID:'11111111-1111-4111-8111-111111111111',name:'<Автор>',text:'Привет'};
test('delivery uses verified recipient, plain text and a link to the conversation; a racing read deletes it',async t=>{
  const calls=[];
  environment(t,async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,body});
    if(url.endsWith('/rpc/chat_claim_notifications'))return reply([job]);
    if(url.endsWith('/sendMessage')){
      assert.equal(body.chat_id,'1234');assert.equal(body.text,'<Автор>\n\nПривет');assert.equal(body.parse_mode,undefined);
      assert.ok(body.reply_markup.inline_keyboard[0][0].url.endsWith('startapp=chat_'+job.conversationID));
      return reply({ok:true,result:{message_id:99}});
    }
    if(url.endsWith('/deleteMessage'))return reply({ok:true,result:true});
    return reply(body.p_outcome==='sent');
  });
  await processNotifications('sender','send');
  assert.equal(calls.filter(call=>call.url.endsWith('/sendMessage')).length,1);
  assert.equal(calls.filter(call=>call.url.endsWith('/deleteMessage')).length,1);
  assert.equal(calls.at(-1).body.p_outcome,'deleted');
});
test('blocking the bot is terminal and does not break the saved chat message',async t=>{
  let outcome;
  environment(t,async(url,options)=>{
    if(url.endsWith('/rpc/chat_claim_notifications'))return reply([job]);
    if(url.endsWith('/sendMessage'))return {ok:false,status:403,json:async()=>({ok:false,error_code:403})};
    outcome=JSON.parse(options.body).p_outcome;return reply(false);
  });
  await processNotifications('sender','send'); assert.equal(outcome,'failed');
});
test('notifications older than Telegram deletion window stop retrying',async t=>{
  let outcome;
  environment(t,async(url,options)=>{
    if(url.endsWith('/rpc/chat_claim_notifications'))return reply([{...job,telegramMessageID:99,sentAt:'2020-01-01T00:00:00Z'}]);
    assert.ok(!url.includes('api.telegram.org'));
    outcome=JSON.parse(options.body).p_outcome;return reply(false);
  });
  await processNotifications('recipient','delete');assert.equal(outcome,'failed');
});
