import { ChatError, checkOrigin, configuration, currentUser, database, readPeerProfile, readToken, rpc, setCookie, startSession, tokenHash, uuid } from './_lib/chat.js';
import { waitUntil } from '@vercel/functions';
import { linkTelegram, processNotifications } from './_lib/telegram.js';
import {pushKeys,pushEndpoint,pushSubscription,processPushNotifications} from './_lib/push.js';
import webpush from 'web-push';

function messageID(value, optional = false) {
  if (optional && value == null) return null;
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n)
    throw new ChatError(400, 'invalid_chat_request');
  return value;
}

async function readMessages(userID, conversationID, before, after, revision) {
  const params = { p_user_id:userID, p_conversation_id:conversationID, p_before:before || null, p_after:after || null };
  try { return { ...await rpc('chat_read_messages_v3', {...params,p_revision:revision}), actionsAvailable:true }; }
  catch (error) {
    if (!(error instanceof ChatError) || error.code !== 'chat_setup_required') throw error;
    try { return { ...await rpc('chat_read_messages_v2',{...params,p_revision:revision}),actionsAvailable:true,deleteScopes:false }; }
    catch (older) {
      if (!(older instanceof ChatError) || older.code !== 'chat_setup_required') throw older;
      return { ...await rpc('chat_read_messages',params), actionsAvailable:false };
    }
  }
}

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
        finally {try {await database(`chat_push_subscriptions?session_hash=eq.${tokenHash(token)}`,{method:'DELETE'});}catch { /* Device-side logout also revokes the subscription. */ }}
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
    if (action === 'session' && req.method === 'GET') {
      const people = await database(`chat_profiles?select=id,student_id,display_name&id=eq.${userID}&limit=1`, { method: 'GET' });
      const person = people?.[0];
      if (!person || Number(req.query.studentID) !== Number(person.student_id)) throw new ChatError(401, 'chat_session_expired');
      res.status(200).json({ profile: { id: person.id, name: person.display_name }, conversations: await rpc('chat_inbox', { p_user_id: userID }) });
    } else if (action === 'push-config' && req.method === 'GET') {
      const [keys,preferences]=await Promise.all([pushKeys(),database(`chat_notification_preferences?select=telegram_enabled&user_id=eq.${userID}`,{method:'GET'})]);
      res.status(200).json({publicKey:keys.publicKey,telegramEnabled:preferences?.[0]?.telegram_enabled!==false});
    } else if (action === 'push-status' && req.method === 'POST') {
      const endpoint=pushEndpoint(req.body?.endpoint);
      const active=await rpc('chat_touch_push',{p_user_id:userID,p_session_hash:tokenHash(readToken(req)),p_endpoint:endpoint});
      res.status(200).json({active:active===true});
    } else if (action === 'push-subscription' && req.method === 'POST') {
      const subscription=pushSubscription(req.body?.subscription);
      if(typeof req.body?.disableTelegram!=='boolean') throw new ChatError(400,'invalid_chat_request');
      await rpc('chat_save_push',{p_user_id:userID,p_session_hash:tokenHash(readToken(req)),p_endpoint:subscription.endpoint,
        p_p256dh:subscription.keys.p256dh,p_auth:subscription.keys.auth,p_disable_telegram:req.body.disableTelegram});
      res.status(200).json({ok:true});
    } else if (action === 'push-test' && req.method === 'POST') {
      const endpoint=pushEndpoint(req.body?.endpoint);
      const rows=await database(`chat_push_subscriptions?user_id=eq.${userID}&endpoint=eq.${encodeURIComponent(endpoint)}&last_test_at=lt.${encodeURIComponent(new Date(Date.now()-60000).toISOString())}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
        {method:'PATCH',body:{last_test_at:new Date().toISOString()}});
      if(!rows?.[0]) throw new ChatError(429,'push_test_unavailable');
      const subscription=pushSubscription({endpoint:rows[0].endpoint,keys:{auth:rows[0].auth,p256dh:rows[0].p256dh}});
      try {await webpush.sendNotification(subscription,JSON.stringify({kind:'test',owner:userID,title:'uniq.',body:'Уведомления включены. Здесь будут появляться новые сообщения.'}),{vapidDetails:await pushKeys(),TTL:300,timeout:5000});}
      catch {throw new ChatError(503,'push_unavailable');}
      res.status(200).json({ok:true});
    } else if (action === 'push-subscription' && req.method === 'DELETE') {
      const endpoint=pushEndpoint(req.body?.endpoint);
      await database(`chat_push_subscriptions?user_id=eq.${userID}&endpoint=eq.${encodeURIComponent(endpoint)}`,{method:'DELETE'});
      res.status(200).json({ok:true});
    } else if (action === 'notification-preferences' && req.method === 'POST') {
      if(typeof req.body?.telegramEnabled!=='boolean') throw new ChatError(400,'invalid_chat_request');
      await database('chat_notification_preferences?on_conflict=user_id',{body:{user_id:userID,telegram_enabled:req.body.telegramEnabled},prefer:'resolution=merge-duplicates,return=representation'});
      if(!req.body.telegramEnabled) await database(`chat_notifications?recipient_id=eq.${userID}&state=eq.queued`,{method:'PATCH',body:{state:'suppressed'}});
      res.status(200).json({ok:true});
    } else if (action === 'telegram' && req.method === 'POST') {
      res.status(200).json({ linked: await linkTelegram(userID,req.body?.initData) });
    } else if (action === 'presence' && req.method === 'POST') {
      if (typeof req.body?.active !== 'boolean') throw new ChatError(400, 'invalid_chat_request');
      const clientID = uuid(req.body?.clientID);
      const sequence = req.body?.sequence;
      if (!Number.isInteger(sequence) || sequence < 1 || sequence > 2147483647) throw new ChatError(400, 'invalid_chat_request');
      const token = readToken(req);
      await rpc('chat_touch_presence', { p_user_id:userID, p_token_hash:tokenHash(token), p_client_id:clientID, p_active:req.body.active, p_sequence:sequence });
      res.status(200).json({ ok:true });
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
      waitUntil(processPushNotifications(userID));
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
      const revision = req.query.revision === undefined || req.query.revision === '0' ? '0' : messageID(req.query.revision);
      const [messages, peerTyping, peerPresence] = await Promise.all([
        readMessages(userID, conversationID, before, after, revision),
        rpc('chat_peer_typing', { p_user_id: userID, p_conversation_id: conversationID }, { timeoutMs: 600 }).catch(() => false),
        rpc('chat_peer_presence', { p_user_id:userID, p_conversation_id:conversationID }, { timeoutMs:600 }).catch(() => null),
      ]);
      res.status(200).json({ ...messages, peerTyping: peerTyping === true, peerPresence });
      waitUntil(processNotifications(userID,'delete'));
    } else if (action === 'messages' && req.method === 'DELETE') {
      const scope = req.body?.scope;
      if (scope !== undefined && !['self','everyone'].includes(scope)) throw new ChatError(400,'invalid_chat_request');
      const params = {p_user_id:userID,p_conversation_id:uuid(req.body?.conversationID),p_message_id:messageID(req.body?.messageID)};
      // Old clients keep their sender-only deletion semantics until refreshed.
      await rpc(scope ? 'chat_delete_message_v2' : 'chat_delete_message',scope ? {...params,p_scope:scope} : params);
      res.status(200).json({ok:true});
    } else if (action === 'messages' && req.method === 'POST') {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const replyTo = messageID(req.body?.replyTo, true), forwardID = messageID(req.body?.forwardID, true);
      if (replyTo && forwardID) throw new ChatError(400,'invalid_chat_request');
      if ((!text && !forwardID) || text.length > 2000) throw new ChatError(400, 'chat_message_length');
      const params = {
        p_user_id: userID, p_conversation_id: uuid(req.body?.conversationID),
        p_body: text, p_client_id: uuid(req.body?.clientID),
      };
      const details = {...params,p_reply_to:replyTo,p_forward_id:forwardID};
      let message;
      try { message = await rpc('chat_send_message_v3',details); }
      catch (error) {
        if (!(error instanceof ChatError) || error.code !== 'chat_setup_required') throw error;
        message = await rpc(replyTo || forwardID ? 'chat_send_message_v2' : 'chat_send_message',replyTo || forwardID ? details : params);
      }
      res.status(200).json({ message });
      waitUntil(processNotifications(userID,'send'));
      waitUntil(processPushNotifications(userID));
    } else throw new ChatError(404, 'chat_action_not_found');
  } catch (error) {
    if (error instanceof ChatError) res.status(error.status).json({ error: error.code });
    else res.status(500).json({ error: 'chat_unavailable' });
  }
}
