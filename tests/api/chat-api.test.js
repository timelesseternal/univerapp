import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/chat.js';
import { COOKIE_NAME, tokenHash } from '../../api/_lib/chat.js';

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
  assert.equal(requests, 1);
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
