import {sessionHeaders} from '../helpers/session.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/schedule.js';

const session = Buffer.from(JSON.stringify({ sid: 'sid', token: 'token', cookie: 'sid=1' })).toString('base64');
const emptyWeek = () => ({ selectedStudyYear: 2026, selectedTerm: 1, selectedWeek: 7, timetable: { days: {} } });
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } });

test('a failed schedule retry is never returned as a confirmed empty week', async t => {
  for (const failure of [401, 403, 503, 'timeout', 'invalid_json', 'invalid_shape']) {
    await t.test(String(failure), async t => {
      const calls = [];
      t.mock.method(globalThis, 'fetch', async (_, options) => {
        calls.push(JSON.parse(options.body));
        if (calls.length === 1) return { status: 200, text: async () => JSON.stringify(emptyWeek()) };
        if (failure === 'timeout') throw new DOMException('timeout', 'TimeoutError');
        return { status: typeof failure === 'string' ? 200 : failure, text: async () => failure === 'invalid_shape' ? 'null' : 'not JSON' };
      });
      const res = response();
      await handler({ headers: { ...sessionHeaders(session) }, query: { studentID: 7 } }, res);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1], { studentTypeID: 1, statusID: 1, disciplineStudyLanguageIds: [1, 2, 3], studyYear: 2026, term: 1, week: 7 });
      assert.equal(res.code, failure === 401 || failure === 403 ? 401 : 502);
      assert.equal(res.body.error, failure === 401 || failure === 403 ? 'session_expired'
        : failure === 'timeout' ? 'platonus_unreachable' : typeof failure === 'string' ? 'platonus_bad_json' : 'platonus_bad_status');
      assert.equal(res.body.timetable, undefined);
      assert.match(res.headers['Cache-Control'], /no-store/);
    });
  }
});

test('non-object schedule JSON is rejected without crashing or confirming an empty week', async t => {
  for (const rawText of ['null', '[]', '"schedule"', '42']) {
    t.mock.method(globalThis, 'fetch', async () => ({ status: 200, text: async () => rawText }));
    const res = response();
    await handler({ headers: { ...sessionHeaders(session) }, query: { studentID: 7 } }, res);
    assert.equal(res.code, 502); assert.equal(res.body.error, 'platonus_bad_json');
  }
});

test('an explicit successful empty week is confirmed without another request', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return { status: 200, text: async () => JSON.stringify(emptyWeek()) }; });
  const res = response();
  await handler({ headers: { ...sessionHeaders(session) }, query: { studentID: 7, year: '2026', term: '1', week: '7' } }, res);
  assert.equal(calls, 1); assert.equal(res.code, 200);
  assert.deepEqual(res.body.timetable.days, {});
});

test('a successful empty retry is confirmed and week zero requests week one', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    calls.push(JSON.parse(options.body));
    return { status: 200, text: async () => JSON.stringify({ ...emptyWeek(), selectedWeek: calls.length === 1 ? 0 : 1 }) };
  });
  const res = response();
  await handler({ headers: { ...sessionHeaders(session) }, query: { studentID: 7 } }, res);
  assert.equal(calls.length, 2); assert.equal(calls[1].week, 1);
  assert.equal(res.code, 200); assert.equal(res.body._debug.retried, true);
});
