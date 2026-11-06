import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';import {PGlite} from '@electric-sql/pglite';
test('push survives closed clients, disables Telegram duplicates, checks sessions and isolates devices',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  for(const name of ['001_chat','002_telegram_notifications','007_message_actions','008_message_delete_scopes','010_web_push','010_web_push'])
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),'utf8'));
  const rpc=async(name,args)=>(await db.query(`select ${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result;
  const hashA='a'.repeat(64),hashB='b'.repeat(64);
  const a=await rpc('chat_bootstrap',[1,'А',hashA,null]),b=await rpc('chat_bootstrap',[2,'Б',hashB,null]);
  const conversation=(await rpc('chat_open_conversation',[a.id,b.id])).id;
  await rpc('chat_link_telegram',[b.id,123]);
  const endpoint='https://web.push.apple.com/device-one';
  await rpc('chat_save_push',[b.id,hashB,endpoint,'p256dh','auth',true]);
  assert.equal(await rpc('chat_touch_push',[a.id,hashA,endpoint]),false);
  assert.equal(await rpc('chat_touch_push',[b.id,hashB,endpoint]),true);
  assert.equal((await db.query('select telegram_enabled from chat_notification_preferences where user_id=$1',[b.id])).rows[0].telegram_enabled,false);
  const client=randomUUID();
  const message=await rpc('chat_send_message',[a.id,conversation,'Сообщение при закрытом приложении',client]);
  await rpc('chat_send_message',[a.id,conversation,'Дубликат',client]);
  assert.equal((await db.query('select count(*)::int n from chat_push_jobs')).rows[0].n,1);
  assert.deepEqual(await rpc('chat_claim_notifications',[a.id,'send']),[]);
  const jobs=await rpc('chat_claim_push',[a.id]);
  assert.equal(jobs.length,1);assert.equal(jobs[0].owner,b.id);assert.equal(jobs[0].subscription.endpoint,endpoint);
  assert.deepEqual(await rpc('chat_claim_push',[a.id]),[]);
  assert.equal(await rpc('chat_finish_push',[message.id,jobs[0].subscriptionID,randomUUID(),'sent']),false);
  assert.equal(await rpc('chat_finish_push',[message.id,jobs[0].subscriptionID,jobs[0].lease,'sent']),true);
  // Explicitly enabling Telegram allows duplicates; the default after push activation did not.
  await db.query('update chat_notification_preferences set telegram_enabled=true where user_id=$1',[b.id]);
  const next=await rpc('chat_send_message',[a.id,conversation,'Второе сообщение',randomUUID()]);
  assert.equal((await rpc('chat_claim_notifications',[a.id,'send'])).length,1);
  await rpc('chat_mark_read',[b.id,conversation,next.id]);
  assert.deepEqual(await rpc('chat_claim_push',[a.id]),[]);
  // A stale subscription cannot start notifying a newly selected account about the old chat.
  const unread=await rpc('chat_send_message',[a.id,conversation,'До смены владельца',randomUUID()]);
  await assert.rejects(rpc('chat_save_push',[a.id,hashA,endpoint,'wrong','wrong',true]),e=>e.code==='42501');
  await rpc('chat_save_push',[a.id,hashA,endpoint,'p256dh','auth',true]);
  assert.equal((await db.query('select count(*)::int n from chat_push_jobs where message_id=$1',[unread.id])).rows[0].n,0);
  await db.query('delete from chat_sessions where token_hash=$1',[hashA]);
  await assert.rejects(rpc('chat_save_push',[a.id,hashA,endpoint,'p256dh','auth',true]),e=>e.code==='42501');
  await assert.rejects(rpc('chat_touch_push',[a.id,hashA,endpoint]),e=>e.code==='42501');
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role};`);
    try {for(const table of ['chat_push_keyring','chat_push_subscriptions','chat_push_jobs','chat_notification_preferences'])
      await assert.rejects(db.query(`select * from ${table}`),e=>e.code==='42501');}
    finally{await db.exec('reset role;');}
  }
});
