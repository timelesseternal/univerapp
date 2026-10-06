import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/chat.js', import.meta.url), 'utf8');
class Element {
  children = []; listeners = {}; style = {}; value = ''; hidden = false;
  scrollHeight = 100; scrollTop = 0; clientHeight = 100;
  classList = { add() {}, remove() {} };
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  setAttribute() {}
}
function setup(fetch) {
  const elements = new Map();
  const document = { hidden: false, createElement: () => new Element(),
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    addEventListener() {} };
  const timers = new Map(); let timerID = 0;
  const context = { document, window: {}, fetch, URLSearchParams, AbortSignal,
    authGeneration: 1, platonusSession: 'verified-session', crypto: { randomUUID: () => 'retry-id' },
    setTimeout(fn, delay) { const id = ++timerID; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, silentRelogin: async () => false, logout() {} };
  vm.runInNewContext(source, context);
  return { context, elements, timers, api: context.window.univerChat };
}
const reply = data => ({ ok: true, json: async () => data });
const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
const profile = { id: 'me', name: 'Студент' };

test('chat does not request or poll until opened, and stops polling on leaving', async () => {
  const calls = [];
  const ui = setup(async url => {
    calls.push(url);
    return reply(url.includes('action=session') ? { profile } : { conversations: [] });
  });
  ui.api.onSection('schedule');
  await settle();
  assert.equal(calls.length, 0);
  ui.api.onSection('chat');
  await settle();
  assert.equal(calls.length, 2);
  assert.equal([...ui.timers.values()][0].delay, 8000);
  ui.api.onSection('profile');
  assert.equal(ui.timers.size, 0);
});

test('inbox renders untrusted names and message previews as text', async () => {
  const name = '<img src=x onerror=alert(1)>';
  const ui = setup(async url => reply(url.includes('action=session') ? { profile } : {
    conversations: [{ id: 'conversation', peer: { id: 'peer', name }, unread: 1,
      lastMessage: { senderID: 'peer', text: '<script>danger()</script>' } }],
  }));
  ui.api.onSection('chat');
  await settle();
  const button = ui.elements.get('chatInbox').children[0];
  assert.equal(button.children[1].children[0].textContent, name);
  assert.equal(button.children[1].children[1].textContent, '<script>danger()</script>');
  assert.equal(button.children[1].children[0].children.length, 0);
});

test('logout clears private UI and revokes a late bootstrap cookie before reuse', async () => {
  let finishBootstrap;
  const calls = [];
  const ui = setup(async (url, options) => {
    calls.push(options.method);
    if (options.method === 'POST') return new Promise(resolve => { finishBootstrap = resolve; });
    return reply({});
  });
  ui.api.onSection('chat');
  await settle();
  ui.elements.get('chatText').value = 'private draft';
  ui.context.document.getElementById('chatMessages').append(new Element());
  ui.context.authGeneration++;
  const logout = ui.api.logout();
  assert.equal(ui.elements.get('chatText').value, '');
  assert.equal(ui.elements.get('chatMessages').children.length, 0);
  assert.deepEqual(calls, ['POST']);
  finishBootstrap(reply({ profile }));
  await logout;
  await settle();
  assert.deepEqual(calls, ['POST', 'DELETE']);
  assert.equal(ui.elements.get('chatInbox').children.length, 0);
  assert.equal(ui.timers.size, 0);
});
