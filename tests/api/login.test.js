import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/login.js';

function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
}

test('login validates credentials without contacting Platonus', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = () => { throw new Error('unexpected_fetch'); };
  for (const body of [{ login: {}, password: 'x' }, { login: ' ', password: 'x' }, { login: 'x', password: 42 }]) {
    const res = response(); await handler({ method: 'POST', body }, res);
    assert.equal(res.code, 400);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});

test('HTTP login failures keep their meaning regardless of the response body', async t => {
  for (const status of [401, 403, 503]) {
    for (const body of [{}, '<html>login</html>', '']) {
      t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status,
        json: async () => { if (typeof body === 'string') throw new SyntaxError('not JSON'); return body; } }));
      const res = response(); await handler({ method: 'POST', body: { login: 'student', password: 'password' } }, res);
      assert.equal(res.code, status === 503 ? 502 : 401);
      assert.equal(res.body.error, status === 503 ? 'platonus_unreachable' : 'invalid_credentials');
      assert.equal(res.body.session, undefined); assert.equal(res.headers['Cache-Control'], 'no-store');
    }
  }
});

test('successful login requires every session component and retains all cookies', async t => {
  const data = { login_status: 'success', sid: 'sid', auth_token: 'token' };
  for (const missing of ['sid', 'auth_token', 'cookie', 'json']) {
    const payload = { ...data }; delete payload[missing];
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200,
      json: async () => { if (missing === 'json') throw new SyntaxError('invalid'); return payload; },
      headers: { getSetCookie: () => missing === 'cookie' ? [] : ['sid=1; HttpOnly'] } }));
    const res = response(); await handler({ method: 'POST', body: { login: 'student', password: 'password' } }, res);
    assert.equal(res.code, 502); assert.equal(res.body.error, 'platonus_bad_response'); assert.equal(res.body.session, undefined);
  }
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, json: async () => data,
    headers: { getSetCookie: () => ['sid=1; HttpOnly', 'auth=2; Expires=Wed, 21 Oct 2026 00:00:00 GMT'] } }));
  const res = response(); await handler({ method: 'POST', body: { login: 'student', password: 'password' } }, res);
  assert.equal(res.code, 200);
  assert.equal(JSON.parse(Buffer.from(res.body.session, 'base64').toString()).cookie, 'sid=1; auth=2');
});

test('login rejects upstream errors and incomplete sessions, issues a complete session', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const run = async (status, data, cookies = []) => {
    globalThis.fetch = async (_, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: status === 200, status, json: async () => data, headers: { getSetCookie: () => cookies } };
    };
    const res = response();
    await handler({ method: 'POST', body: { login: 'student', password: 'password' } }, res);
    return res;
  };
  assert.equal((await run(503, { login_status: 'success' })).code, 502);
  assert.equal((await run(401, {})).code, 401);
  const data = { login_status: 'success', sid: 'sid', auth_token: 'token' };
  assert.equal((await run(200, data)).code, 502);
  const success = await run(200, data, ['plt_sid=sid; HttpOnly']);
  assert.equal(success.code, 200);
  assert.deepEqual(JSON.parse(Buffer.from(success.body.session, 'base64').toString()), { sid: 'sid', token: 'token', cookie: 'plt_sid=sid' });
});
