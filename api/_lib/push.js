import webpush from 'web-push';
import {createCipheriv,createDecipheriv,randomBytes,ECDH,createHash} from 'node:crypto';
import {ChatError,database,rpc} from './chat.js';

const subject='https://univerapp.vercel.app';
let keyCache=null;
function storageKey() {
  const key=process.env.UNILINK_SESSION_KEY;
  if(!/^[a-f0-9]{64}$/i.test(key||'')) throw new ChatError(503,'push_not_configured');
  return Buffer.from(key,'hex');
}
export function encryptPushKey(value) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',storageKey(),iv);
  cipher.setAAD(Buffer.from('unilink-push-v1'));
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function decryptPushKey(value) {
  const data=Buffer.from(value,'base64url'),cipher=createDecipheriv('aes-256-gcm',storageKey(),data.subarray(0,12));
  cipher.setAAD(Buffer.from('unilink-push-v1'));cipher.setAuthTag(data.subarray(12,28));
  return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8');
}
export async function pushKeys() {
  const keyID=createHash('sha256').update(storageKey()).update(process.env.SUPABASE_URL||'').digest('hex');
  if(keyCache?.keyID===keyID && keyCache.until>Date.now()) return keyCache.keys;
  let rows=await database('chat_push_keyring?select=public_key,private_encrypted&id=eq.true',{method:'GET'});
  if(!rows?.length) {
    const pair=webpush.generateVAPIDKeys();
    await database('chat_push_keyring?on_conflict=id',{body:{id:true,public_key:pair.publicKey,private_encrypted:encryptPushKey(pair.privateKey)},prefer:'resolution=ignore-duplicates,return=representation'});
    rows=await database('chat_push_keyring?select=public_key,private_encrypted&id=eq.true',{method:'GET'});
  }
  if(!rows?.[0]) throw new ChatError(503,'push_not_configured');
  const keys={subject,publicKey:rows[0].public_key,privateKey:decryptPushKey(rows[0].private_encrypted)};
  keyCache={keys,keyID,until:Date.now()+300000};return keys;
}
export function pushEndpoint(value) {
  if(typeof value!=='string' || value.length>4096) throw new ChatError(400,'invalid_push_subscription');
  let url;try{url=new URL(value);}catch{throw new ChatError(400,'invalid_push_subscription');}
  const host=url.hostname.toLowerCase();
  const allowed=['fcm.googleapis.com','web.push.apple.com','updates.push.services.mozilla.com'].includes(host)
    || host.endsWith('.notify.windows.com');
  if(!allowed || url.protocol!=='https:' || url.username || url.password || url.port || url.hash) throw new ChatError(400,'invalid_push_subscription');
  return url.href;
}
export function pushSubscription(value) {
  const endpoint=pushEndpoint(value?.endpoint),auth=value?.keys?.auth,p256dh=value?.keys?.p256dh;
  if(typeof auth!=='string' || !/^[\w-]{22}$/.test(auth) || Buffer.from(auth,'base64url').length!==16
    || typeof p256dh!=='string' || !/^[\w-]{87}$/.test(p256dh)) throw new ChatError(400,'invalid_push_subscription');
  try {const key=Buffer.from(p256dh,'base64url');if(key.length!==65 || key[0]!==4)throw new Error();ECDH.convertKey(key,'prime256v1');}
  catch {throw new ChatError(400,'invalid_push_subscription');}
  return {endpoint,keys:{auth,p256dh}};
}

async function activePushSubscriptions(jobs) {
  try {
    const ids=[...new Set(jobs.map(job=>job.subscriptionID))];
    if(!ids.every(id=>typeof id==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)))return new Set();
    const subscriptions=await database(`chat_push_subscriptions?select=id,user_id,session_hash&id=in.(${ids.join(',')})`,{method:'GET',timeoutMs:2000});
    if(!Array.isArray(subscriptions))return new Set();
    const owned=subscriptions.filter(row=>/^[a-f0-9]{64}$/.test(row.session_hash||'')
      && jobs.some(job=>job.subscriptionID===row.id && job.owner===row.user_id));
    const hashes=[...new Set(owned.map(row=>row.session_hash))];
    if(!hashes.length)return new Set();
    const presence=await database(`chat_presence?select=token_hash&token_hash=in.(${hashes.join(',')})&online_until=gt.${encodeURIComponent(new Date().toISOString())}`,{method:'GET',timeoutMs:2000});
    if(!Array.isArray(presence))return new Set();
    const active=new Set(presence.map(row=>row.token_hash));
    return new Set(owned.filter(row=>active.has(row.session_hash)).map(row=>row.id));
  } catch { return new Set(); } // A missing presence migration or network failure must not lose a background notification.
}

export async function processPushNotifications(senderID,{send=webpush.sendNotification.bind(webpush),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  try {
    let keys;
    for(let batch=0;batch<2;batch++) {
      const jobs=await rpc('chat_claim_push',{p_sender_id:senderID});
      if(!Array.isArray(jobs) || !jobs.length) return;
      const active=await activePushSubscriptions(jobs);
      if(jobs.some(job=>!active.has(job.subscriptionID)))keys ||= await pushKeys();
      await Promise.allSettled(jobs.map(async job=>{
        if(active.has(job.subscriptionID)) {
          // Suppress before contacting the provider. Silently dropping a received push
          // in the service worker can revoke Safari's userVisibleOnly subscription.
          await database(`chat_push_jobs?message_id=eq.${job.messageID}&subscription_id=eq.${job.subscriptionID}&lease=eq.${job.lease}&state=eq.sending`,
            {method:'PATCH',body:{state:'suppressed',leased_until:null}});
          return;
        }
        let state='queued';
        for(let attempt=0;attempt<2;attempt++) {
          try {
            await send(pushSubscription(job.subscription),JSON.stringify({kind:'chat',owner:job.owner,conversationID:job.conversationID,
              messageID:job.messageID,title:job.name,body:job.text}),{vapidDetails:keys,TTL:86400,urgency:'high',timeout:4000,
              topic:createHash('sha256').update(job.conversationID).digest('base64url').slice(0,32)});
            state='sent';break;
          } catch(error) {
            if([404,410].includes(error.statusCode)) {
              await database(`chat_push_subscriptions?id=eq.${job.subscriptionID}`,{method:'DELETE'});return;
            }
            if(error.statusCode===429) {
              const seconds=Math.min(3600,Math.max(60,Number(error.headers?.['retry-after'])||60));
              await database(`chat_push_jobs?message_id=eq.${job.messageID}&subscription_id=eq.${job.subscriptionID}&lease=eq.${job.lease}&state=eq.sending`,
                {method:'PATCH',body:{leased_until:new Date(Date.now()+seconds*1000).toISOString()}});
              return;
            }
            if(error instanceof ChatError || (error.statusCode>=400 && error.statusCode<500 && error.statusCode!==429)) {state='failed';break;}
            if(!attempt) await sleep(500);
          }
        }
        await rpc('chat_finish_push',{p_message_id:job.messageID,p_subscription_id:job.subscriptionID,p_lease:job.lease,p_state:state});
      }));
      if(jobs.length<8) return;
    }
  } catch { /* Optional migration/provider failures never undo an accepted message. */ }
}
