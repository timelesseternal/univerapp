import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

export const SESSION_COOKIE='unilink_session';
export const SESSION_SECONDS=8*60*60;
export const REMEMBER_SECONDS=30*24*60*60;
const aad=Buffer.from('unilink-session-v1');
export function sessionKey(){
  const value=process.env.UNILINK_SESSION_KEY;
  if(!/^[a-f0-9]{64}$/i.test(value || ''))throw new Error('security_not_configured');
  return Buffer.from(value,'hex');
}
export function sameOrigin(req){
  const headers=req.headers || {};
  if(headers['sec-fetch-site']==='cross-site')return false;
  if(!headers.origin)return true;
  try{
    const origin=new URL(headers.origin);
    return ['http:','https:'].includes(origin.protocol) && origin.host===headers.host;
  }catch{return false;}
}
export function validSession(value){
  return !!value && ['sid','token','cookie'].every(key=>typeof value[key]==='string'
    && value[key].length>0 && value[key].length<=4096 && !/[\r\n\0]/.test(value[key]));
}
export function sealSession(session,now=Date.now(),remember=false){
  if(!validSession(session))throw new Error('invalid_session');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',sessionKey(),iv);
  cipher.setAAD(aad);
  const duration=remember===true?REMEMBER_SECONDS:SESSION_SECONDS;
  const encrypted=Buffer.concat([cipher.update(JSON.stringify({session,remember:remember===true,expires:now+duration*1000}),'utf8'),cipher.final()]);
  const token=['v1',iv.toString('base64url'),encrypted.toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');
  if(token.length>3800)throw new Error('invalid_session');
  return token;
}
export function unsealSession(token,now=Date.now()){
  try{
    if(typeof token!=='string' || token.length>3800)return null;
    const [version,iv,text,tag,...rest]=token.split('.');
    if(version!=='v1'||rest.length||!iv||!text||!tag)return null;
    if(![iv,text,tag].every(part=>/^[A-Za-z0-9_-]+$/.test(part)))return null;
    const ivBytes=Buffer.from(iv,'base64url'),tagBytes=Buffer.from(tag,'base64url');
    if(ivBytes.length!==12||tagBytes.length!==16)return null;
    const decipher=createDecipheriv('aes-256-gcm',sessionKey(),ivBytes,{authTagLength:16});
    decipher.setAAD(aad);decipher.setAuthTag(tagBytes);
    const payload=JSON.parse(Buffer.concat([decipher.update(Buffer.from(text,'base64url')),decipher.final()]).toString('utf8'));
    return validSession(payload.session)&&Number.isFinite(payload.expires)&&payload.expires>now
      &&payload.expires<=now+(payload.remember===true?REMEMBER_SECONDS:SESSION_SECONDS)*1000 ? payload.session : null;
  }catch{return null;}
}
export function readWebSession(req){
  if(!sameOrigin(req))return null;
  const cookie=String(req.headers?.cookie || '').split(';').map(part=>part.trim())
    .find(part=>part.startsWith(SESSION_COOKIE+'='));
  return unsealSession(cookie?.slice(SESSION_COOKIE.length+1));
}
export function setWebSession(req,res,token,remember=false){
  const secure=process.env.VERCEL || process.env.NODE_ENV==='production' || req.headers?.['x-forwarded-proto']==='https';
  res.setHeader('Set-Cookie',`${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict${secure?'; Secure':''}${!token?'; Max-Age=0':remember?`; Max-Age=${REMEMBER_SECONDS}`:''}`);
}
