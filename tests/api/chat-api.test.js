import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/chat.js';
import { COOKIE_NAME, tokenHash, startSession, syncOwnStudyProfile, restoreVerifiedStudyProfile } from '../../api/_lib/chat.js';

const user = '11111111-1111-4111-8111-111111111111';
const conversation = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333';
function setup(t, fetcher) {
  const oldFetch = global.fetch;
  const oldURL = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-server-key';
  global.fetch = fetcher;
  t.after(() => {
    global.fetch = oldFetch;
    if (oldURL === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldURL;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  });
}
async function call({ method = 'GET', action = 'inbox', headers = {}, query = {}, body } = {}) {
  const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(value) { this.code = value; return this; }, json(value) { this.body = value; } };
  await handler({ method, query: { action, ...query }, headers: { host: 'univer.test', ...headers }, body }, res);
  return res;
}
const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

test('a verified student recovers saved study details across devices without replacing fresh fields',async t=>{
  let calls=0;
  setup(t,async url=>{
    calls++;assert.ok(url.includes('student_id=eq.23'));
    return reply([{student_id:23,study_group:'DS-24-1к',study_course:3}]);
  });
  assert.deepEqual(await restoreVerifiedStudyProfile({studentID:23,academicGpa:3.45,courseNumber:4}),
    {studentID:23,academicGpa:3.45,courseNumber:4,studentGroupName:'DS-24-1к'});
  assert.deepEqual(await restoreVerifiedStudyProfile({studentID:23,studentGroupName:'Новая',courseNumber:4}),
    {studentID:23,studentGroupName:'Новая',courseNumber:4});
  assert.equal(calls,1);
});

test('saved study recovery ignores mismatched identity and an unavailable database',async t=>{
  let failure=false;
  setup(t,async()=>{
    if(failure)throw new Error('offline');
    return reply([{student_id:24,study_group:'Чужая',study_course:2}]);
  });
  const student={studentID:23,academicGpa:3.45};
  assert.deepEqual(await restoreVerifiedStudyProfile(student),student);
  failure=true;assert.deepEqual(await restoreVerifiedStudyProfile(student),student);
});

test('an existing cookie resumes the same student without contacting Platonus', async t => {
  setup(t, async url => {
    assert.ok(url.startsWith('https://test.supabase.co/'));
    if (url.includes('/chat_sessions?')) return reply([{ user_id: user }]);
    if (url.includes('/chat_profiles?')) return reply([{ id:user, student_id:23, display_name:'Студент' }]);
    assert.ok(url.endsWith('/rpc/chat_inbox'));return reply([]);
  });
  const headers={cookie:`${COOKIE_NAME}=${'a'.repeat(64)}`};
  const result=await call({action:'session',query:{studentID:'23'},headers});
  assert.equal(result.code,200);assert.deepEqual(result.body,{profile:{id:user,name:'Студент'},conversations:[]});
});

test('resuming another student rejects the cookie before reading the inbox', async t => {
  setup(t, async url => {
    if (url.includes('/chat_sessions?')) return reply([{ user_id: user }]);
    assert.ok(url.includes('/chat_profiles?'));
    return reply([{id:user,student_id:23,display_name:'Студент'}]);
  });
  const result=await call({action:'session',query:{studentID:'24'},headers:{cookie:`${COOKIE_NAME}=${'a'.repeat(64)}`}});
  assert.equal(result.code,401);assert.equal(result.body.error,'chat_session_expired');
});

test('GPA refresh syncs the same student and preserves study fields on a transcript timeout', async t => {
  let saved;
  setup(t, async (url, options) => {
    if (url.includes('/chat_sessions?')) return reply([{ user_id: user }]);
    if (url.includes('/chat_profiles?')) return reply([{ student_id: 23, academic_gpa: 3, study_group: 'DS-24-1к', study_course: 3 }]);
    assert.ok(url.endsWith('/rpc/chat_sync_student_profile'));
    saved = JSON.parse(options.body);
    return reply(null);
  });
  const req = { headers: { cookie: `${COOKIE_NAME}=${'a'.repeat(64)}` } };
  await syncOwnStudyProfile(req, { studentID: 23, academicGpa: '3,5' });
  assert.deepEqual(saved, { p_user_id: user, p_academic_gpa: 3.5, p_group: 'DS-24-1к', p_course: 3 });
  saved = undefined;
  await syncOwnStudyProfile(req, { studentID: 99, academicGpa: 4, studentGroupName: 'Подмена', courseNumber: 1 });
  assert.equal(saved, undefined);
  await syncOwnStudyProfile(req, { studentID: 23, academicGpa: 3.75, studentGroupName: 'DS-24-2к', courseNumber: 4 });
  assert.deepEqual(saved, { p_user_id: user, p_academic_gpa: 3.75, p_group: 'DS-24-2к', p_course: 4 });
});

