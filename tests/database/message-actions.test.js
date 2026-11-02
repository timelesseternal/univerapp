import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

test('message actions enforce membership, ownership, idempotency and deletion synchronization', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for (const name of ['001_chat','002_telegram_notifications','007_message_actions','007_message_actions'])
    await db.exec(fs.readFileSync(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),'utf8'));
  const rpc = async (name,values) => (await db.query(`select ${name}(${values.map((_,i)=>`$${i+1}`).join(',')}) as result`,values)).rows[0].result;
  const people = [];
  for (let i=1;i<=3;i++) people.push(await rpc('chat_bootstrap',[i,`Студент ${i}`,randomUUID().replaceAll('-','').repeat(2),null]));
  const [a,b,c] = people;
  const ab = (await rpc('chat_open_conversation',[a.id,b.id])).id;
  const bc = (await rpc('chat_open_conversation',[b.id,c.id])).id;
  const send = (who,where,text,reply=null,forward=null,client=randomUUID()) => rpc('chat_send_message_v2',[who,where,text,client,reply,forward]);
  const original = await send(a.id,ab,'Исходное сообщение');
  const response = await send(b.id,ab,'Отвечаю',original.id);
  assert.equal(response.reply.text,'Исходное сообщение');
  assert.equal(response.reply.name,'Студент 1');
  await assert.rejects(send(c.id,bc,'Чужая цитата',original.id),e=>e.code==='22023');
  await assert.rejects(send(c.id,bc,'',null,original.id),e=>e.code==='42501');
  const client=randomUUID();
  const forwarded=await send(b.id,bc,'Подменённый текст',null,original.id,client);
  assert.equal(forwarded.text,'Исходное сообщение');
  assert.equal(forwarded.forwardedName,'Студент 1');
  assert.equal(forwarded.reply,null);
  assert.equal((await send(b.id,bc,'Дубликат',null,original.id,client)).id,forwarded.id);
  await assert.rejects(rpc('chat_delete_message',[b.id,ab,original.id]),e=>e.code==='42501');
  await assert.rejects(rpc('chat_delete_message',[a.id,bc,original.id]),e=>e.code==='42501');
  assert.equal(await rpc('chat_delete_message',[a.id,ab,original.id]),true);
  assert.equal((await rpc('chat_inbox',[b.id]))[0].unread,0);
  assert.equal(await rpc('chat_delete_message',[a.id,ab,original.id]),true);
  const page=await rpc('chat_read_messages_v2',[b.id,ab,null,null,0]);
  assert.equal(page.revision,'1');
  assert.deepEqual(page.deletedIDs,[original.id]);
  assert.equal(page.messages[0].text,'Сообщение удалено');
  assert.equal(page.messages[0].deleted,true);
  assert.equal(page.messages[1].reply.text,'Сообщение удалено');
  const incremental=await rpc('chat_read_messages_v2',[b.id,ab,null,response.id,0]);
  assert.deepEqual(incremental.messages,[]);
  assert.deepEqual(incremental.deletedIDs,[original.id]);
  assert.deepEqual((await rpc('chat_read_messages_v2',[b.id,ab,null,response.id,1])).deletedIDs,[]);
  assert.equal((await rpc('chat_read_messages_v2',[c.id,bc,null,null,0])).messages[0].text,'Исходное сообщение');
  await assert.rejects(send(b.id,ab,'Поздний ответ',original.id),e=>e.code==='22023');
  await assert.rejects(send(b.id,bc,'',null,original.id),e=>e.code==='42501');
  await assert.rejects(rpc('chat_read_messages_v2',[c.id,ab,null,null,0]),e=>e.code==='42501');
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role};`);
    try { await assert.rejects(rpc('chat_message_json',[response.id]),e=>e.code==='42501'); }
    finally { await db.exec('reset role;'); }
  }
});
