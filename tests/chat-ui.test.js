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
  assert.ok([...ui.timers.values()][0].delay <= 8000);
  assert.ok([...ui.timers.values()][0].delay >= 250);
  ui.api.onSection('profile');
  assert.equal(ui.timers.size, 0);
});

const conversation = { id: 'conversation', peer: { id: 'peer', name: 'Друг' }, unread: 0 };
const message = { id: '1', senderID: 'peer', text: 'История', createdAt: '2026-10-06T10:00:00Z', clientID: 'incoming' };
function messageTexts(ui) {
  return ui.elements.get('chatMessages').children.filter(child => child.className?.includes('chat-message'))
    .map(child => child.children[0].textContent);
}
test('bootstrap supplies the inbox in one browser request', async () => {
  let calls = 0;
  const ui = setup(async () => { calls++; return reply({ profile, conversations: [conversation] }); });
  ui.api.onSection('chat');
  await settle();
  assert.equal(calls, 1);
  assert.equal(ui.elements.get('chatInbox').children.length, 1);
});

test('reopening a thread displays memory history before a slow response, logout discards it', async () => {
  let finishRead;
  let reads = 0;
  const ui = setup(async (url, options) => {
    if (options.method === 'DELETE') return reply({});
    if (url.includes('action=session')) return reply({ profile, conversations: [conversation] });
    if (url.includes('action=inbox')) return reply({ conversations: [conversation] });
    if (++reads === 1) return reply({ messages: [message], hasMore: false });
    return new Promise(resolve => { finishRead = resolve; });
  });
  ui.api.onSection('chat'); await settle();
  await ui.elements.get('chatInbox').children[0].listeners.click(); await settle();
  assert.deepEqual(messageTexts(ui), ['История']);
  ui.elements.get('chatBack').listeners.click(); await settle();
  ui.elements.get('chatInbox').children[0].listeners.click();
  assert.deepEqual(messageTexts(ui), ['История']);
  await settle();
  await ui.api.logout();
  finishRead(reply({ messages: [message], hasMore: false })); await settle();
  assert.equal(ui.elements.get('chatMessages').children.length, 0);
});

test('slow message polling does not block an inbox refresh', async () => {
  let finishRead, reads = 0, inboxRequests = 0;
  const ui = setup(async (url) => {
    if (url.includes('action=session')) return reply({ profile, conversations: [conversation] });
    if (url.includes('action=inbox')) { inboxRequests++; return reply({ conversations: [conversation] }); }
    if (++reads === 1) return reply({ messages: [message], hasMore: false });
    return new Promise(resolve => { finishRead = resolve; });
  });
  ui.api.onSection('chat'); await settle();
  await ui.elements.get('chatInbox').children[0].listeners.click(); await settle();
  // Advance only the inbox freshness clock; no real waits or network are needed.
  vm.runInNewContext('Date.now = () => 2000000000000', ui.context);
  ui.api.onSection('chat'); await settle();
  assert.equal(inboxRequests, 1);
  finishRead(reply({ messages: [], hasMore: false })); await settle();
});

test('sending displays immediately and retries a failed request without duplicating the bubble', async () => {
  let finishSend; const clients = [];
  const ui = setup(async (url, options) => {
    if (url.includes('action=session')) return reply({ profile, conversations: [conversation] });
    if (options.method === 'POST') {
      clients.push(JSON.parse(options.body).clientID);
      return new Promise(resolve => { finishSend = resolve; });
    }
    return reply({ messages: [], hasMore: false });
  });
  ui.api.onSection('chat'); await settle();
  await ui.elements.get('chatInbox').children[0].listeners.click(); await settle();
  ui.elements.get('chatText').value = 'Привет';
  const sending = ui.elements.get('chatComposer').listeners.submit({ preventDefault() {} });
  assert.deepEqual(messageTexts(ui), ['Привет']);
  await settle();
  finishSend({ ok: false, json: async () => ({ error: 'chat_unavailable' }) });
  await sending;
  assert.equal(ui.elements.get('chatText').value, 'Привет');
  assert.match(ui.elements.get('chatMessages').children.at(-1).children[1].textContent, /Не отправлено/);
  const retry = ui.elements.get('chatComposer').listeners.submit({ preventDefault() {} }); await settle();
  assert.deepEqual(clients, ['retry-id', 'retry-id']);
  assert.deepEqual(messageTexts(ui), ['Привет']);
  finishSend(reply({ message: { ...message, senderID: 'me', text: 'Привет', clientID: 'retry-id' } }));
  await retry;
  assert.deepEqual(messageTexts(ui), ['Привет']);
  assert.equal(ui.elements.get('chatText').value, '');
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