test('an older database returns the verified base peer profile without academic fields', async t => {
  setup(t, async url => {
    if (url.includes('/chat_sessions?')) return reply([{ user_id: user }]);
    if (url.endsWith('/rpc/chat_peer_profile')) return reply({ code: 'PGRST202' }, 404);
    if (url.includes('/chat_conversations?')) {
      assert.ok(url.includes(`id=eq.${conversation}`));
      assert.ok(url.includes(`user_a.eq.${user},user_b.eq.${user}`));
      return reply([{ user_a: user, user_b: client }]);
    }
    assert.ok(url.includes(`chat_profiles?select=id,student_id,display_name&id=eq.${client}`));
    return reply([{ id: client, student_id: 23, display_name: 'Друг' }]);
  });
  const result = await call({ action: 'profile', query: { conversationID: conversation, peerID: user },
    headers: { cookie: `${COOKIE_NAME}=${'a'.repeat(64)}` } });
  assert.equal(result.code, 200);
  assert.equal(result.body.profile.name, 'Друг');
  assert.equal(result.body.profile.studentID, 23);
  assert.equal(result.body.profile.studyAvailable, false);
  assert.equal(result.body.profile.academicGpa, null);
});

test('base profile fallback rejects outsiders before reading any private profile', async t => {
  setup(t, async url => {
    if (url.includes('/chat_sessions?')) return reply([{ user_id: user }]);
    if (url.endsWith('/rpc/chat_peer_profile')) return reply({ code: 'PGRST202' }, 404);
    assert.ok(url.includes('/chat_conversations?'));
    return reply([]);
  });
  const result = await call({ action: 'profile', query: { conversationID: conversation },
    headers: { cookie: `${COOKIE_NAME}=${'a'.repeat(64)}` } });
  assert.equal(result.code, 403);
});

test('typing identity comes from the cookie and rejects malformed activity', async t => {
  let activity;
  setup(t, async (url, options) => {
    if (url.includes('/chat_sessions?')) return reply([{ user_id: user }]);
    assert.ok(url.endsWith('/rpc/chat_set_typing'));
    activity = JSON.parse(options.body);
    return reply(true);
  });
  const headers = { cookie: `${COOKIE_NAME}=${'a'.repeat(64)}` };
  const result = await call({ method: 'POST', action: 'typing', headers,
    body: { conversationID: conversation, typing: true, userID: client, text: 'Never stored' } });
  assert.equal(result.code, 200);
  assert.deepEqual(activity, { p_user_id: user, p_conversation_id: conversation, p_typing: true });
  const invalid = await call({ method: 'POST', action: 'typing', headers,
    body: { conversationID: conversation, typing: 'true' } });
  assert.equal(invalid.code, 400);
});

test('messages remain available before the optional typing migration is applied', async t => {
  setup(t, async url => {
    if (url.includes('/chat_sessions?')) return reply([{ user_id: user }]);
    if (url.endsWith('/rpc/chat_read_messages')) return reply({ messages: [], hasMore: false });
    if (url.endsWith('/rpc/chat_peer_typing')) return reply({ code: 'PGRST202' }, 404);
    return reply([]);
  });
  const result = await call({ action: 'messages', query: { conversationID: conversation },
    headers: { cookie: `${COOKIE_NAME}=${'a'.repeat(64)}` } });
  assert.equal(result.code, 200);
  assert.deepEqual(result.body, { messages: [], hasMore: false, peerTyping: false });
});

test('slow Platonus transcript refresh does not delay the inbox and still syncs verified study details', async t => {
  let releaseTranscript, background, synced;
  setup(t, async (url, options) => {
    if (url.endsWith('/rest/transcript/load/ru/0')) return new Promise(resolve => { releaseTranscript = resolve; });
    if (url.includes('platonus.kstu.kz')) return reply({ studentID: 91, studentName: 'Студент', academicGpa: 3.25 });
    if (url.endsWith('/rpc/chat_bootstrap')) return reply({ id: user, name: 'Студент' });
    if (url.endsWith('/rpc/chat_inbox')) return reply([{ id: conversation }]);
    assert.ok(url.endsWith('/rpc/chat_sync_student_profile'));
    synced = JSON.parse(options.body);
    return reply({});
  });
  const session = Buffer.from(JSON.stringify({ sid: 'sid', token: 'token', cookie: 'cookie' })).toString('base64');
  const res = { setHeader() {} };
  const task = startSession({ headers: { 'x-session': session } }, res, promise => { background = promise; });
  const result = await Promise.race([task, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Inbox waited for the transcript')), 1000);
    task.finally(() => clearTimeout(timer));
  })]);
  assert.deepEqual(result.conversations, [{ id: conversation }]);
  assert.equal(synced, undefined);
  releaseTranscript(reply({ student: { personID: 91, groupName: 'DS-24-1к', courseNumber: 3 } }));
  await background;
  assert.deepEqual(synced, { p_user_id: user, p_academic_gpa: 3.25, p_group: 'DS-24-1к', p_course: 3 });
});

