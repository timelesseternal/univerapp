import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { verifiedStudyProfile } from '../../api/_lib/chat.js';
test('verified profile normalizes GPA, group and course without inventing missing data', () => {
  assert.deepEqual(verifiedStudyProfile({ academicGpa: '3,25', group: { name: ' ИС-23 ' }, course: '3' }),
    { p_academic_gpa: 3.25, p_group: 'ИС-23', p_course: 3 });
  assert.deepEqual(verifiedStudyProfile({ academicGpa: '', course: 2026 }),
    { p_academic_gpa: null, p_group: null, p_course: null });
});
test('peer academic profiles are accessible only to conversation participants', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for (const file of ['001_chat.sql', '003_peer_profiles.sql', '003_peer_profiles.sql'])
    await db.exec(readFileSync(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8'));
  const rpc = async (sql, args) => (await db.query('select ' + sql + ' as result', args)).rows[0].result;
  const people = [];
  for (let n = 1; n <= 3; n++) people.push(await rpc('chat_bootstrap($1,$2,$3,null)', [n, 'Студент ' + n, randomUUID().replaceAll('-', '').repeat(2)]));
  const conversation = await rpc('chat_open_conversation($1,$2)', [people[0].id, people[1].id]);
  await rpc('chat_sync_student_profile($1,$2,$3,$4)', [people[1].id, 3.25, 'ИС-23', 3]);
  const profile = await rpc('chat_peer_profile($1,$2)', [people[0].id, conversation.id]);
  assert.equal(profile.studentID, 2); assert.equal(profile.academicGpa, 3.25);
  assert.equal(profile.group, 'ИС-23'); assert.equal(profile.course, 3);
  await assert.rejects(rpc('chat_peer_profile($1,$2)', [people[2].id, conversation.id]), e => e.code === '42501');
  await db.exec('set role anon');
  await assert.rejects(rpc('chat_peer_profile($1,$2)', [people[0].id, conversation.id]), e => e.code === '42501');
  await assert.rejects(rpc('chat_sync_student_profile($1,$2,$3,$4)', [people[1].id, 4, 'fake', 1]), e => e.code === '42501');
});
