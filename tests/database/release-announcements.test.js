import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';
test('the release delivery ledger is private and enforces one claim per recipient and version',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  const sql=readFileSync(new URL('../../supabase/migrations/009_release_announcements.sql',import.meta.url),'utf8');
  await db.exec(sql);await db.exec(sql);
  const insert="insert into chat_release_deliveries(release_id,telegram_id,state) values($1,1,'sending') on conflict do nothing returning *";
  assert.equal((await db.query(insert,['a'.repeat(64)])).rows.length,1);
  assert.equal((await db.query(insert,['a'.repeat(64)])).rows.length,0);
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role};`);
    try {await assert.rejects(db.query('select * from chat_release_deliveries'),e=>e.code==='42501');}
    finally {await db.exec('reset role;');}
  }
});
