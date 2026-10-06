import { createHmac, timingSafeEqual } from 'node:crypto';
import { rpc, ChatError } from './chat.js';

export function verifyTelegram(raw, token, now = Date.now()) {
  if (typeof raw !== 'string' || raw.length > 16000 || !token) throw new ChatError(401, 'invalid_telegram_identity');
  const params = new URLSearchParams(raw);
  if ([...params.keys()].some((key, i, keys) => keys.indexOf(key) !== i)) throw new ChatError(401, 'invalid_telegram_identity');
  const hash = params.get('hash');
  if (!/^[a-f0-9]{64}$/i.test(hash || '')) throw new ChatError(401, 'invalid_telegram_identity');
  params.delete('hash');
  const check = [...params.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash,'hex'))) throw new ChatError(401,'invalid_telegram_identity');
  const date = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(date) || date > now/1000+60 || date < now/1000-86400) throw new ChatError(401,'expired_telegram_identity');
  let user;
  try { user = JSON.parse(params.get('user')); } catch { /* Rejected below. */ }
  if (!Number.isSafeInteger(user?.id) || user.id<=0 || user.is_bot) throw new ChatError(401,'invalid_telegram_identity');
  return user.id;
}
export async function linkTelegram(userID, raw) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !raw) return false;
  const telegramID = verifyTelegram(raw, process.env.TELEGRAM_BOT_TOKEN);
  return rpc('chat_link_telegram', { p_user_id:userID, p_telegram_id:telegramID });
}
export function appLink(conversationID) {
  const username = (process.env.TELEGRAM_BOT_USERNAME || 'kstuds_bot').replace(/^@/,'');
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) throw new Error('invalid_bot_username');
  const shortName = process.env.TELEGRAM_APP_SHORT_NAME || '';
  if (shortName && !/^[a-zA-Z0-9_]+$/.test(shortName)) throw new Error('invalid_app_short_name');
  return `https://t.me/${username}${shortName ? '/'+shortName : ''}?startapp=chat_${conversationID}`;
}
async function telegram(method, body) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000),
    });
  } catch { throw Object.assign(new Error('telegram_unavailable'), { code:503 }); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw Object.assign(new Error('telegram_request_failed'), { code:data.error_code || response.status, description:data.description || '' });
  return data.result;
}
const finish = (job,outcome,id=null) => rpc('chat_finish_notification', {
  p_message_id:job.id,p_lease:job.lease,p_outcome:outcome,p_telegram_message_id:id,
});
async function removeNotification(job) {
  if (job.sentAt && Date.now()-Date.parse(job.sentAt)>=48*3600000) {
    // Telegram cannot delete old notifications; leave a terminal state, not an endless retry.
    await finish(job,'failed'); return;
  }
  try {
    await telegram('deleteMessage', { chat_id:job.telegramID,message_id:job.telegramMessageID });
    await finish(job,'deleted');
  } catch (error) {
    if (error.code===400 && /message to delete not found/i.test(error.description)) await finish(job,'deleted');
    else await finish(job,[400,403].includes(error.code) ? 'failed' : 'retry');
  }
}
export async function processNotifications(userID, mode) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  // Failures must not turn a successfully saved/read chat message into an API error.
  try {
    const jobs = await rpc('chat_claim_notifications', { p_user_id:userID,p_mode:mode });
    await Promise.allSettled(jobs.map(async job => {
      if (mode==='delete') return removeNotification(job);
      try {
        const sent = await telegram('sendMessage', {
          chat_id:job.telegramID, text:`${job.name}\n\n${job.text}`,
          link_preview_options:{is_disabled:true},
          reply_markup:{inline_keyboard:[[{text:'Открыть чат',url:appLink(job.conversationID)}]]},
        });
        const read = await finish(job,'sent',sent.message_id);
        // Read can race with Telegram delivery: delete immediately in that case.
        if (read) await removeNotification({...job,telegramMessageID:sent.message_id,sentAt:new Date().toISOString()});
      } catch (error) { await finish(job,[400,403].includes(error.code) ? 'failed' : 'retry'); }
    }));
  } catch { /* Durable rows are retried by later sends/reads; never log bot tokens. */ }
}
