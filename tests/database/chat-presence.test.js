import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

test('presence is participant-only, expires, keeps other tabs online and rejects stale events',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  for(const file of ['001_chat.sql','005_chat_presence.sql','005_chat_presence.sql'])
    await db.exec(readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
  const rpc=async(sql,args)=>(await db.query('select '+sql+' as result',args)).rows[0].result;
  const people=[],tokens=[];
  for(let n=1;n<=3;n++){
    tokens.push(randomUUID().replaceAll('-','').repeat(2));
    people.push(await rpc('chat_bootstrap($1,$2,$3,null)',[n,'Студент '+n,tokens[n-1]]));
  }
  const [a,b,outsider]=people.map(p=>p.id),chat=await rpc('chat_open_conversation($1,$2)',[a,b]);
  const first=randomUUID(),second=randomUUID();
  const seen=()=>rpc('chat_peer_presence($1,$2)',[b,chat.id]);
  const touch=(tab,active,seq)=>rpc('chat_touch_presence($1,$2,$3,$4,$5)',[a,tokens[0],tab,active,seq]);
  assert.deepEqual(await seen(),{lastSeen:null,online:false});
  await touch(first,true,1);assert.equal((await seen()).online,true);
  await touch(second,true,1);await touch(first,false,2);assert.equal((await seen()).online,true);
  await touch(second,false,2);assert.equal((await seen()).online,false);
  await touch(first,true,1);assert.equal((await seen()).online,false,'late heartbeat cannot undo offline');
  await touch(first,true,3);
  await db.exec("update chat_presence set online_until=clock_timestamp()-interval '1 second'");
  const expired=await seen();assert.equal(expired.online,false);assert.ok(Number.isFinite(Date.parse(expired.lastSeen)));
  await assert.rejects(rpc('chat_peer_presence($1,$2)',[outsider,chat.id]),e=>e.code==='42501');
  await assert.rejects(rpc('chat_touch_presence($1,$2,$3,true,1)',[a,tokens[2],randomUUID()]),e=>e.code==='42501');
  await db.exec('set role anon');
  await assert.rejects(seen(),e=>e.code==='42501');
  await assert.rejects(db.query('select * from chat_presence'),e=>e.code==='42501');
});