test('missing configuration leaves the existing application usable and reports chat unavailable', async t => {
  setup(t, () => { throw new Error('Unexpected network'); });
  delete process.env.SUPABASE_URL;
  const res = await call({ method: 'POST', action: 'session' });
  assert.equal(res.code, 503);
  assert.equal(res.body.error, 'chat_not_configured');
});
test('chat identity comes from Platonus, ignoring browser-supplied identity', async t => {
  let bootstrap;
  setup(t, async (url, options) => {
    if (url.includes('platonus.kstu.kz')) {
      assert.equal(options.headers.Sid, 'sid');
      return reply({ studentID: 91, studentName: 'Айгерім Студент' });
    }
    if (url.endsWith('/rpc/chat_inbox')) return reply([]);
    assert.ok(url.endsWith('/rpc/chat_bootstrap'));
    bootstrap = JSON.parse(options.body);
    return reply({ id: user, name: 'Айгерім Студент' });
  });
  const session = Buffer.from(JSON.stringify({ sid: 'sid', token: 'token', cookie: 'cookie' })).toString('base64');
  const res = await call({ method: 'POST', action: 'session', headers: { 'x-session': session, 'x-forwarded-proto': 'https' }, body: { studentID: 999, name: 'Подмена' } });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.conversations, []);
  assert.equal(bootstrap.p_student_id, 91);
  assert.equal(bootstrap.p_display_name, 'Айгерім Студент');
  assert.ok(res.headers['Set-Cookie'].includes('HttpOnly; SameSite=Strict'));
  assert.ok(res.headers['Set-Cookie'].includes('; Secure'));
  const token = res.headers['Set-Cookie'].split(';')[0].split('=')[1];
  assert.equal(bootstrap.p_token_hash, tokenHash(token));
  assert.ok(!JSON.stringify(res.body).includes(token));
});
test('a forged or rejected Platonus session never creates a chat profile', async t => {
  let requests = 0;
  setup(t, async url => { requests++; assert.ok(url.includes('platonus.kstu.kz')); return reply({}, 401); });
  const session = Buffer.from(JSON.stringify({ sid: 'fake', token: 'fake', cookie: 'fake' })).toString('base64');
  const res = await call({ method: 'POST', action: 'session', headers: { 'x-session': session } });
  assert.equal(res.code, 401);
  assert.equal(requests, 2);
  assert.equal(res.headers['Set-Cookie'], undefined);
});
test('cross-origin writes are rejected before touching the database', async t => {
  setup(t, () => { throw new Error('Unexpected network'); });
  const res = await call({ method: 'POST', action: 'messages', headers: { origin: 'https://other.test' } });
  assert.equal(res.code, 403);
});
test('message sender is derived from the opaque session, not the request body', async t => {
  setup(t, async (url, options) => {
    if (url.includes('/chat_sessions?')) return reply([{ user_id: user }]);
    const body = JSON.parse(options.body);
    assert.equal(body.p_user_id, user);
    assert.equal(body.p_body, 'Привет');
    return reply({ id: '1', senderID: user, text: 'Привет' });
  });
  const res = await call({ method: 'POST', action: 'messages', headers: { cookie: `${COOKIE_NAME}=${'a'.repeat(64)}` }, body: { conversationID: conversation, clientID: client, text: ' Привет ', senderID: client } });
  assert.equal(res.code, 200);
  assert.equal(res.body.message.senderID, user);
  assert.match(res.headers['Cache-Control'], /no-store/);
});
test('expired and missing chat sessions cannot read messages', async t => {
  setup(t, async () => reply([]));
  for (const headers of [{}, { cookie: `${COOKIE_NAME}=${'a'.repeat(64)}` }]) {
    const res = await call({ action: 'messages', query: { conversationID: conversation }, headers });
    assert.equal(res.code, 401);
  }
});
test('database participant rejection becomes a safe 403 response', async t => {
  setup(t, async url => url.includes('/chat_sessions?') ? reply([{ user_id: user }]) : reply({ code: '42501', message: 'private detail' }, 403));
  const res = await call({ action: 'messages', headers: { cookie: `${COOKIE_NAME}=${'a'.repeat(64)}` }, query: { conversationID: conversation } });
  assert.equal(res.code, 403);
  assert.deepEqual(res.body, { error: 'chat_forbidden' });
});
test('bad message cursors are rejected instead of being interpolated into queries', async t => {
  setup(t, async () => reply([{ user_id: user }]));
  const res = await call({ action: 'messages', headers: { cookie: `${COOKIE_NAME}=${'a'.repeat(64)}` }, query: { conversationID: conversation, before: '1&select=*' } });
  assert.equal(res.code, 400);
});
test('logout clears the cookie even when session revocation is unavailable', async t => {
  setup(t, async () => { throw new Error('Offline'); });
  const res = await call({ method: 'DELETE', action: 'session', headers: { cookie: `${COOKIE_NAME}=${'a'.repeat(64)}` } });
  assert.equal(res.code, 503);
  assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
});
