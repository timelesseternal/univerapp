import { ChatError, checkOrigin, configuration, currentUser, database, readPeerProfile, readToken, rpc, setCookie, startSession, tokenHash, uuid } from './_lib/chat.js';
import { waitUntil } from '@vercel/functions';
import { linkTelegram, processNotifications } from './_lib/telegram.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Vary', 'Cookie');
  const action = req.query?.action;
  try {
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, DELETE');
      throw new ChatError(405, 'method_not_allowed');
    }
    if (req.method !== 'GET') checkOrigin(req);
    if (action === 'session' && req.method === 'DELETE') {
      const token = readToken(req);
      setCookie(req, res, '', 0);
      // Clear the browser cookie even if the database is temporarily unavailable.
      if (token) {
        try { await database(`chat_sessions?token_hash=eq.${tokenHash(token)}`, { method: 'DELETE' }); }
        catch { throw new ChatError(503, 'chat_logout_unavailable'); }
      }
      res.status(200).json({ ok: true });
      return;
    }
    configuration();
    if (action === 'session' && req.method === 'POST') {
      const data = await startSession(req, res);
      if (req.body?.initData) {
        try { data.telegramLinked = await linkTelegram(data.profile.id, req.body.initData); }
        catch { data.telegramLinked = false; }
      }
      res.status(200).json(data);
      waitUntil(processNotifications(data.profile.id,'delete'));
      return;
    }
    const userID = await currentUser(req);
    if (action === 'telegram' && req.method === 'POST') {
      res.status(200).json({ linked: await linkTelegram(userID,req.body?.initData) });
    } else if (action === 'typing' && req.method === 'POST') {
      if (typeof req.body?.typing !== 'boolean') throw new ChatError(400, 'invalid_chat_request');
      await rpc('chat_set_typing', { p_user_id: userID, p_conversation_id: uuid(req.body?.conversationID), p_typing: req.body.typing });
      res.status(200).json({ ok: true });
    } else if (action === 'profile' && req.method === 'GET') {
      res.status(200).json({ profile: await readPeerProfile(userID, uuid(req.query.conversationID)) });
    } else if (action === 'conversation' && req.method === 'GET') {
      res.status(200).json({ conversation: await rpc('chat_get_conversation', { p_user_id:userID,p_conversation_id:uuid(req.query.conversationID) }) });
    } else if (action === 'read' && req.method === 'POST') {
      const through = req.body?.throughID;
      if (typeof through!=='string' || !/^[1-9]\d{0,18}$/.test(through) || BigInt(through)>9223372036854775807n) throw new ChatError(400,'invalid_chat_request');
      await rpc('chat_mark_read', { p_user_id:userID,p_conversation_id:uuid(req.body?.conversationID),p_through_id:through });
      res.status(200).json({ ok:true });
      waitUntil(processNotifications(userID,'delete'));
    } else if (action === 'inbox' && req.method === 'GET') {
      res.status(200).json({ conversations: await rpc('chat_inbox', { p_user_id: userID }) });
      waitUntil(processNotifications(userID,'send'));
    } else if (action === 'users' && req.method === 'GET') {
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (query.length < 2 || query.length > 60) throw new ChatError(400, 'chat_search_length');
      res.status(200).json({ users: await rpc('chat_find_users', { p_user_id: userID, p_query: query }) });
    } else if (action === 'conversations' && req.method === 'POST') {
      res.status(200).json({ conversation: await rpc('chat_open_conversation', { p_user_id: userID, p_peer_id: uuid(req.body?.peerID) }) });
    } else if (action === 'messages' && req.method === 'GET') {
      const before = req.query.before;
      const after = req.query.after;
      for (const cursor of [before, after]) {
        if (cursor !== undefined && (typeof cursor !== 'string' || !/^[1-9]\d{0,18}$/.test(cursor) || BigInt(cursor) > 9223372036854775807n)) throw new ChatError(400, 'invalid_chat_request');
      }
      if (before && after) throw new ChatError(400, 'invalid_chat_request');
      const conversationID = uuid(req.query.conversationID);
      const [messages, peerTyping] = await Promise.all([
        rpc('chat_read_messages', {
          p_user_id: userID, p_conversation_id: conversationID, p_before: before || null, p_after: after || null,
        }),
        rpc('chat_peer_typing', { p_user_id: userID, p_conversation_id: conversationID }).catch(() => false),
      ]);
      res.status(200).json({ ...messages, peerTyping: peerTyping === true });
      waitUntil(processNotifications(userID,'delete'));
    } else if (action === 'messages' && req.method === 'POST') {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text || text.length > 2000) throw new ChatError(400, 'chat_message_length');
      res.status(200).json({ message: await rpc('chat_send_message', {
        p_user_id: userID, p_conversation_id: uuid(req.body?.conversationID),
        p_body: text, p_client_id: uuid(req.body?.clientID),
      }) });
      waitUntil(processNotifications(userID,'send'));
    } else throw new ChatError(404, 'chat_action_not_found');
  } catch (error) {
    if (error instanceof ChatError) res.status(error.status).json({ error: error.code });
    else res.status(500).json({ error: 'chat_unavailable' });
  }
}
