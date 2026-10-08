import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = fs.readFileSync(new URL('../../supabase/migrations/001_chat.sql', import.meta.url), 'utf8');
test('chat schema and privacy rules run in PostgreSQL', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(migration);
  await db.exec(migration);
  let nextStudent = 100;
  const rpc = async (sql, params) => (await db.query(`select ${sql} as result`, params)).rows[0].result;
  async function profile(name) {
    return rpc('chat_bootstrap($1, $2, $3, null)', [++nextStudent, name, randomUUID().replaceAll('-', '').repeat(2)]);
  }
  async function pair() {
    const a = await profile('Айгерім'), b = await profile('Даниил');
    const conversation = await rpc('chat_open_conversation($1, $2)', [a.id, b.id]);
    return { a, b, id: conversation.id };
  }

  await t.test('the same verified student retains one profile across devices', async () => {
    const hash = 'a'.repeat(64);
    const first = await rpc('chat_bootstrap($1, $2, $3, null)', [1, 'Студент', hash]);
    const second = await rpc('chat_bootstrap($1, $2, $3, $4)', [1, 'Студент Обновлённый', 'b'.repeat(64), hash]);
    assert.equal(first.id, second.id);
    assert.equal(second.name, 'Студент Обновлённый');
    assert.equal((await db.query('select count(*)::int as n from chat_sessions where token_hash=$1', [hash])).rows[0].n, 0);
  });
  await t.test('opening a conversation from either side creates one thread', async () => {
    const { a, b, id } = await pair();
    const reverse = await rpc('chat_open_conversation($1, $2)', [b.id, a.id]);
    assert.equal(reverse.id, id);
    await assert.rejects(rpc('chat_open_conversation($1, $2)', [a.id, a.id]), error => error.code === '22023');
  });
  await t.test('a send retry stores one message and preserves its text', async () => {
    const { a, id } = await pair(), client = randomUUID();
    const first = await rpc('chat_send_message($1,$2,$3,$4)', [a.id, id, '  Сәлем!  ', client]);
    const retry = await rpc('chat_send_message($1,$2,$3,$4)', [a.id, id, 'Сәлем!', client]);
    assert.equal(first.id, retry.id);
    assert.equal(retry.text, 'Сәлем!');
    assert.equal((await db.query('select count(*)::int as n from chat_messages where conversation_id=$1', [id])).rows[0].n, 1);
  });
  await t.test('an outsider cannot read, send, or discover a private thread', async () => {
    const { id } = await pair(), outsider = await profile('Другой студент');
    await assert.rejects(rpc('chat_read_messages($1,$2,null,null)', [outsider.id, id]), error => error.code === '42501');
    await assert.rejects(rpc('chat_send_message($1,$2,$3,$4)', [outsider.id, id, 'Нет доступа', randomUUID()]), error => error.code === '42501');
    assert.deepEqual(await rpc('chat_inbox($1)', [outsider.id]), []);
  });
  await t.test('public and authenticated database keys cannot impersonate chat users', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role};`);
      try {
        await assert.rejects(db.query('select * from chat_messages'), error => error.code === '42501');
        await assert.rejects(db.query('select * from chat_sessions'), error => error.code === '42501');
        await assert.rejects(db.query('select chat_inbox($1)', [randomUUID()]), error => error.code === '42501');
      } finally { await db.exec('reset role;'); }
    }
  });
  await t.test('the service role can execute RPCs with RLS enabled', async () => {
    await db.exec('set role service_role;');
    try {
      const value = await rpc('chat_bootstrap($1,$2,$3,null)', [++nextStudent, 'Проверенный пользователь', 'c'.repeat(64)]);
      assert.ok(value.id);
    } finally { await db.exec('reset role;'); }
  });
  await t.test('reading incoming messages clears only the recipient unread count', async () => {
    const { a, b, id } = await pair();
    await rpc('chat_send_message($1,$2,$3,$4)', [a.id, id, 'Привет', randomUUID()]);
    assert.equal((await rpc('chat_inbox($1)', [b.id]))[0].unread, 1);
    await rpc('chat_read_messages($1,$2,null,null)', [a.id, id]);
    assert.equal((await rpc('chat_inbox($1)', [b.id]))[0].unread, 1);
    await rpc('chat_read_messages($1,$2,null,null)', [b.id, id]);
    assert.equal((await rpc('chat_inbox($1)', [b.id]))[0].unread, 0);
  });
  await t.test('history and incremental cursors do not drop or duplicate messages', async () => {
    const { a, id } = await pair();
    await db.query(`insert into chat_messages(conversation_id,sender_id,client_id,body)
      select $1,$2,gen_random_uuid(),'Сообщение ' || n from generate_series(1,160) n`, [id, a.id]);
    const latest = await rpc('chat_read_messages($1,$2,null,null)', [a.id, id]);
    assert.equal(latest.messages.length, 50);
    assert.equal(latest.hasMore, true);
    const older = await rpc('chat_read_messages($1,$2,$3,null)', [a.id, id, latest.messages[0].id]);
    assert.equal(older.messages.length, 50);
    assert.ok(BigInt(older.messages.at(-1).id) < BigInt(latest.messages[0].id));
    const firstID = (await db.query('select min(id)::text as id from chat_messages where conversation_id=$1', [id])).rows[0].id;
    const newer = await rpc('chat_read_messages($1,$2,null,$3)', [a.id, id, firstID]);
    assert.equal(newer.messages.length, 100);
    assert.equal(newer.hasMore, true);
    const remaining = await rpc('chat_read_messages($1,$2,null,$3)', [a.id, id, newer.messages.at(-1).id]);
    assert.equal(remaining.messages.length, 59);
    assert.equal(remaining.hasMore, false);
  });
  await t.test('empty/oversized messages fail and the 30-per-minute limit permits retries', async () => {
    const { a, id } = await pair();
    for (const text of ['   ', 'a'.repeat(2001)]) {
      await assert.rejects(rpc('chat_send_message($1,$2,$3,$4)', [a.id, id, text, randomUUID()]), error => error.code === '22023');
    }
    const lastClient = randomUUID();
    for (let i = 0; i < 30; i++) await rpc('chat_send_message($1,$2,$3,$4)', [a.id, id, 'Привет', i === 29 ? lastClient : randomUUID()]);
    await assert.rejects(rpc('chat_send_message($1,$2,$3,$4)', [a.id, id, 'Лишнее', randomUUID()]), /chat_rate_limit/);
    assert.ok((await rpc('chat_send_message($1,$2,$3,$4)', [a.id, id, 'Привет', lastClient])).id);
  });
});
