import {installLoading} from '../helpers/loading.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../assets/js/chat.js', import.meta.url), 'utf8');
class Element {
  children = []; listeners = {}; style = {}; value = ''; hidden = false;
  scrollHeight = 100; scrollTop = 0; clientHeight = 100;
  classList = { add() {}, remove() {} };
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  setAttribute() {}
}
function setup(fetch, options = {}) {
  const elements = new Map();
  const document = { hidden: false, listeners: {}, createElement: () => new Element(),
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    addEventListener(type, fn) { this.listeners[type] = fn; } };
  const timers = new Map(); let timerID = 0;
  const context = { document, window: options.window || {}, platonusStudent: options.student, fetch, URLSearchParams, AbortSignal,
    authGeneration: 1, platonusSession: 'verified-session', crypto: { randomUUID: () => 'retry-id' },
    setTimeout(fn, delay) { const id = ++timerID; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, silentRelogin: async () => false, logout() {} };
  installLoading(context);
  vm.runInNewContext(source, context);
  return { context, elements, timers, api: context.window.univerChat };
}
const reply = data => ({ ok: true, json: async () => data });
const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
const profile = { id: 'me', name: 'Студент' };

test('a cold inbox shows phantom rows until the first response, including an empty inbox',async()=>{
  let finish;
  const ui=setup(()=>new Promise(resolve=>{finish=resolve;}));
  ui.api.onSection('chat');
  const placeholder=ui.elements.get('chatInbox').children[0];
  assert.match(placeholder.className,/chat-loading-inbox/);
  assert.equal(placeholder.children.length,5);
  assert.equal(ui.elements.get('chatStatus').hidden,true);
  finish(reply({profile,conversations:[]}));await settle();
  assert.equal(ui.elements.get('chatInbox').children.length,1);
  assert.match(ui.elements.get('chatInbox').children[0].textContent,/Пока нет переписок/);
});

test('a failed initial inbox removes phantom rows and offers a retry',async()=>{
  let fail;
  const ui=setup(()=>new Promise((_,reject)=>{fail=reject;}));
  ui.api.onSection('chat');
  assert.match(ui.elements.get('chatInbox').children[0].className,/chat-loading/);
  fail(new Error('offline'));await settle();
  assert.equal(ui.elements.get('chatInbox').children.length,0);
  assert.equal(ui.elements.get('chatStatus').hidden,false);
  assert.equal(ui.elements.get('chatStatus').children[1].textContent,'Повторить');
});

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

test('malformed chat snapshots offer retry without corrupting the saved inbox',async()=>{
  let broken=false;
  const ui=setup(async url=>reply(url.includes('action=session')?{profile,conversations:[conversation]}:
    broken?{conversations:[{id:'broken',peer:null}]}:{conversations:[conversation]}));
  ui.api.onSection('chat');await settle();
  const original=ui.elements.get('chatInbox').children[0];broken=true;
  await ui.api.refreshNow();
  assert.equal(ui.elements.get('chatInbox').children[0],original);
  assert.equal(ui.elements.get('chatStatus').hidden,false);
});

test('sending keeps the composer enabled and preserves a newer draft',async()=>{
  let finish;
  const ui=setup(async(url,options)=>{
    if(url.includes('action=session'))return reply({profile,conversations:[conversation]});
    if(url.includes('action=messages')&&options.method==='POST')return new Promise(resolve=>{finish=resolve;});
    return reply({messages:[],hasMore:false});
  });
  ui.api.onSection('chat');await settle();
  await ui.elements.get('chatInbox').children[0].listeners.click();
  const input=ui.elements.get('chatText');input.value='Первое сообщение';
  const sending=ui.elements.get('chatComposer').listeners.submit({preventDefault(){}});await settle();
  assert.notEqual(input.disabled,true);input.value='Следующее сообщение';
  finish(reply({message:{...message,senderID:'me',text:'Первое сообщение',clientID:'retry-id'}}));await sending;
  assert.equal(input.value,'Следующее сообщение');
});

test('pressing send keeps focus in the composer and a single line has no scrollbar',()=>{
  const ui=setup(async()=>reply({profile}));
  const input=ui.elements.get('chatText');ui.context.document.activeElement=input;
  let prevented=false;
  ui.elements.get('chatSend').listeners.pointerdown({button:0,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  input.scrollHeight=44;input.offsetHeight=44;input.clientHeight=42;
  input.listeners.input();
  assert.equal(input.style.height,'46px');assert.equal(input.style.overflowY,'hidden');
  input.scrollHeight=180;input.listeners.input();
  assert.equal(input.style.height,'120px');assert.equal(input.style.overflowY,'auto');
});

test('returning to chat resumes a search cancelled before the debounce fired',async()=>{
  let searches=0;
  const ui=setup(async url=>{
    if(url.includes('action=session'))return reply({profile,conversations:[]});
    if(url.includes('action=users')){searches++;return reply({users:[]});}
    return reply({conversations:[]});
  });
  ui.api.onSection('chat');await settle();
  const input=ui.elements.get('chatSearch');input.value='Друг';input.listeners.input();
  ui.api.onSection('profile');ui.api.onSection('chat');await settle();
  assert.equal(searches,1);assert.match(ui.elements.get('chatResults').children[0].textContent,/Пользователь не найден/);
});

test('a repeated incremental cursor stops catch-up instead of polling recursively forever',async()=>{
  let calls=0;
  const ui=setup(async url=>{
    if(url.includes('action=session'))return reply({profile,conversations:[conversation]});
    if(url.includes('action=messages')){calls++;return reply({messages:[message],hasMore:calls>1});}
    return reply({ok:true});
  });
  ui.api.onSection('chat');await settle();
  await ui.elements.get('chatInbox').children[0].listeners.click();
  await ui.api.refreshNow();
  assert.equal(calls,2);assert.equal(ui.elements.get('chatStatus').hidden,false);
});

test('uncached history shows phantom bubbles, then replaces them with a confirmed empty history',async()=>{
  let finishHistory;
  const ui=setup(async url=>{
    if(url.includes('action=session'))return reply({profile,conversations:[conversation]});
    if(url.includes('action=inbox'))return reply({conversations:[conversation]});
    return new Promise(resolve=>{finishHistory=resolve;});
  });
  ui.api.onSection('chat');await settle();
  const opening=ui.elements.get('chatInbox').children[0].listeners.click();
  const ghost=ui.elements.get('chatMessages').children[0];
  assert.match(ghost.className,/chat-loading-history/);assert.equal(ghost.children.length,6);
  await settle();finishHistory(reply({messages:[],hasMore:false}));await opening;
  assert.match(ui.elements.get('chatMessages').children[0].textContent,/Это начало вашей переписки/);
});

test('recent conversations prefetch history without marking it read',async()=>{
  const idle=[],calls=[];
  const ui=setup(async url=>{
    calls.push(url);
    if(url.includes('action=session'))return reply({profile,conversations:[{...conversation,lastMessage:message}]});
    if(url.includes('action=messages'))return reply({messages:[message],hasMore:false});
    return reply({ok:true});
  },{window:{requestIdleCallback:fn=>idle.push(fn)}});
  ui.api.onLogin();await settle();
  assert.equal(idle.length,1);idle[0]();await settle();
  assert.equal(calls.filter(url=>url.includes('action=messages')).length,1);
  assert.equal(calls.some(url=>url.includes('action=read')),false);
  ui.api.onSection('chat');await settle();
  const opening=ui.elements.get('chatInbox').children[0].listeners.click();
  assert.deepEqual(messageTexts(ui),['История']);
  await opening;await settle();
});

test('login restores account-scoped previews before auth completes and logout clears them',async()=>{
  const store=new Map([['univer-chat-preview-23',JSON.stringify({at:Date.now(),profileID:'me',inbox:[conversation],
    history:[[conversation.id,{messages:[message],hasOlder:false,at:Date.now()}]]})]]);
  const calls=[];
  const ui=setup(async(url,options)=>{
    calls.push({url,method:options.method});
    if(options.method==='DELETE')return reply({ok:true});
    return new Promise(()=>{});
  },{student:{studentID:23},window:{sessionStorage:{getItem:key=>store.get(key),removeItem:key=>store.delete(key)}}});
  ui.api.onLogin();
  assert.equal(ui.elements.get('chatInbox').children[0].children[1].children[0].children[0].textContent,'Друг');
  assert.match(calls[0].url,/action=session.*studentID=23/);assert.equal(calls[0].method,'GET');
  ui.elements.get('chatInbox').children[0].listeners.click();
  assert.deepEqual(messageTexts(ui),['История']);
  ui.api.logout();
  assert.equal(store.has('univer-chat-preview-23'),false);
});
function messageTexts(ui) {
  return ui.elements.get('chatMessages').children.filter(child => child.className?.includes('chat-message'))
    .map(child => child.children[0].textContent);
}

test('the composer stays above the measured tab bar and follows the keyboard viewport',async()=>{
  const events={},classes=new Set();
  const viewport={height:844,offsetTop:0,addEventListener:(type,fn)=>{events[type]=fn;}};
  const ui=setup(async url=>{
    if(url.includes('action=session'))return reply({profile,conversations:[conversation]});
    if(url.includes('action=inbox'))return reply({conversations:[conversation]});
    if(url.includes('action=read'))return reply({ok:true});
    return reply({messages:[message],hasMore:false});
  },{window:{innerHeight:844,innerWidth:390,visualViewport:viewport}});
  const root=ui.elements.get('sectionChat');
  root.getBoundingClientRect=()=>({top:59});
  root.style.setProperty=(key,value)=>{root.style[key]=value;};
  ui.context.document.getElementById('chatThread').getBoundingClientRect=()=>({top:75});
  ui.context.document.body={classList:{toggle:(key,value)=>value?classes.add(key):classes.delete(key)}};
  // Hidden navigation retains its rectangle; the composer follows the keyboard.
  ui.context.document.getElementById('bottomTabBar').getBoundingClientRect=()=>({top:736});
  ui.api.onSection('chat');await settle();
  await ui.elements.get('chatInbox').children[0].listeners.click();await settle();
  assert.equal(root.style['--chat-height'],'649px');
  ui.context.document.activeElement=ui.elements.get('chatText');
  ui.elements.get('chatText').listeners.focus();
  assert.equal(classes.has('chat-keyboard-open'),false); // Desktop/hardware keyboard focus.
  viewport.height=500;events.resize();
  assert.equal(root.style['--chat-viewport-height'],'488px');assert.ok(classes.has('chat-keyboard-open'));
  assert.equal(root.style['--chat-viewport-top'],'0px');
  ui.elements.get('chatThread').getBoundingClientRect=()=>({top:-180}); // Safari's focus pan.
  viewport.offsetTop=30;events.scroll();
  assert.equal(root.style['--chat-viewport-height'],'488px');
  assert.equal(root.style['--chat-viewport-top'],'30px');
  ui.elements.get('chatThread').getBoundingClientRect=()=>({top:75});
  const frames=[];
  ui.context.window.requestAnimationFrame=fn=>{frames.push(fn);return frames.length;};
  viewport.height=480;events.resize();
  viewport.height=470;events.scroll();
  assert.equal(frames.length,1);
  frames.shift()();
  assert.equal(root.style['--chat-viewport-height'],'458px'); // Read the latest, settled metrics.
  delete ui.context.window.requestAnimationFrame;
  viewport.height=500;events.resize();
  viewport.offsetTop=0;
  ui.context.document.activeElement=null;
  ui.context.window.innerHeight=500; // Android may resize the layout viewport too.
  ui.elements.get('chatText').listeners.blur();
  assert.ok(classes.has('chat-keyboard-open')); // Sending/blur must not flash the tabs.
  assert.equal(root.style['--chat-viewport-height'],'488px');
  ui.context.window.innerHeight=844;
  viewport.height=844;events.resize();
  assert.equal(root.style['--chat-height'],'649px');assert.equal(classes.has('chat-keyboard-open'),false);
  let blurred = false;
  ui.elements.get('chatText').blur = () => { blurred = true; ui.context.document.activeElement = null; };
  ui.context.document.activeElement=ui.elements.get('chatText');
  viewport.height = 500; events.resize();
  ui.api.onSection('profile');
  assert.equal(blurred, true);
  assert.equal(classes.has('chat-keyboard-open'), false);
});
test('peer avatar opens the verified profile and back returns to the conversation', async () => {
  const ui = setup(async url => {
    if (url.includes('action=session')) return reply({ profile, conversations: [conversation] });
    if (url.includes('action=inbox')) return reply({ conversations: [conversation] });
    if (url.includes('action=profile')) return reply({ profile: { name: 'Друг', studentID: 23, academicGpa: 3.5, course: 2, group: 'ИС-23', updatedAt: '2026-10-09' } });
    if (url.includes('action=read')) return reply({ ok: true });
    return reply({ messages: [message], hasMore: false });
  });
  ui.api.onSection('chat'); await settle();
  await ui.elements.get('chatInbox').children[0].listeners.click(); await settle();
  await ui.elements.get('chatPeerAvatar').listeners.click();
  assert.equal(ui.elements.get('chatPeerProfile').hidden, false);
  assert.equal(ui.elements.get('chatThread').hidden, true);
  const rendered = ui.elements.get('chatPeerProfileContent').children;
  const texts = element => [element.textContent, ...element.children.flatMap(texts)].filter(Boolean);
  assert.match(rendered.flatMap(texts).join(' '), /ID: 23.*Группа: ИС-23.*Курс: 2.*3,50/);
  ui.elements.get('chatProfileBack').listeners.click();
  assert.equal(ui.elements.get('chatPeerProfile').hidden, true);
  assert.equal(ui.elements.get('chatThread').hidden, false);
  await settle();
});
test('returning to the messages tab preserves history, fetches the latest page and scrolls to the newest message', async () => {
  let histories = 0;
  const historyURLs = [];
  const latest = { ...message, id: '99', text: 'Последнее сообщение', createdAt: '2026-10-09T10:00:00Z' };
  const ui = setup(async url => {
    if (url.includes('action=session')) return reply({ profile, conversations: [conversation] });
    if (url.includes('action=inbox')) return reply({ conversations: [conversation] });
    if (url.includes('action=read')) return reply({ ok: true });
    historyURLs.push(url);
    return reply({ messages: [++histories === 1 ? message : latest], hasMore: false });
  });
  ui.api.onSection('chat'); await settle();
  await ui.elements.get('chatInbox').children[0].listeners.click(); await settle();
  ui.api.onSection('profile');
  ui.elements.get('chatMessages').scrollTop = 0;
  ui.api.onSection('chat'); await settle();
  assert.deepEqual(messageTexts(ui), ['История', 'Последнее сообщение']);
  assert.equal(historyURLs[0].includes('after='), false);
  assert.ok(historyURLs[1].includes('after=1'));
  assert.equal(ui.elements.get('chatMessages').scrollTop, ui.elements.get('chatMessages').scrollHeight);
});

test('returning after a long absence fills every history page without gaps or duplicates', async () => {
  const histories = [], acknowledgements = [];
  let total = 50;
  const messages = Array.from({ length: 250 }, (_, i) => ({ ...message, id: String(i + 1), text: `Сообщение ${i + 1}` }));
  const ui = setup(async (url, options) => {
    if (url.includes('action=session')) return reply({ profile, conversations: [conversation] });
    if (url.includes('action=inbox')) return reply({ conversations: [conversation] });
    if (url.includes('action=read')) { acknowledgements.push(JSON.parse(options.body).throughID); return reply({ ok: true }); }
    const params = new URL(url, 'https://example.test').searchParams;
    histories.push(params);
    const after = params.get('after');
    const available = messages.slice(0, total);
    const page = after ? available.filter(item => BigInt(item.id) > BigInt(after)).slice(0, 100) : available.slice(-50);
    return reply({ messages: page, hasMore: after ? Number(page.at(-1)?.id || after) < total : total > 50 });
  });
  ui.api.onSection('chat'); await settle();
  await ui.elements.get('chatInbox').children[0].listeners.click();
  ui.api.onSection('profile'); total = 250;
  ui.api.onSection('chat'); await ui.api.refreshNow(); await settle();
  assert.deepEqual(messageTexts(ui), messages.map(item => item.text));
  assert.deepEqual(histories.slice(1, 3).map(params => params.get('after')), ['50', '150']);
  assert.ok(histories.slice(3).every(params => params.get('after') === '250'));
  assert.equal(acknowledgements.at(-1), '250');
  assert.equal(ui.elements.get('chatOlder').hidden, true, 'complete cached history stays complete after catching up');
});

test('a delayed history response preserves an already confirmed send', async () => {
  let finishHistory, reads = 0;
  const sent = { ...message, id: '2', senderID: 'me', text: 'Привет', clientID: 'retry-id' };
  const ui = setup(async (url, options) => {
    if (url.includes('action=session')) return reply({ profile, conversations: [conversation] });
    if (url.includes('action=inbox')) return reply({ conversations: [conversation] });
    if (url.includes('action=messages') && options.method === 'POST') return reply({ message: sent });
    if (url.includes('action=read') || url.includes('action=typing')) return reply({ ok: true });
    if (++reads === 1) return reply({ messages: [message], hasMore: false });
    return new Promise(resolve => { finishHistory = resolve; });
  });
  ui.api.onSection('chat'); await settle();
  await ui.elements.get('chatInbox').children[0].listeners.click();
  const refresh = ui.api.refreshNow(); await settle();
  ui.elements.get('chatText').value = 'Привет';
  await ui.elements.get('chatComposer').listeners.submit({ preventDefault() {} });
  finishHistory(reply({ messages: [message], hasMore: false })); await refresh;
  assert.deepEqual(messageTexts(ui), ['История', 'Привет']);
});

test('a concurrent send cannot move the cursor past undelivered history pages', async () => {
  let finishPage, catchingUp = false;
  const cursors = [];
  const history = Array.from({ length: 250 }, (_, i) => ({ ...message, id: String(i + 1), text: `Сообщение ${i + 1}` }));
  const sent = { ...message, id: '301', senderID: 'me', text: 'Привет', clientID: 'retry-id' };
  const ui = setup(async (url, options) => {
    if (url.includes('action=session')) return reply({ profile, conversations: [conversation] });
    if (url.includes('action=inbox')) return reply({ conversations: [conversation] });
    if (url.includes('action=read') || url.includes('action=typing')) return reply({ ok: true });
    if (options.method === 'POST') return reply({ message: sent });
    if (!catchingUp) return reply({ messages: [history[0]], hasMore: false });
    const after = new URL(url, 'https://example.test').searchParams.get('after'); cursors.push(after);
    if (after === '1') return new Promise(resolve => { finishPage = () => resolve(reply({ messages: history.slice(1, 101), hasMore: true })); });
    const page = [...history, sent].filter(item => BigInt(item.id) > BigInt(after)).slice(0, 100);
    return reply({ messages: page, hasMore: page.at(-1)?.id !== '301' });
  });
  ui.api.onSection('chat'); await settle();
  await ui.elements.get('chatInbox').children[0].listeners.click();
  catchingUp = true; const refresh = ui.api.refreshNow(); await settle();
  ui.elements.get('chatText').value = 'Привет';
  await ui.elements.get('chatComposer').listeners.submit({ preventDefault() {} });
  finishPage(); await refresh;
  assert.deepEqual(cursors, ['1', '101', '201']);
  assert.deepEqual(messageTexts(ui), [...history.map(item => item.text), 'Привет']);
});

test('unchanged inbox refresh preserves its DOM and logout resets the render cache', async () => {
  const ui = setup(async (url, options) => {
    if (options.method === 'DELETE') return reply({ ok: true });
    return reply(url.includes('action=session') ? { profile, conversations: [conversation] } : { conversations: [conversation] });
  });
  ui.api.onSection('chat'); await settle();
  const original = ui.elements.get('chatInbox').children[0];
  await ui.api.refreshNow();
  assert.equal(ui.elements.get('chatInbox').children[0], original);
  await ui.api.logout(); ui.api.onSection('chat'); await settle();
  const restored = ui.elements.get('chatInbox').children[0];
  assert.ok(restored); assert.notEqual(restored, original);
});
test('bootstrap supplies the inbox in one browser request', async () => {
  let calls = 0;
  const ui = setup(async url => { if(!url.includes('action=presence')) calls++; return reply({ profile, conversations: [conversation] }); });
  ui.api.onSection('chat');
  await settle();
  assert.equal(calls, 1);
  assert.equal(ui.elements.get('chatInbox').children.length, 1);
});

test('returning to a recently loaded inbox displays it without another network request', async () => {
  let calls = 0;
  const ui = setup(async url => { if(!url.includes('action=presence')) calls++; return reply({ profile, conversations: [conversation] }); });
  ui.api.onLogin(); await settle();
  ui.api.onSection('chat'); await settle();
  ui.api.onSection('profile');
  ui.api.onSection('chat'); await settle();
  assert.equal(calls, 1);
  assert.equal(ui.elements.get('chatInbox').children.length, 1);
  await ui.api.refreshNow();
  assert.equal(calls, 2);
});

test('peer presence displays online, expires locally and formats last visit without inventing a status',async()=>{
  let presence={online:true,lastSeen:new Date().toISOString()};
  const ui=setup(async url=>{
    if(url.includes('action=session'))return reply({profile,conversations:[conversation]});
    if(url.includes('action=inbox'))return reply({conversations:[conversation]});
    if(url.includes('action=messages'))return reply({messages:[message],hasMore:false,peerPresence:presence});
    return reply({ok:true});
  });
  ui.api.onSection('chat');await settle();await ui.elements.get('chatInbox').children[0].listeners.click();await settle();
  assert.equal(ui.elements.get('chatPeerStatus').textContent,'В сети');
  const expiry=[...ui.timers.values()].find(timer=>timer.delay>40000&&timer.delay<=45000);
  assert.ok(expiry);expiry.fn();
  assert.match(ui.elements.get('chatPeerStatus').textContent,/Был\(а\) в сети сегодня в/);
  presence=null;await ui.api.refreshNow();
  assert.equal(ui.elements.get('chatPeerStatus').textContent,'Статус неизвестен');
});

test('presence heartbeats pause while hidden, resume on return and stop at logout',async()=>{
  const activity=[];
  const ui=setup(async(url,options)=>{
    if(url.includes('action=presence'))activity.push({...JSON.parse(options.body),keepalive:options.keepalive});
    return reply(url.includes('action=session')?{profile,conversations:[]}:{ok:true,conversations:[]});
  });
  ui.api.onLogin();await settle();
  assert.equal(activity[0].active,true);
  const timer=[...ui.timers.values()].find(timer=>timer.delay===20000);assert.ok(timer);
  ui.context.document.hidden=true;ui.context.document.listeners.visibilitychange();await settle();
  assert.equal(activity.at(-1).active,false);assert.equal(activity.at(-1).keepalive,true);
  assert.equal([...ui.timers.values()].some(timer=>timer.delay===20000),false);
  ui.context.document.hidden=false;ui.context.document.listeners.visibilitychange();await settle();
  assert.equal(activity.at(-1).active,true);assert.ok(activity.at(-1).sequence>activity[0].sequence);
  await ui.api.logout();assert.equal(ui.timers.size,0);
});

test('reopening a thread displays memory history before a slow response, logout discards it', async () => {
  let finishRead;
  let reads = 0;
  const ui = setup(async (url, options) => {
    if (options.method === 'DELETE') return reply({});
    if (url.includes('action=read')) return reply({ok:true});
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
    if (url.includes('action=read')) return reply({ok:true});
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
  assert.equal(button.children[1].children[0].children[0].textContent, name);
  assert.equal(button.children[1].children[1].textContent, '<script>danger()</script>');
  assert.equal(button.children[1].children[0].children[0].children.length, 0);
});

test('typing publishes only activity, is throttled, and clears on leaving the conversation', async () => {
  const sent = [];
  const ui = setup(async (url, options) => {
    if (url.includes('action=session')) return reply({ profile, conversations: [conversation] });
    if (url.includes('action=inbox')) return reply({ conversations: [conversation] });
    if (url.includes('action=typing')) { sent.push(JSON.parse(options.body)); return reply({ ok: true }); }
    if (url.includes('action=read')) return reply({ ok: true });
    return reply({ messages: [message], hasMore: false, peerTyping: true });
  });
  ui.api.onSection('chat'); await settle();
  await ui.elements.get('chatInbox').children[0].listeners.click(); await settle();
  assert.equal(ui.elements.get('chatTyping').hidden, false);
  const input = ui.elements.get('chatText'); input.value = 'Приватный черновик';
  input.listeners.input(); input.listeners.input(); await settle();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { conversationID: conversation.id, typing: true });
  ui.api.onSection('schedule'); await settle();
  assert.equal(sent.at(-1).typing, false);
  assert.equal(ui.elements.get('chatTyping').hidden, true);
  assert.equal(ui.timers.size, 0);
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

test('a background history response is not acknowledged until the thread is visible', async () => {
  let finishRead; let readAcks=0, historyRequests=0;
  const ui=setup(async(url)=>{
    if(url.includes('action=session'))return reply({profile,conversations:[conversation]});
    if(url.includes('action=read')){readAcks++;return reply({ok:true});}
    if(url.includes('action=inbox'))return reply({conversations:[conversation]});
    if(++historyRequests===1)return new Promise(resolve=>{finishRead=resolve;});
    return reply({messages:url.includes('after=') ? [] : [message],hasMore:false});
  });
  ui.api.onSection('chat');await settle();
  ui.elements.get('chatInbox').children[0].listeners.click();await settle();
  ui.api.onSection('profile');
  finishRead(reply({messages:[message],hasMore:false}));await settle();
  assert.equal(readAcks,0);
  ui.api.onSection('chat');await settle();
  assert.equal(readAcks,1);
});

test('unread badge updates on the home screen and late counts cannot survive logout', async () => {
  let finishInbox;
  const ui=setup(async(url,options)=>{
    if(options.method==='DELETE')return reply({});
    if(url.includes('action=session'))return reply({profile,conversations:[{...conversation,unread:3},{...conversation,id:'second',unread:2}]});
    return new Promise(resolve=>{finishInbox=resolve;});
  });
  ui.api.onLogin();await settle();
  assert.equal(ui.elements.get('messageBadge').textContent,'5');
  assert.equal(ui.elements.get('messageBadge').hidden,false);
  const timer=[...ui.timers.values()].find(timer=>timer.delay===8000);
  timer.fn();await settle();
  await ui.api.logout();
  finishInbox(reply({conversations:[{...conversation,unread:99}]}));await settle();
  assert.equal(ui.elements.get('messageBadge').hidden,true);
  assert.equal(ui.timers.size,0);
});
test('badge polling pauses while hidden and hides the badge when the unread count becomes zero',async()=>{
  let calls=0;
  const ui=setup(async(url)=>{
    if(!url.includes('action=presence'))calls++;
    return reply(url.includes('action=session')?{profile,conversations:[{...conversation,unread:105}]}:{conversations:[]});
  });
  ui.api.onLogin();await settle();
  assert.equal(ui.elements.get('messageBadge').textContent,'99+');
  ui.context.document.hidden=true;ui.context.document.listeners.visibilitychange();
  assert.equal(ui.timers.size,0);assert.equal(calls,1);
  ui.context.document.hidden=false;ui.context.document.listeners.visibilitychange();await settle();
  assert.equal(calls,2);assert.equal(ui.elements.get('messageBadge').hidden,true);
});
