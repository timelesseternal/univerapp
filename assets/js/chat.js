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
    monitoring: false, badgeTimer: null, badgeBusy: false, peerProfileOpen: false, peerProfileVersion: 0,
    inbox: [], inboxRenderKey: null, previewKey: null, previewOwnerID: null, canResume: false };
  const warming = new Set();
  let replyTarget = null, actionsMessage = null, actionsVersion = 0, actionsBusy = false;
  let deletionRevision = '0', actionsAvailable = false, deleteScopes = false, selectedBubble = null;
  const deletedMessages = new Set();
  let searchOpen = false;
  function setSearchOpen(open, focus = true) {
    searchOpen = open;
    root.classList.toggle?.('chat-search-open',open);
    const input=byID('chatSearch'), button=byID('chatSearchToggle');
    button.setAttribute('aria-expanded',String(open));
    button.setAttribute('aria-label',open ? 'Закрыть поиск' : 'Найти студента');
    input.disabled = !open; input.tabIndex = open ? 0 : -1;
    if (open) { if (focus) input.focus(); return; }
    state.searchVersion++; clearTimeout(state.searchTimer);
    input.value=''; input.blur?.();
    byID('chatResults').replaceChildren(); byID('chatResults').hidden=true;
    byID('chatInbox').hidden=false;
    if (focus) button.focus();
  }
  function setReply(message, focus = false) {
    replyTarget = message && !message.deleted ? message : null;
    byID('chatReply').hidden = !replyTarget;
    byID('chatReplyName').textContent = replyTarget ? (replyTarget.senderID === state.profile?.id ? 'Ответ себе' : state.conversation?.peer.name || 'Ответ') : '';
    byID('chatReplyText').textContent = replyTarget?.text || '';
    if (focus) byID('chatText').focus();
    fitConversation();
  }
  function closeActions() {
    actionsVersion++;
    actionsMessage = null;
    selectedBubble?.classList.remove('chat-message-selected'); selectedBubble = null;
    byID('chatActionsDialog').close?.();
  }
  function actionButton(text, callback, className = '') {
    const button = node('button', `chat-action-button ${className}`, text);
    button.type = 'button';
    const paths = { 'Ответить':'M10 8 4 12l6 4v-3h4c3 0 5 2 6 5 0-7-3-10-10-10Z',
      'Переслать':'m14 8 6 4-6 4v-3h-4c-3 0-5 2-6 5 0-7 3-10 10-10Z',
      'Удалить':'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7' };
    if (paths[text]) {
      const icon = node('span','chat-action-symbol'); icon.setAttribute('aria-hidden','true');
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[text]}"/></svg>`;
      button.append(icon);
    }
    button.addEventListener('click', callback);
    return button;
  }
  function eraseMessage(id) {
    deletedMessages.add(id);
    for (const message of state.messages.values()) {
      if (message.id === id) Object.assign(message,{text:'Сообщение удалено',deleted:true,hidden:true,reply:null,forwardedName:null});
      if (message.reply?.id === id) message.reply = {...message.reply,text:'Сообщение удалено',deleted:true};
    }
    // Discard stale previews too; replies must not retain erased message text.
    for (const entry of state.history.values()) for (const message of entry.messages) {
      if (message.id === id) Object.assign(message,{text:'Сообщение удалено',deleted:true,hidden:true,reply:null,forwardedName:null});
      if (message.reply?.id === id) message.reply = {...message.reply,text:'Сообщение удалено',deleted:true};
    }
    if (replyTarget?.id === id) setReply(null);
    if (actionsMessage?.id === id && !actionsBusy) closeActions();
  }
  function openActions(message, bubble) {
    if (!state.profile || !actionsAvailable || message.deleted || deletedMessages.has(message.id)) return;
    closeActions();
    actionsMessage = message;
    selectedBubble = bubble || null; selectedBubble?.classList.add('chat-message-selected');
    const dialog = byID('chatActionsDialog'); dialog.setAttribute('data-view','menu');
    dialog.style.left = dialog.style.top = ''; byID('chatActionsPreview').hidden = true;
    byID('chatActionsTitle').textContent = 'Сообщение';
    byID('chatActionsPreview').textContent = message.text;
    byID('chatActionsStatus').textContent = '';
    const content = byID('chatActionsContent');
    content.replaceChildren(actionButton('Ответить', () => { closeActions(); setReply(message,true); }),
      actionButton('Переслать', () => chooseForward(message)));
    if (deleteScopes || message.senderID === state.profile.id) content.append(actionButton('Удалить', () => confirmDelete(message),'chat-action-danger'));
    dialog.showModal?.();
    if (bubble?.getBoundingClientRect && dialog.getBoundingClientRect) {
      const rect = bubble.getBoundingClientRect(), size = dialog.getBoundingClientRect(), viewport = window.visualViewport;
      const top = viewport?.offsetTop || 0, width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
      dialog.style.left = `${Math.max(12,Math.min(width-size.width-12,message.senderID === state.profile.id ? rect.right-size.width : rect.left))}px`;
      dialog.style.top = `${Math.max(top+12,Math.min(top+height-size.height-12,rect.bottom+8))}px`;
    }
  }
  function confirmDelete(message) {
    const scopedDeletion = deleteScopes;
    const dialog = byID('chatActionsDialog'); dialog.setAttribute('data-view','delete'); dialog.style.left = dialog.style.top = '';
    byID('chatActionsPreview').hidden = false;
    byID('chatActionsTitle').textContent = 'Удалить сообщение?';
    byID('chatActionsStatus').textContent = scopedDeletion ? '«У меня» — только из вашей истории. «У всех» — у обоих участников. Отменить удаление нельзя.' : 'Сообщение будет удалено у вас и собеседника. Отменить это действие нельзя.';
    const conversationID = state.conversation.id, epoch = state.epoch;
    const remove = scope => async event => {
      if (actionsBusy) return;
      actionsBusy = true; event.currentTarget.disabled = true;
      const version = actionsVersion;
      try {
        await request('messages',{method:'DELETE',body:{conversationID,messageID:message.id,...(scopedDeletion ? {scope} : {})}});
        if (stale(epoch)) return;
        // Deletion can finish after the user has opened another conversation.
        if (state.conversation?.id === conversationID) { eraseMessage(message.id); drawMessages(); rememberHistory(); }
        else state.history.delete(conversationID);
        state.inbox = state.inbox.map(item=>item.id===conversationID ? {...item,lastMessage:null,unread:0} : item);
        persistPreview();
        state.inboxAt = 0; state.inboxRenderKey = null;
        if (version === actionsVersion) closeActions();
      } catch (error) { if (!stale(epoch) && version === actionsVersion) byID('chatActionsStatus').textContent = labels[error.message] || 'Не удалось удалить. Попробуйте ещё раз.'; }
      finally { actionsBusy = false; event.currentTarget.disabled = false; }
    };
    const buttons = scopedDeletion ? [actionButton('Удалить у меня',remove('self'),'chat-action-danger')] : [];
    buttons.push(actionButton('Удалить у всех',remove('everyone'),'chat-action-danger'),actionButton('Отмена',closeActions));
    byID('chatActionsContent').replaceChildren(...buttons);
  }
  function chooseForward(message) {
    const dialog = byID('chatActionsDialog'); dialog.setAttribute('data-view','forward'); dialog.style.left = dialog.style.top = '';
    byID('chatActionsPreview').hidden = false;
    const version = ++actionsVersion, epoch = state.epoch;
    byID('chatActionsTitle').textContent = 'Кому переслать?';
    const search = node('input','chat-forward-search');
    search.type = 'search'; search.placeholder = 'Найти студента'; search.setAttribute('aria-label','Найти получателя');
    const list = node('div','chat-forward-list');
    const valid = () => version === actionsVersion && !stale(epoch);
    let searchSequence = 0, searchTimer;
    const choose = (peer, conversation) => {
      if (!valid()) return;
      searchSequence++;
      byID('chatActionsTitle').textContent = `Переслать: ${peer.name}`;
      byID('chatActionsStatus').textContent = 'Получатель увидит текст сообщения и имя его автора.';
      const clientID = crypto.randomUUID();
      byID('chatActionsContent').replaceChildren(actionButton('Переслать сообщение', async event => {
        if (actionsBusy || !valid()) return;
        actionsBusy = true; event.currentTarget.disabled = true;
        try {
          const target = conversation || (await request('conversations',{method:'POST',body:{peerID:peer.id}})).conversation;
          if (!valid()) return;
          const data = await request('messages',{method:'POST',body:{conversationID:target.id,forwardID:message.id,clientID}});
          if (stale(epoch)) return;
          state.history.delete(target.id); state.inboxAt = 0;
          if (state.conversation?.id === target.id) { state.messages.set(data.message.id,data.message); drawMessages({scroll:'bottom'}); rememberHistory(); }
          if (valid()) { byID('chatActionsContent').replaceChildren(actionButton('Готово',closeActions)); byID('chatActionsStatus').textContent = 'Сообщение переслано'; }
        } catch (error) { if (valid()) byID('chatActionsStatus').textContent = labels[error.message] || 'Не удалось переслать. Попробуйте ещё раз.'; }
        finally { actionsBusy = false; event.currentTarget.disabled = false; }
      },'chat-action-primary'),actionButton('Назад к получателям',() => chooseForward(message)));
    };
    const recent = () => {
      list.replaceChildren(...state.inbox.map(conversation => actionButton(conversation.peer.name,() => choose(conversation.peer,conversation))));
      if (!state.inbox.length) list.append(node('p','chat-actions-status','Введите имя получателя в поиске'));
    };
    recent();
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const sequence = ++searchSequence, query = search.value.trim();
      if (query.length < 2) { recent(); return; }
      searchTimer = setTimeout(async () => {
        if (!valid() || sequence !== searchSequence) return;
        try {
          const data = await request('users',{params:{q:query.slice(0,60)}});
          if (!valid() || sequence !== searchSequence) return;
          list.replaceChildren(...data.users.map(peer => actionButton(peer.name,() => choose(peer))));
          if (!data.users.length) list.append(node('p','chat-actions-status','Никого не нашли'));
        } catch { if (valid() && sequence === searchSequence) byID('chatActionsStatus').textContent = 'Не удалось выполнить поиск'; }
      },300);
    });
    byID('chatActionsStatus').textContent = '';
    byID('chatActionsContent').replaceChildren(search,list);
  }
  function bindMessageActions(article, message) {
    if (message.deleted || !actionsAvailable) return;
    const conversationID = state.conversation?.id, epoch = state.epoch;
    const valid = () => !stale(epoch) && state.visible && state.conversation?.id === conversationID && !deletedMessages.has(message.id);
    let start = null, hold = null, direction = null, distance = 0, suppressClick = false, returnMotion = null;
    const indicator = node('span','chat-swipe-reply','↩'); indicator.setAttribute('aria-hidden','true'); article.append(indicator);
    const reset = (animate = true) => {
      clearTimeout(hold); start = null; direction = null; distance = 0;
      const transform = article.style.transform; article.style.transform = '';
      article.classList.remove('chat-message-swiping','chat-message-reply-ready');
      returnMotion?.cancel(); returnMotion = null;
      if (animate && transform && article.animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
        returnMotion = article.animate([{transform},{transform:'translateX(0)'}],{duration:170,easing:'cubic-bezier(.2,.8,.2,1)'});
    };
    const begin = (x,y,id) => {
      if (!valid()) return;
      reset(false); suppressClick = false;
      if (x < 16 || x > window.innerWidth-16) return;
      start = {x,y,id};
      hold = setTimeout(() => {
        if (!start || !valid()) return;
        suppressClick = true; reset(); openActions(message,article);
        telegramApp?.HapticFeedback?.impactOccurred?.('light');
      },450);
    };
    const move = (x,y,event) => {
      if (!start) return;
      const dx = x-start.x, dy = y-start.y;
      if (Math.abs(dx)>7 || Math.abs(dy)>7) clearTimeout(hold);
      if (!direction && Math.max(Math.abs(dx),Math.abs(dy))>10) {
        if (Math.abs(dy)>Math.abs(dx)*.8 || dx>0) { reset(); return; }
        direction = 'reply';
      }
      if (direction !== 'reply') return;
      if (event.cancelable) event.preventDefault();
      distance = Math.max(0,-dx); suppressClick = true;
      article.classList.add('chat-message-swiping');
      article.classList.toggle?.('chat-message-reply-ready',distance>=52);
      article.style.transform = `translateX(${-Math.min(72,distance*.7)}px)`;
    };
    const finish = () => {
      const reply = start && direction === 'reply' && distance>=52 && valid();
      reset();
      if (reply) { setReply(message,true); telegramApp?.HapticFeedback?.impactOccurred?.('light'); }
    };
    // iOS can cancel pointer events when the scroll container takes the gesture.
    // Handle real touches directly; pointer handlers below are for a mouse/pen.
    article.addEventListener('touchstart',event => {
      if (event.touches.length!==1) { reset(); return; }
      const touch=event.touches[0]; begin(touch.clientX,touch.clientY,touch.identifier);
    },{passive:true});
    article.addEventListener('touchmove',event => {
      if (event.touches.length!==1) { reset(); return; }
      const touch=event.touches[0]; if (start?.id===touch.identifier) move(touch.clientX,touch.clientY,event);
    },{passive:false});
    article.addEventListener('touchend',event => {
      if (!start || ![...event.changedTouches].some(touch=>touch.identifier===start.id)) return;
      if (suppressClick && event.cancelable) event.preventDefault();
      finish();
    },{passive:false});
    article.addEventListener('touchcancel',() => reset());
    article.addEventListener('contextmenu',event => {
      event.preventDefault(); reset();
      if (valid() && !byID('chatActionsDialog').open) openActions(message,article);
    });
    article.addEventListener('click',event => { if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick=false; } },true);
    article.addEventListener('pointerdown',event => {
      if (event.pointerType==='touch' || event.button!==0 || event.isPrimary===false) return;
      begin(event.clientX,event.clientY,event.pointerId);
      if (start) article.setPointerCapture?.(event.pointerId);
    });
    article.addEventListener('pointermove',event => {
      if (event.pointerType!=='touch' && start?.id===event.pointerId) move(event.clientX,event.clientY,event);
    });
    article.addEventListener('pointerup',event => { if (event.pointerType!=='touch' && start?.id===event.pointerId) finish(); });
    article.addEventListener('pointercancel',event => { if (event.pointerType!=='touch') reset(); });
    article.addEventListener('lostpointercapture',event => { if (event.pointerType!=='touch' && start) reset(); });
    article.tabIndex = 0;
    article.setAttribute('aria-label',`Сообщение: ${message.text.slice(0,100)}. Действия — Enter`);
    article.addEventListener('keydown',event => {
      if (event.target!==article || !['Enter','ContextMenu'].includes(event.key)) return;
      event.preventDefault(); if (valid()) openActions(message,article);
    });
  }
  const presenceClientID = crypto.randomUUID();
  let presenceSequence = 0, presenceTimer = null, peerPresenceTimer = null;
  function publishPresence(active = true) {
    clearTimeout(presenceTimer);
    if (!state.profile || (active && document.hidden)) return;
    const epoch = state.epoch, sequence = ++presenceSequence;
    request('presence', {method:'POST',body:{active,clientID:presenceClientID,sequence},keepalive:!active})
      .catch(() => {}) // An older database must not interrupt messages.
      .finally(() => {
        if (!stale(epoch) && sequence === presenceSequence && active && !document.hidden && state.monitoring)
          presenceTimer = setTimeout(() => publishPresence(), 20000);
      });
  }
  function peerStatus(presence) {
    clearTimeout(peerPresenceTimer);
    const caption = byID('chatPeerStatus');
    const seen = Date.parse(presence?.lastSeen);
    const age = Date.now() - seen;
    const online = presence?.online === true && Number.isFinite(seen) && age < 45000;
    caption.classList.toggle?.('peer-online', online);
    if (online) {
      caption.textContent = 'В сети';
      peerPresenceTimer = setTimeout(() => peerStatus({...presence,online:false}), Math.max(1000,45000-age));
    } else if (Number.isFinite(seen)) {
      const date = new Date(seen), today = new Date(), yesterday = new Date();
      yesterday.setDate(today.getDate()-1);
      const day = date.toDateString() === today.toDateString() ? 'сегодня'
        : date.toDateString() === yesterday.toDateString() ? 'вчера' : date.toLocaleDateString('ru-RU');
      caption.textContent = `Был(а) в сети ${day} в ${date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
    } else caption.textContent = 'Статус неизвестен';
  }
  function previewKey() {
    const id = typeof platonusStudent !== 'undefined' && Number(platonusStudent?.studentID);
    return Number.isSafeInteger(id) && id > 0 ? `univer-chat-preview-${id}` : null;
  }
  function persistPreview() {
    const key = previewKey();
    if (!key || !state.profile) return;
    state.previewKey = key;
    try {
      const history = [...state.history].slice(-5).map(([id, entry]) => [id,
        { messages: entry.messages.slice(-40), hasOlder: entry.hasOlder || entry.messages.length > 40, at: entry.at }]);
      const snapshot = JSON.stringify({ at: Date.now(), profileID: state.profile.id, inbox: state.inbox.slice(0, 30), history });
      if (snapshot.length < 300000) window.sessionStorage?.setItem(key, snapshot);
    } catch { /* Memory previews still work when session storage is unavailable. */ }
  }
  function restorePreview() {
    const key = previewKey();
    if (!key) return;
    state.previewKey = key;
    try {
      const saved = JSON.parse(window.sessionStorage?.getItem(key) || 'null');
      if (!saved || !Number.isFinite(saved.at) || Date.now() - saved.at > 8 * 60 * 60 * 1000 || !Array.isArray(saved.inbox)
        || typeof saved.profileID !== 'string' || saved.inbox.some(item => !item?.id || typeof item.peer?.name !== 'string')) return;
      state.canResume = true;
      state.previewOwnerID = saved.profileID;
      for (const [id, entry] of (saved.history || []).slice(-5)) {
        if (Array.isArray(entry?.messages) && entry.messages.every(message => /^[1-9]\d{0,18}$/.test(message?.id)
          && typeof message.text === 'string' && Number.isFinite(Date.parse(message.createdAt)))) state.history.set(id, entry);
      }
      drawInbox(saved.inbox, saved.profileID);
    } catch { /* Ignore incomplete snapshots. Never restore an authenticated session. */ }
  }
  function warmConversations(conversations) {
    const defer = window.requestIdleCallback || window.setTimeout;
    if (!defer || !state.profile || document.hidden) return;
    const epoch = state.epoch;
    const recent = conversations.filter(item => item.lastMessage && !state.history.has(item.id) && !warming.has(item.id)).slice(0, 2);
    for (const conversation of recent) {
      warming.add(conversation.id);
      defer(() => {
        if (stale(epoch) || document.hidden) { warming.delete(conversation.id); return; }
        request('messages', { params: { conversationID: conversation.id } }).then(data => {
          if (stale(epoch) || state.history.has(conversation.id) || !Array.isArray(data.messages)) return;
          state.history.set(conversation.id, { messages: data.messages, hasOlder: data.hasMore, at: Date.now() });
          persistPreview();
        }).catch(() => {}).finally(() => { warming.delete(conversation.id); });
      });
    }
  }
  const telegramApp = window.Telegram?.WebApp?.initData ? window.Telegram.WebApp : null;
  let restingViewportHeight = window.innerHeight || 0;
  let restingViewportWidth = window.innerWidth || 0;
  let keyboardVisible = false;
  let typingAt = 0, typingConversation = null, typingTimer = null, peerTypingTimer = null;
  function fitConversation() {
    const viewport = window.visualViewport;
    if (!viewport || !root.getBoundingClientRect) return;
    if (window.innerWidth !== restingViewportWidth) {
      restingViewportWidth = window.innerWidth;
      restingViewportHeight = window.innerHeight || viewport.height;
    }
    const typing = document.activeElement === byID('chatText');
    if (!typing && !keyboardVisible) restingViewportHeight = window.innerHeight || viewport.height;
    const keyboard = state.visible && !!state.conversation && !state.peerProfileOpen && (typing || keyboardVisible)
      && Math.abs((viewport.scale || 1) - 1) < 0.01
      && Math.max(restingViewportHeight, window.innerHeight || 0) - viewport.height > 120;
    keyboardVisible = keyboard;
    document.body?.classList.toggle('chat-keyboard-open', keyboard);
    if (state.visible && state.conversation) {
      const list = byID('chatMessages');
      const bottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
      if (keyboard) {
        // Anchor the entire thread to the visible viewport. Measuring its old
        // position here feeds Safari's focus pan back into the next layout.
        root.style.setProperty('--chat-viewport-top', `${Math.max(0, viewport.offsetTop || 0)}px`);
        root.style.setProperty('--chat-viewport-height', `${Math.max(120, viewport.height - 12)}px`);
      } else {
        const viewportBottom = viewport.height + (viewport.offsetTop || 0);
        const navTop = byID('bottomTabBar')?.getBoundingClientRect?.().top;
        const boundary = Number.isFinite(navTop) && navTop > 0
          ? Math.min(viewportBottom, navTop) - 12 : viewportBottom - 112;
        const threadTop = byID('chatThread')?.getBoundingClientRect?.().top;
        const height = Math.max(120, boundary - (Number.isFinite(threadTop) ? threadTop : root.getBoundingClientRect().top));
        root.style.setProperty('--chat-height', `${height}px`);
      }
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
  const bootstrap = () => request('session', { method:'POST',
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
    invalid_chat_request: 'Сообщение уже недоступно. Обновите переписку и попробуйте снова.',
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
  function loadingPlaceholder(kind, count = 5) {
    const placeholder = node('div', `chat-loading chat-loading-${kind}`);
    placeholder.setAttribute('role', 'status');
    placeholder.setAttribute('aria-label', kind === 'history' ? 'Загружаем переписку' : 'Загружаем список пользователей');
    for (let index = 0; index < count; index++) {
      const row = node('div', kind === 'history' ? 'skeleton-block chat-skeleton-bubble' : 'chat-person chat-skeleton-person');
      row.setAttribute('aria-hidden', 'true');
      if (kind !== 'history') {
        const content = node('div', 'chat-person-content');
        content.append(node('span', 'skeleton-block chat-skeleton-name'), node('span', 'skeleton-block chat-skeleton-preview'));
        row.append(node('span', 'skeleton-block chat-skeleton-avatar'), content, node('span', 'skeleton-block chat-skeleton-time'));
      }
      placeholder.append(row);
    }
    return placeholder;
  }
  function showInboxLoading() {
    if (!state.conversation && !state.inboxAt && state.inboxRenderKey === null) {
      status();
      byID('chatInbox').replaceChildren(loadingPlaceholder('inbox'));
    }
  }
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
    for (const id of ['chatInbox', 'chatMessages']) {
      const list = byID(id);
      if ([...list.children].some(child => child.className?.startsWith('chat-loading '))) list.replaceChildren();
    }
    status(labels[error.message] || 'Не удалось подключиться. Проверьте интернет и повторите попытку.', true);
  }
  async function request(action, { method = 'GET', params = {}, body, headers = {}, keepalive = false } = {}) {
    const epoch = state.epoch;
    const query = new URLSearchParams({ action, ...params });
    let response;
    try {
      response = await fetch(`/api/chat?${query}`, {
        method, credentials: 'same-origin', cache: 'no-store', keepalive,
        headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(action === 'session' && method === 'POST' ? 22000 : 12000),
      });
    } catch { throw new Error('chat_unavailable'); }
    const data = await response.json().catch(() => null);
    if (stale(epoch)) throw new Error('session_changed');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('chat_unavailable');
    if (!response.ok) {
      if (data.error === 'chat_session_expired' && !stale(epoch)) state.profile = null;
      throw new Error(data.error || 'chat_unavailable');
    }
    const person = value => value && typeof value.id === 'string' && typeof value.name === 'string';
    const conversation = value => value && typeof value.id === 'string' && person(value.peer);
    const message = value => value && typeof value.id === 'string' && /^\d{1,20}$/.test(value.id)
      && typeof value.senderID === 'string' && typeof value.text === 'string'
      && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt));
    if ((action === 'session' && !person(data.profile))
      || (action === 'session' && data.conversations !== undefined
        && (!Array.isArray(data.conversations) || !data.conversations.every(conversation)))
      || (action === 'inbox' && (!Array.isArray(data.conversations) || !data.conversations.every(conversation)))
      || (action === 'users' && (!Array.isArray(data.users) || !data.users.every(person)))
      || (['conversation', 'conversations'].includes(action) && !conversation(data.conversation))
      || (action === 'messages' && method === 'GET' && (!Array.isArray(data.messages) || !data.messages.every(message)))
      || (action === 'messages' && method === 'POST' && !message(data.message))) {
      throw new Error('chat_unavailable');
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
        if (state.canResume) {
          state.canResume = false;
          try { data = await request('session', { params: { studentID: platonusStudent.studentID } }); }
          catch (error) { if (error.message !== 'chat_session_expired') throw error; }
        }
        if (!data) data = await bootstrap();
      } catch (error) {
        if (stale(epoch) || generation !== authGeneration) throw new Error('session_changed');
        if (error.message !== 'session_expired') throw error;
        if (!await silentRelogin(true)) { logout(false); throw error; }
        if (stale(epoch) || generation !== authGeneration) throw new Error('session_changed');
        data = await bootstrap();
      }
      if (stale(epoch) || generation !== authGeneration) throw new Error('session_changed');
      state.profile = data.profile;
      window.unilinkPush?.onProfile(data.profile);
      if (state.monitoring) publishPresence();
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
  function drawInbox(conversations, ownID = state.profile?.id) {
    state.inbox = conversations;
    updateBadge(conversations.reduce((total, conversation) => total + Math.max(0, Number(conversation.unread) || 0), 0));
    const renderKey = JSON.stringify([ownID, new Date().toDateString(), conversations]);
    if (state.inboxRenderKey === renderKey) { warmConversations(conversations); return; }
    state.inboxRenderKey = renderKey;
    const list = byID('chatInbox');
    list.replaceChildren();
    if (!conversations.length) {
      list.append(node('p', 'chat-empty', 'Пока нет переписок. Найдите знакомого по имени и напишите первым.'));
      persistPreview();
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
      const prefix = conversation.lastMessage?.senderID === ownID ? 'Вы: ' : '';
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
    persistPreview();
    warmConversations(conversations);
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
    state.history.set(id, { messages: messages.slice(-200), hasOlder: state.hasOlder || messages.length > 200, at: Date.now() });
    if (state.history.size > 10) state.history.delete(state.history.keys().next().value);
    persistPreview();
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
    const visibleMessages = orderedMessages().filter(message=>!message.deleted && !message.hidden);
    for (const message of visibleMessages) {
      const date = new Date(message.createdAt);
      const day = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
      if (day !== lastDay) { list.append(node('div', 'chat-date', day)); lastDay = day; }
      const article = node('article', message.senderID === (state.profile?.id || state.previewOwnerID) ? 'chat-message chat-message-own' : 'chat-message');
      article.setAttribute('data-message-id',message.id);
      if (message.deleted) article.classList.add('chat-message-deleted');
      if (message.forwardedName && !message.deleted) article.append(node('span','chat-forward-label',`Переслано от ${message.forwardedName}`));
      if (message.reply && !message.deleted) {
        const quote = node('button','chat-message-quote'); quote.type = 'button';
        quote.append(node('strong','',message.reply.senderID === state.profile?.id ? 'Вы' : message.reply.name || 'Ответ'),
          node('span','',message.reply.deleted ? 'Сообщение удалено' : message.reply.text));
        quote.addEventListener('click',() => {
          const target = [...list.children].find(element => element.getAttribute?.('data-message-id') === message.reply.id);
          if (!target) { status('Это сообщение выше в истории — нажмите «Предыдущие сообщения».'); return; }
          target.scrollIntoView?.({block:'center',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
          target.classList.add('chat-message-highlight'); setTimeout(() => target.classList.remove('chat-message-highlight'),1200);
        });
        article.append(quote);
      }
      article.append(node('p', 'chat-message-text', message.text));
      const time = node('time', 'chat-message-time', date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
      time.dateTime = message.createdAt;
      const footer = node('div','chat-message-footer'); footer.append(time);
      article.append(footer);
      bindMessageActions(article,message);
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
    if (!visibleMessages.length && !pending.length) list.append(node('p', 'chat-empty', 'Пока нет сообщений. Поздоровайтесь!'));
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
  async function refreshMessages({ older = false, initial = false, after } = {}) {
    if (!state.conversation) return;
    const epoch = state.epoch, id = state.conversation.id;
    const messages = orderedMessages();
    const params = { conversationID: id, revision: deletionRevision };
    if (older && messages.length) params.before = messages[0].id;
    // Catch up from the cached boundary, including on reopening. A latest page
    // can skip messages between the cache and that page after a long absence.
    else if (messages.length) params.after = after || messages.at(-1).id;
    const data = await request('messages', { params });
    if (stale(epoch) || state.conversation?.id !== id) return;
    const previousActions = actionsAvailable;
    actionsAvailable = data.actionsAvailable === true;
    const previousScopes = deleteScopes; deleteScopes = data.deleteScopes === true;
    if (typeof data.revision === 'string' && /^\d{1,19}$/.test(data.revision) && BigInt(data.revision) > BigInt(deletionRevision)) deletionRevision = data.revision;
    showTyping(data.peerTyping === true && state.visible && !state.peerProfileOpen);
    peerStatus(data.peerPresence);
    if (!params.after) state.hasOlder = data.hasMore;
    const newIDs = new Set(data.messages.filter(message => !state.messages.has(message.id)).map(message => message.id));
    let changed = newIDs.size > 0 || previousActions !== actionsAvailable || previousScopes !== deleteScopes;
    // Initial fetches contain the latest page, not the complete conversation.
    // Merge it so refreshes cannot discard loaded history or a just-sent message.
    for (const message of data.messages) {
      if (JSON.stringify(state.messages.get(message.id)) !== JSON.stringify(message)) changed = true;
      state.messages.set(message.id, message);
      if (message.senderID === state.profile.id && state.pending.delete(message.clientID)) changed = true;
    }
    for (const message of data.messages) if (message.deleted) deletedMessages.add(message.id);
    if (Array.isArray(data.deletedIDs)) for (const deletedID of data.deletedIDs) {
      if (typeof deletedID === 'string' && /^[1-9]\d{0,18}$/.test(deletedID)) { deletedMessages.add(deletedID); changed = true; }
    }
    if (Array.isArray(data.hiddenIDs)) for (const hiddenID of data.hiddenIDs) {
      if (typeof hiddenID === 'string' && /^[1-9]\d{0,18}$/.test(hiddenID)) { deletedMessages.add(hiddenID); changed = true; }
    }
    for (const deletedID of deletedMessages) eraseMessage(deletedID);
    rememberHistory();
    if (changed || initial || older) drawMessages({ scroll: initial ? 'bottom' : older ? 'older' : 'keep',
      newIDs: initial || older ? new Set() : newIDs });
    // Continue from this response, not a newer message concurrently sent locally.
    if (params.after && data.hasMore && data.messages.length) {
      const cursor = data.messages.at(-1).id;
      if (BigInt(cursor) <= BigInt(params.after)) throw new Error('chat_unavailable');
      await refreshMessages({ initial, after: cursor });
    }
    if (stale(epoch) || state.conversation?.id !== id) return;
    if (state.visible && !state.peerProfileOpen && !document.hidden && state.conversation?.id===id) {
      const through = orderedMessages().at(-1)?.id;
      if (through && state.readThrough.get(id)!==through) {
        // Acknowledge after visible rendering, without delaying the message refresh.
        request('read', { method:'POST',body:{conversationID:id,throughID:through} }).then(() => {
          if (!stale(epoch)) { state.readThrough.set(id,through); window.unilinkPush?.read(id); refreshBadge(true); }
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
    showInboxLoading();
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
    results.append(loadingPlaceholder('search', 3));
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
      state.drafts.set(state.conversation.id, { text, replyTarget, replyTo:replyTarget?.id || null,
        clientID: old?.text === text && old?.replyTo === (replyTarget?.id || null) ? old.clientID : null });
    }
  }
  async function openConversation(conversation) {
    byID('chatSearch').blur?.();
    closeActions(); deletionRevision = '0'; actionsAvailable = false; deletedMessages.clear();
    stopTyping(); showTyping(false);
    closePeerProfile();
    saveDraft();
    rememberHistory();
    state.conversation = conversation;
    setReply(state.drafts.get(conversation.id)?.replyTarget || null);
    peerStatus(null);
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
    else byID('chatMessages').replaceChildren(loadingPlaceholder('history', 6));
    const epoch = state.epoch;
    try {
      await ensureSession();
      if (stale(epoch) || state.conversation?.id !== conversation.id) return;
      await refreshMessages({ initial: !cached?.at || Date.now() - cached.at >= 8000 });
      if (!stale(epoch)) { status(); scheduleRefresh(); }
    } catch (error) { if (!stale(epoch) && state.conversation?.id === conversation.id) showError(error); }
  }
  function closeConversation() {
    closeActions(); actionsAvailable = false; deletedMessages.clear();
    stopTyping(); showTyping(false);
    closePeerProfile();
    saveDraft();
    rememberHistory();
    state.conversation = null;
    setReply(null);
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
    input.style.overflowY = 'hidden';
    input.style.height = 'auto';
    const border = Number.isFinite(input.offsetHeight - input.clientHeight) ? input.offsetHeight - input.clientHeight : 2;
    const height = input.scrollHeight + Math.max(0, border);
    input.style.height = Math.min(120, height) + 'px';
    input.style.overflowY = height > 120 ? 'auto' : 'hidden';
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
    const loading = node('div', 'chat-profile-loading');
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-label', 'Загружаем профиль');
    loading.innerHTML = window.unilinkLoading.icon();
    content.replaceChildren(loading);
    try {
      await ensureSession();
      if (stale(epoch) || version !== state.peerProfileVersion || state.conversation?.id !== id) return;
      let data;
      try { data = await request('profile', { params: { conversationID: id } }); }
      catch (error) {
        if (error.message !== 'chat_session_expired') throw error;
        await ensureSession();
        if (stale(epoch) || version !== state.peerProfileVersion || state.conversation?.id !== id) return;
        data = await request('profile', { params: { conversationID: id } });
      }
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
      if (person.studyAvailable === false) content.append(node('p', 'chat-empty', 'Для GPA, курса и группы необходимо подключить учебные профили в базе приложения.'));
      else if (!person.updatedAt) content.append(node('p', 'chat-empty', 'Учебные данные появятся, когда пользователь снова откроет приложение.'));
    } catch (error) {
      if (!stale(epoch) && version === state.peerProfileVersion) {
        const retry = node('button', 'chat-retry', 'Повторить загрузку');
        retry.type = 'button';
        retry.addEventListener('click', openPeerProfile);
        content.replaceChildren(node('p', 'chat-empty', error.message === 'chat_setup_required' ? 'Профили ещё не подключены: требуется обновление базы данных.' : 'Не удалось загрузить профиль.'), retry);
      }
    }
  }
  async function send(event) {
    event.preventDefault();
    if (!state.conversation || state.sending) return;
    const draftText = byID('chatText').value;
    const text = draftText.trim();
    if (!text || text.length > 2000) return;
    stopTyping();
    const epoch = state.epoch, id = state.conversation.id;
    const previous = state.drafts.get(id);
    const replyTo = replyTarget?.id || null;
    const clientID = previous?.text?.trim() === text && previous.replyTo === replyTo && previous.clientID ? previous.clientID : crypto.randomUUID();
    state.drafts.set(id, { text: byID('chatText').value, clientID, replyTo, replyTarget });
    state.pending.set(clientID, { conversationID: id, clientID, text, failed: false });
    drawMessages({ scroll: 'bottom', pendingID:clientID });
    state.sending = true;
    byID('chatSend').disabled = true;
    // Keep focus (and the phone keyboard) while the request is pending.
    byID('chatSend').setAttribute('aria-label', 'Отправляем сообщение');
    try {
      await ensureSession();
      if (stale(epoch)) return;
      const data = await request('messages', { method: 'POST', body: { conversationID: id, text, clientID, ...(replyTo ? {replyTo} : {}) } });
      if (stale(epoch)) return;
      state.pending.delete(clientID);
      const currentDraft = state.conversation?.id === id ? byID('chatText').value : state.drafts.get(id)?.text;
      if (currentDraft === draftText) state.drafts.delete(id);
      else if (currentDraft !== undefined) state.drafts.set(id, { text: currentDraft, clientID: null });
      const cached = state.history.get(id);
      if (cached && state.conversation?.id !== id) {
        cached.messages = [...cached.messages.filter(message => message.id !== data.message.id), data.message]
          .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1).slice(-200);
      }
      if (state.conversation?.id === id) {
        state.messages.set(data.message.id, data.message);
        rememberHistory();
        if (byID('chatText').value === draftText && (replyTarget?.id || null) === replyTo) byID('chatText').value = '';
        if (replyTarget?.id === replyTo) setReply(null);
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
    setSearchOpen(false,false);
    closeActions(); setReply(null); deletionRevision = '0'; actionsAvailable = false; deletedMessages.clear();
    clearTimeout(presenceTimer); peerStatus(null);
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
    try { if (state.previewKey) window.sessionStorage?.removeItem(state.previewKey); } catch { /* Storage may be disabled. */ }
    state.previewKey = null;
    state.previewOwnerID = null;
    state.canResume = false;
    state.inbox = [];
    state.inboxRenderKey = null;
    warming.clear();
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
    const pushLogout=window.unilinkPush?.logout();
    reset();
    // A late bootstrap response may set a cookie: revoke it after it settles.
    if (pendingSession) await pendingSession.catch(() => {});
    if (pushLogout) await pushLogout.catch(()=>{});
    try { await request('session', { method: 'DELETE' }); }
    catch { /* The route clears the cookie even if its database is unavailable. */ }
  }
  window.univerChat = {
    ensureSession,
    renewSession() {state.profile=null;return ensureSession();},
    async openFromPush(id) {
      if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))return;
      const epoch=state.epoch;
      try {
        await ensureSession();if(stale(epoch))return;
        const data=await request('conversation',{params:{conversationID:id}});if(stale(epoch))return;
        switchSection('chat');await openConversation(data.conversation);
      }catch(error){if(!stale(epoch))showError(error);}
    },
    async refreshNow() {
      if (chatRefreshTask) await chatRefreshTask;
      state.inboxAt = 0;
      clearTimeout(state.timer);
      await refresh(true);
    },
    onLogin() {
      restorePreview();
      const epoch = state.epoch;
      const start = telegramApp?.initDataUnsafe?.start_param || new URLSearchParams(window.location?.search || '').get('tgWebAppStartParam');
      const direct=new URLSearchParams(window.location?.search || '').get('chat');
      const match = /^chat_([a-f0-9-]{36})$/i.exec(start || (direct ? `chat_${direct}` : ''));
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
      if (section !== 'chat') {
        closeActions();
        byID('chatSearch').blur?.();
        if (document.activeElement === byID('chatText')) byID('chatText').blur();
        stopTyping(); showTyping(false);
      }
      if (section !== 'chat') closePeerProfile();
      state.visible = section === 'chat';
      fitConversation();
      clearTimeout(state.timer);
      clearTimeout(state.searchTimer);
      state.searchVersion++;
      if (state.visible) {
        status(); showInboxLoading(); refresh(true);
        if (byID('chatSearch').value.trim()) search();
      }
    },
    logout: logoutChat,
  };
  byID('chatSearchToggle').addEventListener('click',() => setSearchOpen(!searchOpen));
  byID('chatSearch').addEventListener('keydown',event => {
    if (event.key==='Escape') { event.preventDefault(); setSearchOpen(false); }
  });
  byID('chatSearch').addEventListener('input', () => {
    state.searchVersion++;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(search, 300);
  });
  byID('chatBack').addEventListener('click', closeConversation);
  byID('chatReplyCancel').addEventListener('click',() => setReply(null));
  byID('chatActionsClose').addEventListener('click',closeActions);
  byID('chatActionsDialog').addEventListener('cancel',event => { event.preventDefault(); closeActions(); });
  byID('chatActionsDialog').addEventListener('click',event => {
    const dialog=byID('chatActionsDialog');
    if (event.target!==dialog || !dialog.getBoundingClientRect) return;
    const rect=dialog.getBoundingClientRect();
    if (event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) closeActions();
  });
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
  byID('chatSend').addEventListener('pointerdown', event => {
    // Blurring the textarea can move the dock before click is dispatched on iOS.
    if (event.button === 0 && document.activeElement === byID('chatText')) event.preventDefault();
  });
  byID('chatText').addEventListener('input', () => { resizeComposer(); publishTyping(); });
  byID('chatText').addEventListener('blur', () => { stopTyping(); fitConversation(); });
  let fitFrame = 0;
  function scheduleConversationFit() {
    if (!window.requestAnimationFrame) { fitConversation(); return; }
    if (!fitFrame) fitFrame = window.requestAnimationFrame(() => { fitFrame = 0; fitConversation(); });
  }
  window.visualViewport?.addEventListener('resize', scheduleConversationFit);
  window.visualViewport?.addEventListener('scroll', scheduleConversationFit);
  window.addEventListener?.('resize', scheduleConversationFit);
  root.addEventListener('animationend', scheduleConversationFit);
  byID('chatText').addEventListener('focus', scheduleConversationFit);
  byID('chatText').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && window.matchMedia('(pointer: fine)').matches) {
      event.preventDefault(); byID('chatComposer').requestSubmit();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (state.profile && state.monitoring) publishPresence(!document.hidden);
    if (document.hidden) { stopTyping(); showTyping(false); }
    clearTimeout(state.timer);
    clearTimeout(state.badgeTimer);
    if (!document.hidden && state.visible) refresh();
    else if (!document.hidden) refreshBadge();
  });
  window.addEventListener?.('pagehide', () => publishPresence(false));
})();
