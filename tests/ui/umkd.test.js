import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
function setup(record) {
  const container = { innerHTML: '' }, back = { style: {} };
  const context = vm.createContext({
    liveUmkdData: { records: [record] }, selectedUmkdSubject: null, haptic() {},
    document: { getElementById: () => container, querySelector: () => back },
    swapContent: (target, html) => { target.innerHTML = html; },
  });
  vm.runInContext(app.slice(app.indexOf('  function escapeHtml('), app.indexOf('  function studentGroup(')), context);
  vm.runInContext(app.slice(app.indexOf('  function renderUmkdSubjects('), app.indexOf('  let pdfJsLoadPromise')), context);
  return { context, container };
}

test('UMKD subject and tutor names are escaped in both screens', () => {
  const ui = setup({ subjectName: '<img src=x onerror="danger()"> & математика', tutorName: "<script>danger('tutor')</script>", umkdID: 7 });
  ui.context.renderUmkdSubjects();
  assert.match(ui.container.innerHTML, /&lt;img src=x onerror=&quot;danger\(\)&quot;&gt; &amp; математика/);
  assert.doesNotMatch(ui.container.innerHTML, /<img|<script/);
  ui.context.selectUmkdSubject(0);
  assert.match(ui.container.innerHTML, /&lt;script&gt;danger\(&#39;tutor&#39;\)&lt;\/script&gt;/);
  assert.doesNotMatch(ui.container.innerHTML, /<img|<script/);
});

test('UMKD actions accept safe positive document IDs and reject injected or invalid IDs', () => {
  for (const umkdID of ['7);danger();//', -1, 1.5, 0, null, Number.MAX_SAFE_INTEGER + 1]) {
    const ui = setup({ subjectName: 'Математика', umkdID }); ui.context.selectUmkdSubject(0);
    assert.doesNotMatch(ui.container.innerHTML, /data-action="openUmkdFile/);
  }
  for (const umkdID of [7, '7']) {
    const ui = setup({ subjectName: 'Математика', umkdID }); ui.context.selectUmkdSubject(0);
    const actions = [...ui.container.innerHTML.matchAll(/data-action="openUmkdFile\((\d+), (\d+)\)"/g)];
    assert.deepEqual(actions.map(match => [Number(match[1]), Number(match[2])]), [[131, 7], [133, 7], [134, 7], [138, 7]]);
  }
});
