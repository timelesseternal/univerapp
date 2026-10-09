/* Personal chats use the verified, same-origin API. No database secrets live here. */
(() => {
  'use strict';
  const root = document.getElementById('sectionChat');
  if (!root) return;
  const byID = id => document.getElementById(id);
  const state = { profile: null, conversation: null, messages: new Map(), drafts: new Map(),
    epoch: 0, visible: false, sessionWork: null, timer: null, searchTimer: null,
    searchVersion: 0, refreshing: false, sending: false, hasOlder: false,
    history: new Map(), pending: new Map(), inboxAt: 0, readThrough: new Map(),
    monitoring: false, badgeTimer: null, badgeBusy: false, peerProfileOpen: false, peerProfileVersion: 0 };
  const telegramApp = window.Telegram?.WebApp;
  let typingAt = 0, typingConversation = null, typingTimer = null, peerTypingTimer = null;
  function fitConversation() {
    const viewport = window.visualViewport;
    if (!viewport || !root.getBoundingClientRect) return;
    const keyboard = state.visible && !!state.conversation && !state.peerProfileOpen
      && window.innerHeight - viewport.height > 120;
    document.body?.classList.toggle('chat-keyboard-open', keyboard);
    if (state.visible && state.conversation) {
      const list = byID('chatMessages');
      const bottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
      const height = Math.max(220, viewport.height + viewport.offsetTop - root.getBoundingClientRect().top - (keyboard ? 12 : 100));
      root.style.setProperty('--chat-height', `${height}px`);
      if (bottom) list.scrollTop = list.scrollHeight;
    }
  }
  function showTyping(active) {
    clearTimeout(peerTypingTimer);
    byID('chatTyping').hidden = !active;
    if (active) peerTypingTimer = setTimeout(() => { byID('chatTyping').hidden = true; }, 6000);
  }
  function stopTyping() {
    clearTimeout(typingTimer);
    const id = typingConversation;
    typingConversation = null;
    typingAt = 0;
    if (id && state.profile) request('typing', { method: 'POST', body: { conversationID: id, typing: false } }).catch(() => {});
  }
  function publishTyping() {
    if (!state.visible || document.hidden || !state.conversation || !state.profile || !byID('chatText').value.trim()) { stopTyping(); return; }
    clearTimeout(typingTimer);
    const id = state.conversation.id;
    if (typingConversation !== id || Date.now() - typingAt >= 3000) {
      typingConversation = id;
      typingAt = Date.now();
      request('typing', { method: 'POST', body: { conversationID: id, typing: true } }).catch(() => {});
    }
    typingTimer = setTimeout(stopTyping, 4000);
  }
  const bootstrap = () => request('session', { method:'POST',headers:{'x-session':platonusSession},
    ...(telegramApp?.initData ? { body:{initData:telegramApp.initData} } : {}) });
  const labels = {
    chat_not_configured: 'Чат пока не подключён. Администратор приложения скоро включит переписки.',
    chat_setup_required: 'Чат пока не подключён. Администратор приложения скоро включит переписки.',
    chat_session_expired: 'Восстанавливаем подключение к чату…',
    session_expired: 'Не удалось подтвердить вход. Войдите в приложение заново.',
    chat_forbidden: 'Эта переписка вам недоступна.',
    chat_rate_limit: 'Слишком много сообщений. Подождите минуту и попробуйте снова.',
    chat_message_length: 'Сообщение должно содержать от 1 до 2000 символов.',
    chat_search_length: 'Для поиска введите от 2 до 60 символов.',
    platonus_unreachable: 'Platonus сейчас недоступен. Попробуйте подключиться позже.',
  };
  function stale(epoch) { return epoch !== state.epoch; }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function initials(name) { return name.trim().split(/\s+/u).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
  function status(text = '', retry = false) {
    const container = byID('chatStatus');
    container.replaceChildren();
    container.hidden = !text;
    if (!text) return;
    container.append(node('span', '', text));
    if (retry) {
      const button = node('button', 'chat-retry', 'Повторить');
      button.type = 'button';
      button.addEventListener('click', () => { state.profile = null; refresh(); });
      container.append(button);
    }
  }
  function showError(error) {
    if (error.message === 'session_changed') return;
    status(labels[error.message] || 'Не удалось подключиться. Проверьте интернет и повторите попытку.', true);
  }
  async function request(action, { method = 'GET', params = {}, body, headers = {} } = {}) {
    const query = new URLSearchParams({ action, ...params });
    let response;
    try {
      response = await fetch(`/api/chat?${query}`, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(action === 'session' && method === 'POST' ? 22000 : 12000),
      });
    } catch { throw new Error('chat_unavailable'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.error === 'chat_session_expired') state.profile = null;
      throw new Error(data.error || 'chat_unavailable');
    }
    return data;
  }
  async function ensureSession() {
    if (state.profile) return state.profile;
    if (state.sessionWork) return state.sessionWork;
    const epoch = state.epoch;
    const generation = authGeneration;
    const work = (async () => {
      if (!platonusSession) throw new Error('session_expired');
      let data;
      try {
        data = await bootstrap();
      } catch (error) {
        if (stale(epoch) || generation !== authGeneration) throw new Error('session_changed');
        if (error.message !== 'session_expired') throw error;
        if (!await silentRelogin()) { logout(); throw error; }
        if (stale(epoch) || generation !== authGeneration) throw new Error('session_changed');
        data = await bootstrap();
      }
      if (stale(epoch) || generation !== authGeneration) throw new Error('session_changed');
      state.profile = data.profile;
      if (Array.isArray(data.conversations)) {
        drawInbox(data.conversations);
        state.inboxAt = Date.now();
      }
      return data.profile;
    })();
    state.sessionWork = work;
    try { return await work; }
    finally { if (state.sessionWork === work) state.sessionWork = null; }
  }
  function drawInbox(conversations) {
    updateBadge(conversations.reduce((total, conversation) => total + Math.max(0, Number(conversation.unread) || 0), 0));
    const list = byID('chatInbox');
    list.replaceChildren();
    if (!conversations.length) {
      list.append(node('p', 'chat-empty', 'Пока нет переписок. Найдите знакомого по имени и напишите первым.'));
      return;
    }
    for (const conversation of conversations) {
      const button = node('button', 'chat-person');
      button.type = 'button';
      button.append(node('span', 'chat-avatar', initials(conversation.peer.name)));
      const content = node('span', 'chat-person-content');
      const heading = node('span', 'chat-person-heading');
      heading.append(node('span', 'chat-person-name', conversation.peer.name));
      if (conversation.unread > 0) heading.append(node('span', 'chat-unread', conversation.unread > 99 ? '99+' : String(conversation.unread)));
      content.append(heading);
      const prefix = conversation.lastMessage?.senderID === state.profile.id ? 'Вы: ' : '';
      content.append(node('span', 'chat-person-preview', conversation.lastMessage ? prefix + conversation.lastMessage.text : 'Начните переписку'));
      button.append(content);
      if (conversation.lastMessage?.createdAt) {
        const date = new Date(conversation.lastMessage.createdAt);
        const stamp = node('time', 'chat-person-time', date.toLocaleDateString() === new Date().toLocaleDateString()
          ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }));
        stamp.dateTime = conversation.lastMessage.createdAt;
        button.append(stamp);
      }
      button.addEventListener('click', () => openConversation(conversation));
      list.append(button);
    }
  }
  function updateBadge(count) {
    const badge = byID('messageBadge');
    if (!badge) return;
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? '99+' : String(count);
    byID('section-chat')?.setAttribute('aria-label', count ? `Сообщения, непрочитанных: ${count}` : 'Сообщения');
  }
  function scheduleBadge() {
    clearTimeout(state.badgeTimer);
    if (state.monitoring && !document.hidden && platonusSession) state.badgeTimer = setTimeout(refreshBadge, 8000);
  }
  async function refreshBadge(force = false) {
    if (!state.monitoring || document.hidden || !platonusSession || state.badgeBusy) return;
    if (state.visible && !force) { scheduleBadge(); return; }
    const epoch = state.epoch;
    state.badgeBusy = true;
    try {
      await ensureSession();
      if (stale(epoch)) return;
      const data = await request('inbox');
      if (!stale(epoch)) { drawInbox(data.conversations || []); state.inboxAt = Date.now(); }
    } catch (error) {
      if (!stale(epoch) && ['chat_not_configured','chat_setup_required'].includes(error.message)) state.monitoring = false;
      /* Badge polling must not interrupt other screens or erase a known count. */
    }
    finally { if (!stale(epoch)) { state.badgeBusy = false; scheduleBadge(); } }
  }
  function orderedMessages() { return [...state.messages.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0); }
  function rememberHistory() {
    if (!state.conversation) return;
    const messages = orderedMessages();
    const id = state.conversation.id;
    state.history.delete(id);
    state.history.set(id, { messages: messages.slice(-200), hasOlder: state.hasOlder || messages.length > 200 });
    if (state.history.size > 10) state.history.delete(state.history.keys().next().value);
  }
  function animateMessage(element) {
    if (!state.visible || document.hidden || !element.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    element.animate([{opacity:0,transform:'translateY(10px) scale(.96)'},{opacity:1,transform:'translateY(0) scale(1)'}],
      {duration:320,easing:'cubic-bezier(.16,1,.3,1)'});
  }
  function drawMessages({ scroll = 'keep', newIDs = new Set(), pendingID } = {}) {
    const list = byID('chatMessages');
    const previousHeight = list.scrollHeight;
    const previousTop = list.scrollTop;
    const nearBottom = previousHeight - previousTop - list.clientHeight < 90;
    list.replaceChildren();
    let lastDay = '';
    for (const message of orderedMessages()) {
      const date = new Date(message.createdAt);
      const day = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
      if (day !== lastDay) { list.append(node('div', 'chat-date', day)); lastDay = day; }
      const article = node('article', message.senderID === state.profile.id ? 'chat-message chat-message-own' : 'chat-message');
      article.append(node('p', 'chat-message-text', message.text));
      const time = node('time', 'chat-message-time', date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
      time.dateTime = message.createdAt;
      article.append(time);
      list.append(article);
      if (newIDs.has(message.id)) animateMessage(article);
    }
    const pending = [...state.pending.values()].filter(message => message.conversationID === state.conversation?.id);
    for (const message of pending) {
      const article = node('article', 'chat-message chat-message-own');
      article.append(node('p', 'chat-message-text', message.text));
      article.append(node('span', 'chat-message-time', message.failed ? 'Не отправлено · попробуйте ещё раз' : 'Отправляем…'));
      list.append(article);
      if (pendingID === message.clientID) animateMessage(article);
    }
    if (!state.messages.size && !pending.length) list.append(node('p', 'chat-empty', 'Это начало вашей переписки. Поздоровайтесь!'));
    byID('chatOlder').hidden = !state.hasOlder;
    if (scroll === 'bottom' || (scroll === 'keep' && nearBottom)) list.scrollTop = list.scrollHeight;
    else if (scroll === 'older') list.scrollTop = previousTop + list.scrollHeight - previousHeight;
    else list.scrollTop = previousTop;
    if (scroll === 'bottom') {
      const id = state.conversation?.id;
      const epoch = state.epoch;
      const afterLayout = window.requestAnimationFrame || (fn => fn());
      afterLayout(() => {
        if (!stale(epoch) && state.visible && state.conversation?.id === id) list.scrollTop = list.scrollHeight;
      });
    }
  }
  async function refreshMessages({ older = false, initial = false } = {}) {
    if (!state.conversation) return;
    const epoch = state.epoch, id = state.conversation.id;
    const messages = orderedMessages();
    const params = { conversationID: id };
    if (older && messages.length) params.before = messages[0].id;
    else if (!initial && messages.length) params.after = messages.at(-1).id;
    const data = await request('messages', { params });
    if (stale(epoch) || state.conversation?.id !== id) return;
    showTyping(data.peerTyping === true && state.visible && !state.peerProfileOpen);
    if (!params.after) state.hasOlder = data.hasMore;
    const newIDs = new Set(data.messages.filter(message => !state.messages.has(message.id)).map(message => message.id));
    let changed = newIDs.size > 0;
    if (initial) state.messages.clear();
    for (const message of data.messages) {
      state.messages.set(message.id, message);
      if (message.senderID === state.profile.id && state.pending.delete(message.clientID)) changed = true;
    }
    rememberHistory();
    if (changed || initial || older) drawMessages({ scroll: initial ? 'bottom' : older ? 'older' : 'keep',
      newIDs: initial || older ? new Set() : newIDs });
    if (params.after && data.hasMore) await refreshMessages();
    if (state.visible && !state.peerProfileOpen && !document.hidden && state.conversation?.id===id) {
      const through = orderedMessages().at(-1)?.id;
      if (through && state.readThrough.get(id)!==through) {
        // Acknowledge after visible rendering, without delaying the message refresh.
        request('read', { method:'POST',body:{conversationID:id,throughID:through} }).then(() => {
          if (!stale(epoch)) { state.readThrough.set(id,through); refreshBadge(true); }
        }).catch(() => {});
      }
    }
  }
  function scheduleRefresh(elapsed = 0) {
    clearTimeout(state.timer);
    if (!state.visible || document.hidden || !platonusSession) return;
    state.timer = setTimeout(refresh, Math.max(250, (state.conversation ? 2500 : 8000) - elapsed));
  }
  let chatRefreshTask = null;
  function refresh(latest = false) {
    if (chatRefreshTask) return chatRefreshTask;
    chatRefreshTask = refreshOnce(latest).finally(() => { chatRefreshTask = null; });
    return chatRefreshTask;
  }
  async function refreshOnce(latest = false) {
    if (!state.visible || document.hidden || state.refreshing || !platonusSession) return;
    const epoch = state.epoch;
    const started = Date.now();
    state.refreshing = true;
    let retry = true;
    try {
      await ensureSession();
      if (stale(epoch)) return;
      const work = [refreshMessages({ initial: latest })];
      if (!state.inboxAt || Date.now() - state.inboxAt >= 8000) {
        work.push(request('inbox').then(data => {
          if (stale(epoch)) return;
          drawInbox(data.conversations || []);
          state.inboxAt = Date.now();
        }));
      }
      const results = await Promise.allSettled(work);
      if (stale(epoch)) return;
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      status();
    } catch (error) {
      if (!stale(epoch)) showError(error);
      retry = !['chat_not_configured', 'chat_setup_required', 'session_expired'].includes(error.message);
    } finally {
      if (!stale(epoch)) { state.refreshing = false; if (retry) scheduleRefresh(Date.now() - started); }
    }
  }
  async function search() {
    const query = byID('chatSearch').value.trim();
    const version = ++state.searchVersion, epoch = state.epoch;
    const results = byID('chatResults');
    results.replaceChildren();
    results.hidden = !query;
    byID('chatInbox').hidden = Boolean(query);
    if (query.length < 2) {
      if (query) results.append(node('p', 'chat-empty', 'Введите хотя бы две буквы имени.'));
      return;
    }
    results.append(node('p', 'chat-empty', 'Ищем…'));
    try {
      await ensureSession();
      if (stale(epoch) || version !== state.searchVersion) return;
      const data = await request('users', { params: { q: query } });
      if (stale(epoch) || version !== state.searchVersion) return;
      results.replaceChildren();
      if (!data.users.length) results.append(node('p', 'chat-empty', 'Пользователь не найден. Он появится здесь после первого открытия чата в приложении.'));
      for (const user of data.users) {
        const button = node('button', 'chat-person');
        button.type = 'button';
        button.append(node('span', 'chat-avatar', initials(user.name)), node('span', 'chat-person-name', user.name));
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const reply = await request('conversations', { method: 'POST', body: { peerID: user.id } });
            if (!stale(epoch)) openConversation(reply.conversation);
          } catch (error) { if (!stale(epoch)) showError(error); }
          finally { button.disabled = false; }
        });
        results.append(button);
      }
    } catch (error) { if (!stale(epoch) && version === state.searchVersion) { results.replaceChildren(); showError(error); } }
  }
  function saveDraft() {
    if (state.conversation) {
      const old = state.drafts.get(state.conversation.id);
      const text = byID('chatText').value;
      state.drafts.set(state.conversation.id, { text, clientID: old?.text === text ? old.clientID : null });
    }
  }
  async function openConversation(conversation) {
    stopTyping(); showTyping(false);
    closePeerProfile();
    saveDraft();
    rememberHistory();
    state.conversation = conversation;
    const cached = state.history.get(conversation.id);
    state.messages = new Map((cached?.messages || []).map(message => [message.id, message]));
    state.hasOlder = cached?.hasOlder || false;
    root.classList.add('chat-in-thread');
    byID('chatInboxView').hidden = true;
    byID('chatThread').hidden = false;
    byID('chatPeerName').textContent = conversation.peer.name;
    byID('chatPeerAvatar').textContent = initials(conversation.peer.name);
    byID('chatText').value = state.drafts.get(conversation.id)?.text || '';
    resizeComposer();
    fitConversation();
    if (cached) drawMessages({ scroll: 'bottom' });
    else byID('chatMessages').replaceChildren(node('p', 'chat-empty', 'Загружаем переписку…'));
    const epoch = state.epoch;
    try {
      await ensureSession();
      if (stale(epoch) || state.conversation?.id !== conversation.id) return;
      await refreshMessages({ initial: true });
      if (!stale(epoch)) { status(); scheduleRefresh(); }
    } catch (error) { if (!stale(epoch)) showError(error); }
  }
  function closeConversation() {
    stopTyping(); showTyping(false);
    closePeerProfile();
    saveDraft();
    rememberHistory();
    state.conversation = null;
    fitConversation();
    state.messages.clear();
    root.classList.remove('chat-in-thread');
    byID('chatThread').hidden = true;
    byID('chatInboxView').hidden = false;
    status();
    state.inboxAt = 0;
    refresh();
  }
  function resizeComposer() {
    const input = byID('chatText');
    input.style.height = 'auto';
    input.style.height = Math.min(120, input.scrollHeight) + 'px';
    byID('chatSend').disabled = state.sending || !input.value.trim();
  }
  function closePeerProfile() {
    state.peerProfileOpen = false;
    state.peerProfileVersion++;
    byID('chatPeerProfile').hidden = true;
    byID('chatPeerProfileContent').replaceChildren();
    if (state.conversation) byID('chatThread').hidden = false;
    fitConversation();
  }
  async function openPeerProfile() {
    stopTyping(); showTyping(false);
    if (!state.conversation) return;
    const id = state.conversation.id, epoch = state.epoch;
    const version = ++state.peerProfileVersion;
    state.peerProfileOpen = true;
    fitConversation();
    byID('chatThread').hidden = true;
    byID('chatPeerProfile').hidden = false;
    const content = byID('chatPeerProfileContent');
    content.replaceChildren(node('p', 'chat-empty', 'Загружаем профиль…'));
    try {
      await ensureSession();
      const data = await request('profile', { params: { conversationID: id } });
      if (stale(epoch) || version !== state.peerProfileVersion || state.conversation?.id !== id) return;
      const person = data.profile;
      if (!person) throw new Error('chat_unavailable');
      const hero = node('div', 'chat-peer-profile-hero');
      hero.append(node('div', 'profile-avatar', initials(person.name)), node('h2', 'profile-name', person.name));
      const info = node('div', 'profile-study-info');
      info.append(node('span', '', 'Группа: ' + (person.group || '—')), node('span', '', 'Курс: ' + (person.course || '—')));
      hero.append(node('div', 'profile-id', 'ID: ' + person.studentID), info);
      const gpa = node('div', 'gpa-card');
      const row = node('div', 'gpa-row');
      const value = person.academicGpa;
      row.append(node('span', 'gpa-label', 'Академический GPA'), node('span', 'gpa-value accent', Number.isFinite(value) ? value.toFixed(2).replace('.', ',') : '—'));
      gpa.append(row);
      content.replaceChildren(hero, gpa);
      if (!person.updatedAt) content.append(node('p', 'chat-empty', 'Учебные данные появятся, когда пользователь снова откроет приложение.'));
    } catch (error) {
      if (!stale(epoch) && version === state.peerProfileVersion) content.replaceChildren(node('p', 'chat-empty', error.message === 'chat_setup_required' ? 'Профили ещё не подключены: требуется обновление базы данных.' : 'Не удалось загрузить профиль. Закройте его и попробуйте снова.'));
    }
  }
  async function send(event) {
    event.preventDefault();
    if (!state.conversation || state.sending) return;
    const text = byID('chatText').value.trim();
    if (!text || text.length > 2000) return;
    stopTyping();
    const epoch = state.epoch, id = state.conversation.id;
    const previous = state.drafts.get(id);
    const clientID = previous?.text?.trim() === text && previous.clientID ? previous.clientID : crypto.randomUUID();
    state.drafts.set(id, { text: byID('chatText').value, clientID });
    state.pending.set(clientID, { conversationID: id, clientID, text, failed: false });
    drawMessages({ scroll: 'bottom', pendingID:clientID });
    state.sending = true;
    byID('chatSend').disabled = true;
    byID('chatText').disabled = true;
    byID('chatSend').setAttribute('aria-label', 'Отправляем сообщение');
    try {
      await ensureSession();
      if (stale(epoch)) return;
      const data = await request('messages', { method: 'POST', body: { conversationID: id, text, clientID } });
      if (stale(epoch)) return;
      state.pending.delete(clientID);
      state.drafts.delete(id);
      const cached = state.history.get(id);
      if (cached && state.conversation?.id !== id) {
        cached.messages = [...cached.messages.filter(message => message.id !== data.message.id), data.message]
          .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1).slice(-200);
      }
      if (state.conversation?.id === id) {
        state.messages.set(data.message.id, data.message);
        rememberHistory();
        byID('chatText').value = '';
        drawMessages({ scroll: 'bottom' });
        status();
      }
    } catch (error) {
      if (!stale(epoch)) {
        const pending = state.pending.get(clientID);
        if (pending) pending.failed = true;
        if (state.conversation?.id === id) drawMessages();
        showError(error);
      }
    }
    finally {
      if (!stale(epoch)) {
        state.sending = false;
        byID('chatText').disabled = false;
        byID('chatSend').setAttribute('aria-label', 'Отправить сообщение');
        resizeComposer();
        scheduleRefresh();
      }
    }
  }
  function reset() {
    stopTyping(); showTyping(false);
    closePeerProfile();
    state.epoch++;
    state.searchVersion++;
    clearTimeout(state.timer);
    clearTimeout(state.searchTimer);
    clearTimeout(state.badgeTimer);
    state.monitoring = state.badgeBusy = false;
    updateBadge(0);
    state.visible = false;
    fitConversation();
    state.profile = null;
    state.conversation = null;
    state.messages.clear();
    state.drafts.clear();
    state.history.clear();
    state.pending.clear();
    state.readThrough.clear();
    state.inboxAt = 0;
    state.sending = state.refreshing = false;
    root.classList.remove('chat-in-thread');
    byID('chatInboxView').hidden = false;
    byID('chatThread').hidden = true;
    byID('chatInbox').replaceChildren();
    byID('chatInbox').hidden = false;
    byID('chatResults').replaceChildren();
    byID('chatResults').hidden = true;
    byID('chatMessages').replaceChildren();
    byID('chatSearch').value = byID('chatText').value = '';
    byID('chatText').disabled = false;
    status();
  }
  async function logoutChat() {
    const pendingSession = state.sessionWork;
    reset();
    // A late bootstrap response may set a cookie: revoke it after it settles.
    if (pendingSession) await pendingSession.catch(() => {});
    try { await request('session', { method: 'DELETE' }); }
    catch { /* The route clears the cookie even if its database is unavailable. */ }
  }
  window.univerChat = {
    async refreshNow() {
      if (chatRefreshTask) await chatRefreshTask;
      state.inboxAt = 0;
      clearTimeout(state.timer);
      await refresh(true);
    },
    onLogin() {
      const epoch = state.epoch;
      const start = telegramApp?.initDataUnsafe?.start_param || new URLSearchParams(window.location?.search || '').get('tgWebAppStartParam');
      const match = /^chat_([a-f0-9-]{36})$/i.exec(start || '');
      state.monitoring = true;
      ensureSession().then(async () => {
        if (stale(epoch)) return;
        scheduleBadge();
        if (!match) return;
        const data = await request('conversation',{params:{conversationID:match[1]}});
        if (stale(epoch)) return;
        switchSection('chat');
        openConversation(data.conversation);
      }).catch(error => {
        if (stale(epoch)) return;
        if (['chat_not_configured','chat_setup_required'].includes(error.message)) state.monitoring = false;
        scheduleBadge();
      });
    },
    onSection(section) {
      if (section !== 'chat') { stopTyping(); showTyping(false); }
      if (section !== 'chat') closePeerProfile();
      state.visible = section === 'chat';
      fitConversation();
      clearTimeout(state.timer);
      clearTimeout(state.searchTimer);
      if (state.visible) { status(state.profile ? '' : 'Подключаем чат…'); refresh(true); }
    },
    logout: logoutChat,
  };
  byID('chatSearch').addEventListener('input', () => {
    state.searchVersion++;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(search, 300);
  });
  byID('chatBack').addEventListener('click', closeConversation);
  byID('chatPeerAvatar').addEventListener('click', openPeerProfile);
  byID('chatProfileBack').addEventListener('click', () => { closePeerProfile(); window.univerChat.refreshNow(); });
  byID('chatOlder').addEventListener('click', async () => {
    const button = byID('chatOlder'), epoch = state.epoch;
    button.disabled = true;
    try { await ensureSession(); await refreshMessages({ older: true }); }
    catch (error) { if (!stale(epoch)) showError(error); }
    finally { button.disabled = false; }
  });
  byID('chatComposer').addEventListener('submit', send);
  byID('chatText').addEventListener('input', () => { resizeComposer(); publishTyping(); });
  byID('chatText').addEventListener('blur', stopTyping);
  window.visualViewport?.addEventListener('resize', fitConversation);
  window.visualViewport?.addEventListener('scroll', fitConversation);
  byID('chatText').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && window.matchMedia('(pointer: fine)').matches) {
      event.preventDefault(); byID('chatComposer').requestSubmit();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopTyping(); showTyping(false); }
    clearTimeout(state.timer);
    clearTimeout(state.badgeTimer);
    if (!document.hidden && state.visible) refresh();
    else if (!document.hidden) refreshBadge();
  });
})();
