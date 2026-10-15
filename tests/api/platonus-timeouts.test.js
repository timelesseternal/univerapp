import {sessionHeaders} from '../helpers/session.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import login from '../../api/login.js';
import schedule from '../../api/schedule.js';
import umkdFile from '../../api/umkd-file.js';

const session = Buffer.from(JSON.stringify({ sid: 'sid', token: 'token', cookie: 'sid=1' })).toString('base64');
const response = () => ({ setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; }, send(body) { this.body = body; } });
process.env.SUPABASE_URL='https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='server-only';
const routes = [
  { name: 'login', handler: login, duration: 12000, reader: 'json', req: { method: 'POST', body: { login: 'user', password: 'pass' } } },
  { name: 'schedule', handler: schedule, duration: 12000, reader: 'text', req: { headers: { ...sessionHeaders(session) }, query: { studentID: '7', year: '2026', term: '1', week: '7' } } },
  { name: 'umkd-file', handler: umkdFile, duration: 20000, reader: 'arrayBuffer', req: { headers: { ...sessionHeaders(session) }, query: { fileTypeID: '131', umkdid: '7' } } },
];

test('Platonus deadlines interrupt both the connection and response body', async t => {
  for (const route of routes) for (const phase of ['connection', 'body']) {
    await t.test(`${route.name}: ${phase}`, async t => {
      const deadlines = [];
      t.mock.method(AbortSignal, 'timeout', duration => {
        const controller = new AbortController(); deadlines.push({ controller, duration }); return controller.signal;
      });
      let reading = false;
      t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
        if (String(url).includes('/rpc/security_login_attempt')) return {ok:true,json:async()=>({allowed:true})};
        const blocked = () => new Promise((_, reject) => {
          reading = true;
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        return phase === 'connection' ? blocked() : { ok: true, status: 200, [route.reader]: blocked };
      });
      const res = response(); const running = route.handler(route.req, res);
      await new Promise(setImmediate);
      assert.equal(reading, true); assert.equal(deadlines.filter(d=>d.duration===route.duration).length, 1);
      assert.equal(deadlines.at(-1).duration, route.duration);
      deadlines.at(-1).controller.abort(new DOMException('deadline exceeded', 'TimeoutError'));
      await running;
      assert.equal(res.code, 502); assert.equal(res.body.error, 'platonus_unreachable');
      assert.equal(res.body.session, undefined);
    });
  }
});

test('schedule retries have independent deadlines', async t => {
  const signals = [];
  t.mock.method(AbortSignal, 'timeout', duration => {
    assert.equal(duration, 12000); return new AbortController().signal;
  });
  t.mock.method(globalThis, 'fetch', async (_, { signal }) => {
    signals.push(signal);
    return { status: 200, text: async () => JSON.stringify({ selectedStudyYear: 2026, selectedTerm: 1, selectedWeek: 7, timetable: { days: {} } }) };
  });
  const res = response(); await schedule({ headers: { ...sessionHeaders(session) }, query: { studentID: '7' } }, res);
  assert.equal(res.code, 200); assert.equal(signals.length, 2); assert.notEqual(signals[0], signals[1]);
});
