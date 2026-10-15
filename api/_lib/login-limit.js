import {createHmac} from 'node:crypto';
import {rpc} from './chat.js';
import {sessionKey} from './security.js';
export async function loginLimit(req,login){
  const ip=String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0,128);
  const hash=value=>createHmac('sha256',sessionKey()).update(value).digest('hex');
  return rpc('security_login_attempt',{p_ip_key:hash('ip:'+ip),p_account_key:hash('account:'+login.trim().toLowerCase())});
}
