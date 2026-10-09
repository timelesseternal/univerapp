import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('typing is private, expires without a disconnect signal, and supports repeated migration', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for (const file of ['001_chat.sql', '004_chat_typing.sql', '004_chat_typing.sql'])
    await db.exec(readFileSync(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8'));
  const rpc = async (sql, args) => (await db.query('select ' + sql + ' as result', args)).rows[0].result;
  const people = [];
  for (let n = 1; n <= 3; n++) people.push(await rpc('chat_bootstrap($1,$2,$3,null)', [n, 'Студент ' + n, randomUUID().replaceAll('-', '').repeat(2)]));
  const chat = await rpc('chat_open_conversation($1,$2)', [people[0].id, people[1].id]);
  const a = people[0].id, b = people[1].id, stranger = people[2].id;
  await rpc('chat_set_typing($1,$2,true)', [a, chat.id]);
  assert.equal(await rpc('chat_peer_typing($1,$2)', [b, chat.id]), true);
  assert.equal(await rpc('chat_peer_typing($1,$2)', [a, chat.id]), false);
  await rpc('chat_set_typing($1,$2,false)', [a, chat.id]);
  assert.equal(await rpc('chat_peer_typing($1,$2)', [b, chat.id]), false);
  await db.query("update chat_conversations set typing_a_until = now() - interval '1 second', typing_b_until = now() - interval '1 second' where id=$1", [chat.id]);
  assert.equal(await rpc('chat_peer_typing($1,$2)', [b, chat.id]), false);
  await assert.rejects(rpc('chat_set_typing($1,$2,true)', [stranger, chat.id]), e => e.code === '42501');
  await assert.rejects(rpc('chat_peer_typing($1,$2)', [stranger, chat.id]), e => e.code === '42501');
  await db.exec('set role anon');
  await assert.rejects(rpc('chat_peer_typing($1,$2)', [b, chat.id]), e => e.code === '42501');
  await assert.rejects(rpc('chat_set_typing($1,$2,true)', [a, chat.id]), e => e.code === '42501');
});
