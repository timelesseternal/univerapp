import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';

// Private snapshot and generated SQL belong outside the repository.
const directory=process.argv[2];
if(!directory)throw new Error('Pass the private backup directory');
const snapshot=JSON.parse(readFileSync(join(directory,'sydney-backup.json'),'utf8'));
assert.equal(snapshot.authUsers,0,'Auth users require a separate migration');
assert.equal(snapshot.storageObjects,0,'Storage objects require a separate migration');
assert.ok(!snapshot.storageBuckets?.length,'Storage buckets require a separate migration');
assert.ok(!snapshot.policies?.length,'Review custom policies before restoring');
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const tables=snapshot.tables.map(t=>t.name);
const expected=['chat_profiles','chat_conversations','chat_messages','chat_sessions','chat_presence','chat_telegram_links','chat_notifications','security_login_limits'];
assert.deepEqual([...tables].sort(),[...expected].sort());
const lines=['begin;','set local search_path=public;'];
// Refuse an occupied target rather than deleting or overwriting its contents.
lines.push(`do $$ begin if exists(select 1 from pg_tables where schemaname='public') then raise exception 'Target public schema is not empty'; end if; end $$;`);
for(const name of tables){
  const columns=snapshot.columns.filter(c=>c.table===name).sort((a,b)=>a.position-b.position);
  const sqlColumns=columns.map(c=>{
    assert.equal(c.generated,'');
    assert.ok(/^(uuid|bigint|integer|numeric|text|timestamp with time zone)$/.test(c.type));
    return `${quote(c.name)} ${c.type}${c.identity?` generated ${c.identity==='a'?'always':'by default'} as identity`:c.default?' default '+c.default:''}${c.notnull?' not null':''}`;
  });
  lines.push(`create table public.${quote(name)} (${sqlColumns.join(',')});`);
  lines.push(`revoke all on public.${quote(name)} from public,anon,authenticated;`);
  if(snapshot.tables.find(t=>t.name===name).rls)lines.push(`alter table public.${quote(name)} enable row level security;`);
}
for(const constraint of [...snapshot.constraints].sort((a,b)=>(a.type==='f')-(b.type==='f'))){
  lines.push(`alter table public.${quote(constraint.table)} add constraint ${quote(constraint.name)} ${constraint.definition};`);
}
const backedIndexes=new Set(snapshot.constraints.filter(c=>['p','u','x'].includes(c.type)).map(c=>c.name));
for(const index of snapshot.indexes)if(!backedIndexes.has(index.name))lines.push(index.definition+';');
for(const name of expected){
  const columns=snapshot.columns.filter(c=>c.table===name).sort((a,b)=>a.position-b.position).map(c=>quote(c.name)).join(',');
  const json=JSON.stringify(snapshot.data[name]);
  assert.ok(!json.includes('$unilink_data$'));
  if(snapshot.data[name].length)lines.push(`insert into public.${quote(name)} (${columns}) overriding system value select ${columns} from jsonb_populate_recordset(null::public.${quote(name)},$unilink_data$${json}$unilink_data$::jsonb);`);
}
for(const fn of snapshot.functions){
  assert.ok(/^(chat_|security_login_attempt)/.test(fn.name));
  assert.equal(fn.acl,'{postgres=X/postgres,service_role=X/postgres}');
  lines.push(fn.definition+';');
  lines.push(`revoke all on function public.${quote(fn.name)}(${fn.identity}) from public,anon,authenticated;`);
  lines.push(`grant execute on function public.${quote(fn.name)}(${fn.identity}) to service_role;`);
}
for(const trigger of snapshot.triggers||[])lines.push(trigger+';');
for(const name of tables)lines.push(`grant all on public.${quote(name)} to service_role;`);
for(const sequence of snapshot.sequences){
  const name=`public.${quote(sequence.sequencename)}`;
  lines.push(`select setval(${literal(name)},${sequence.last_value??sequence.start_value},${sequence.last_value!==null});`);
  lines.push(`revoke all on sequence ${name} from public,anon,authenticated; grant usage,select on sequence ${name} to service_role;`);
}
lines.push('commit;');
const sql=lines.join('\n');
const db=new PGlite();
try{
  await db.exec("set timezone='UTC'; create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(sql);
  for(const name of tables){
    const restored=(await db.query(`select to_jsonb(t) as row from public.${quote(name)} t`)).rows.map(x=>x.row);
    const canonical=rows=>rows.map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))).sort();
    assert.ok(JSON.stringify(canonical(restored))===JSON.stringify(canonical(snapshot.data[name])),'Data mismatch: '+name);
  }
  const privileges=await db.query("select count(*)::int as count from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','PUBLIC')");
  assert.equal(privileges.rows[0].count,0);
  await db.exec('set role anon;');
  await assert.rejects(db.query('select * from public.chat_messages'),e=>e.code==='42501');
  await db.exec('reset role;');
  await assert.rejects(db.exec(sql),/Target public schema is not empty/);
}finally{await db.close();}
writeFileSync(join(directory,'restore-frankfurt.sql'),sql);
writeFileSync(join(directory,'transfer-summary.json'),JSON.stringify({tables:tables.length,functions:snapshot.functions.length,rows:Object.fromEntries(Object.entries(snapshot.data).map(([name,rows])=>[name,rows.length])),localRestoreVerified:true},null,2));
console.log('Restore SQL prepared; every table verified locally; public access denied. Private data was not printed.');
