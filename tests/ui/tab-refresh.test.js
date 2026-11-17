import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
function setup(section, reduced = false) {
  const classes = new Set();
  const attrs = new Map();
  const calls = [];
  let finish,fail;
  const work = new Promise((resolve,reject) => { finish = resolve;fail=reject; });
  const context = vm.createContext({ currentSection: section, authGeneration: 1,
    document: { getElementById: () => ({ classList: { add: c => classes.add(c), remove: c => classes.delete(c) }, setAttribute: (k,v) => attrs.set(k,v), removeAttribute: k => attrs.delete(k) }) },
    window: { matchMedia: () => ({ matches: reduced }), scrollTo() {}, univerChat: { refreshNow: () => { calls.push('chat'); return work; } } },
    haptic() {}, scrollAppTo() {},
    liveScheduleWeekInfo: { selectedStudyYear: 2026, selectedTerm: 1 },
    browsedWeekInfo: { studyYear: 2026, term: 1, week: 9 }, platonusStudent: { studentID: 7 },
    fetchJournal: (...args) => { calls.push(['grades', ...args]); return work; },
    refreshWeekInBackground: (...args) => { calls.push(['schedule', ...args]); return work; },
    loadLiveStudentData: () => { calls.push('profile'); return work; },
    renderCurrentSection: () => calls.push('render'), switchSection: value => calls.push(['switch', value]) });
  vm.runInContext(source.slice(source.indexOf('  const refreshingTabs'), source.indexOf('  function switchSection')), context);
  return { context, classes, attrs, calls, finish, fail };
}
test('repeated taps share one refresh and restore the tab icon afterwards', async () => {
  const ui = setup('schedule');
  const running = ui.context.tapTab('schedule');
  await ui.context.tapTab('schedule');
  assert.deepEqual(ui.calls, [['schedule', 2026, 1, 9]]);
  assert.equal(ui.attrs.get('aria-busy'), 'true');
  assert.equal(ui.classes.has('tab-refreshing'), true);
  assert.equal(ui.attrs.get('aria-busy'), 'true');
  ui.finish(); await running;
  assert.equal(ui.classes.has('tab-refreshing'), false);
  assert.equal(ui.attrs.has('aria-busy'), false);
});
test('all four active tabs invoke their data loader', async () => {
  for (const section of ['schedule', 'grades', 'chat', 'profile']) {
    const ui = setup(section); const running = ui.context.tapTab(section);
    assert.equal(Array.isArray(ui.calls[0]) ? ui.calls[0][0] : ui.calls[0], section);
    ui.finish(); await running;
  }
});
test('tapping another tab navigates without refreshing the old screen', async () => {
  const ui = setup('schedule'); const running = ui.context.tapTab('profile');
  assert.deepEqual(ui.calls, [['switch', 'profile']]);
  await running;
  assert.equal(ui.classes.size, 0);
});

test('the messages tab resets nested chat navigation before switching or refreshing',async()=>{
  for (const section of ['schedule','chat']) {
    const ui=setup(section);let returned=0;
    ui.context.window.univerChat.showInbox=()=>returned++;
    const running=ui.context.tapTab('chat');
    assert.equal(returned,1);ui.finish();await running;
  }
});

test('a failed refresh releases the icon and permits retry',async()=>{
  const ui=setup('schedule');const running=ui.context.tapTab('schedule');
  ui.fail(new Error('offline'));await running;
  assert.equal(ui.classes.has('tab-refreshing'),false);assert.equal(ui.attrs.has('aria-busy'),false);
  await ui.context.tapTab('schedule');assert.equal(ui.calls.length,2);
});

test('reduced motion retains busy semantics without rotating the icon',async()=>{
  const ui=setup('profile',true);const running=ui.context.tapTab('profile');
  assert.equal(ui.classes.has('tab-refreshing'),false);assert.equal(ui.attrs.get('aria-busy'),'true');
  ui.finish();await running;assert.equal(ui.attrs.has('aria-busy'),false);
});
