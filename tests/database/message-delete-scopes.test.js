import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

test('personal deletion is account-private and deletion for both is participant-only',async t=>{
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for(const name of ['001_chat','002_telegram_notifications','007_message_actions','008_message_delete_scopes','008_message_delete_scopes'])
    await db.exec(fs.readFileSync(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),'utf8'));
  const rpc=async(name,args)=>(await db.query(`select ${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result;
  const people=[];
  for(let i=1;i<=3;i++) people.push(await rpc('chat_bootstrap',[i,`Студент ${i}`,randomUUID().replaceAll('-','').repeat(2),null]));
  const [a,b,c]=people;
  const ab=(await rpc('chat_open_conversation',[a.id,b.id])).id;
  const bc=(await rpc('chat_open_conversation',[b.id,c.id])).id;
  const send=(user,where,text,reply=null,forward=null,client=randomUUID())=>rpc('chat_send_message_v3',[user,where,text,client,reply,forward]);
  const original=await send(a.id,ab,'Это останется у собеседника');
  const reply=await send(b.id,ab,'Ответ',original.id);
  const read=(user,revision=0,after=null)=>rpc('chat_read_messages_v3',[user,ab,null,after,revision]);
  assert.equal(await rpc('chat_delete_message_v2',[b.id,ab,original.id,'self']),true);
  assert.equal(await rpc('chat_delete_message_v2',[b.id,ab,original.id,'self']),true);
  const mine=await read(b.id),theirs=await read(a.id);
  assert.equal(mine.revision,'1'); assert.equal(mine.deleteScopes,true);
  assert.deepEqual(mine.hiddenIDs,[original.id]);
  assert.equal(mine.messages.length,1);
  assert.equal((await rpc('chat_message_view',[b.id,original.id])).hidden,true);
  assert.equal(mine.messages[0].reply.text,'Сообщение удалено');
  assert.equal(theirs.messages[0].text,original.text);
  assert.equal(theirs.messages[1].reply.text,original.text);
  assert.deepEqual(theirs.hiddenIDs,[]);
  assert.deepEqual((await read(b.id,0,reply.id)).hiddenIDs,[original.id]);
  assert.deepEqual((await read(b.id,1,reply.id)).hiddenIDs,[]);
  await assert.rejects(send(b.id,bc,'',null,original.id),e=>e.code==='42501');
  await assert.rejects(send(b.id,ab,'Ответ на скрытое',original.id),e=>e.code==='42501');
  // Hiding the most recent message changes only this account's inbox preview.
  await rpc('chat_delete_message_v2',[b.id,ab,reply.id,'self']);
  assert.equal((await rpc('chat_inbox',[b.id])).find(c=>c.id===ab).lastMessage,null);
  assert.equal((await rpc('chat_inbox',[a.id])).find(c=>c.id===ab).lastMessage.text,'Ответ');
  // Either participant can remove a message for both, as in a private Telegram chat.
  assert.equal(await rpc('chat_delete_message_v2',[b.id,ab,original.id,'everyone']),true);
  assert.equal((await read(a.id)).messages.length,1);
  assert.equal((await read(a.id)).messages[0].reply.deleted,true);
  assert.equal((await rpc('chat_inbox',[b.id])).find(c=>c.id===ab).unread,0);
  await assert.rejects(rpc('chat_delete_message_v2',[c.id,ab,reply.id,'everyone']),e=>e.code==='42501');
  await assert.rejects(rpc('chat_delete_message_v2',[b.id,bc,reply.id,'self']),e=>e.code==='42501');
  await assert.rejects(rpc('chat_delete_message_v2',[a.id,ab,reply.id,'invalid']),e=>e.code==='22023');
  assert.equal(await rpc('chat_message_view',[c.id,reply.id]),null);
  const keeper=await send(a.id,ab,'Более раннее видимое сообщение');
  await db.query(`insert into chat_messages(conversation_id,sender_id,client_id,body)
    select $1,$2,gen_random_uuid(),'hidden-batch' from generate_series(1,60)`,[ab,a.id]);
  await db.query(`update chat_conversations set message_revision=message_revision+1 where id=$1`,[ab]);
  await db.query(`insert into chat_message_hides(user_id,message_id,revision)
    select $1,m.id,c.message_revision from chat_messages m join chat_conversations c on c.id=m.conversation_id
    where c.id=$2 and m.body='hidden-batch'`,[b.id,ab]);
  assert.deepEqual((await read(b.id)).messages.map(m=>m.id),[keeper.id]);
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role};`);
    try {
      await assert.rejects(db.query('select * from chat_message_hides'),e=>e.code==='42501');
      await assert.rejects(rpc('chat_delete_message_v2',[a.id,ab,reply.id,'self']),e=>e.code==='42501');
    } finally { await db.exec('reset role;'); }
  }
});
