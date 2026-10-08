import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('Telegram queue and read acknowledgements run in PostgreSQL', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for (const name of ['001_chat.sql','002_telegram_notifications.sql','002_telegram_notifications.sql']) {
    await db.exec(readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
  }
  const rpc = async (sql,params=[]) => (await db.query('select '+sql+' as result',params)).rows[0].result;
  let student = 1000, telegram = 7000;
  async function pair() {
    const a=await rpc('chat_bootstrap($1,$2,$3,null)',[++student,'Автор',randomUUID().replaceAll('-','').repeat(2)]);
    const b=await rpc('chat_bootstrap($1,$2,$3,null)',[++student,'Получатель',randomUUID().replaceAll('-','').repeat(2)]);
    const id=(await rpc('chat_open_conversation($1,$2)',[a.id,b.id])).id;
    const tg=++telegram;
    await rpc('chat_link_telegram($1,$2)',[b.id,tg]);
    const message=await rpc('chat_send_message($1,$2,$3,$4)',[a.id,id,'Привет',randomUUID()]);
    return {a,b,id,tg,message};
  }
  const claim=(id,mode)=>rpc('chat_claim_notifications($1,$2)',[id,mode]);
  const finish=(job,outcome,telegramID=null)=>rpc('chat_finish_notification($1,$2,$3,$4)',[job.id,job.lease,outcome,telegramID]);
  const read=({b,id,message})=>rpc('chat_mark_read($1,$2,$3)',[b.id,id,message.id]);

  await t.test('message retries create one notification and other senders cannot claim it',async()=>{
    const p=await pair();
    await rpc('chat_send_message($1,$2,$3,$4)',[p.a.id,p.id,'Привет',p.message.clientID]);
    assert.equal((await db.query('select count(*)::int as n from chat_notifications where message_id=$1',[p.message.id])).rows[0].n,1);
    assert.deepEqual(await claim(p.b.id,'send'),[]);
    const jobs=await claim(p.a.id,'send');
    assert.equal(jobs.length,1); assert.equal(jobs[0].telegramID,String(p.tg));
    assert.equal(jobs[0].name,'Автор'); assert.deepEqual(await claim(p.a.id,'send'),[]);
  });
  await t.test('loading history does not mark read; visible acknowledgement allows deletion',async()=>{
    const p=await pair(); const [job]=await claim(p.a.id,'send');
    assert.equal(await finish(job,'sent',90),false);
    await rpc('chat_read_messages($1,$2,null,null)',[p.b.id,p.id]);
    assert.deepEqual(await claim(p.b.id,'delete'),[]);
    await read(p);
    const [deletion]=await claim(p.b.id,'delete'); assert.equal(deletion.telegramMessageID,90);
    await finish(deletion,'deleted'); assert.deepEqual(await claim(p.b.id,'delete'),[]);
  });
  await t.test('a read during Telegram delivery is detected at completion',async()=>{
    const p=await pair(); const [job]=await claim(p.a.id,'send');
    await read(p); assert.equal(await finish(job,'sent',91),true);
  });
  await t.test('a message read before delivery is suppressed',async()=>{
    const p=await pair(); await read(p); assert.deepEqual(await claim(p.a.id,'send'),[]);
    assert.equal((await db.query('select state from chat_notifications where message_id=$1',[p.message.id])).rows[0].state,'suppressed');
  });
  await t.test('account switching suppresses an old queued notification',async()=>{
    const p=await pair(); await rpc('chat_link_telegram($1,$2)',[p.a.id,p.tg]);
    assert.deepEqual(await claim(p.a.id,'send'),[]);
  });
  await t.test('a partial read cannot delete newer notifications and outsiders cannot acknowledge',async()=>{
    const p=await pair();
    await rpc('chat_send_message($1,$2,$3,$4)',[p.a.id,p.id,'Второе',randomUUID()]);
    const jobs=await claim(p.a.id,'send');
    for (const job of jobs) await finish(job,'sent',100+Number(job.id));
    await read(p);
    const deletions=await claim(p.b.id,'delete'); assert.equal(deletions.length,1); assert.equal(deletions[0].id,p.message.id);
    await assert.rejects(rpc('chat_mark_read($1,$2,$3)',[randomUUID(),p.id,p.message.id]),error=>error.code==='42501');
    await assert.rejects(rpc('chat_get_conversation($1,$2)',[randomUUID(),p.id]),error=>error.code==='42501');
  });
  await t.test('public roles cannot link an identity or inspect the notification queue',async()=>{
    await db.exec('set role authenticated;');
    await assert.rejects(db.query('select * from chat_notifications'),error=>error.code==='42501');
    await assert.rejects(rpc('chat_link_telegram($1,$2)',[randomUUID(),123]),error=>error.code==='42501');
    await db.exec('reset role;');
  });
});
