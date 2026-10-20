import {createCipheriv,createDecipheriv,createHash,createHmac,createPublicKey,randomBytes,timingSafeEqual,verify} from 'node:crypto';
import {sessionKey,validSession,REMEMBER_SECONDS} from './security.js';

const purpose='unilink-remembered-device-v1';
const CHALLENGE_SECONDS=60;
const base64url=/^[A-Za-z0-9_-]+$/;
const deviceKey=usage=>createHmac('sha256',sessionKey()).update(`${purpose}\n${usage}`).digest();

export function devicePublicKey(value){
  if(!value || value.kty!=='EC' || value.crv!=='P-256' || 'd' in value)throw new Error('invalid_device_key');
  for(const field of ['x','y']){
    if(typeof value[field]!=='string' || value[field].length!==43 || !base64url.test(value[field])
      || Buffer.from(value[field],'base64url').length!==32)throw new Error('invalid_device_key');
  }
  const jwk={kty:'EC',crv:'P-256',x:value.x,y:value.y};
  createPublicKey({key:jwk,format:'jwk'}); // Reject coordinates outside the curve.
  return jwk;
}

function aad(host){
  if(typeof host!=='string' || host.length>260 || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host))throw new Error('invalid_host');
  return Buffer.from(`${purpose}\n${host.toLowerCase()}`);
}

export function sealDeviceSession(session,publicKey,host,now=Date.now(),options={}){
  if(!validSession(session))throw new Error('invalid_session');
  const expires=options.expires ?? now+REMEMBER_SECONDS*1000;
  if(!Number.isFinite(expires) || expires<=now || expires>now+REMEMBER_SECONDS*1000)throw new Error('invalid_expiration');
  const credentials=options.credentials;
  if(credentials && (typeof credentials.login!=='string' || !credentials.login.trim() || credentials.login.length>160
    || typeof credentials.password!=='string' || !credentials.password || credentials.password.length>1024))throw new Error('invalid_credentials');
  const payload={session,publicKey:devicePublicKey(publicKey),expires,
    ...(credentials?{credentials:{login:credentials.login,password:credentials.password}}:{})};
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',deviceKey('encryption'),iv);
  cipher.setAAD(aad(host));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  const token=['d1',iv.toString('base64url'),encrypted.toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');
  if(token.length>6000)throw new Error('invalid_session');
  return token;
}

export function readDeviceSession(token,host,now=Date.now()){
  try{
    if(typeof token!=='string' || token.length>6000)return null;
    const [version,iv,text,tag,...rest]=token.split('.');
    if(version!=='d1' || rest.length || ![iv,text,tag].every(value=>typeof value==='string' && base64url.test(value)))return null;
    const ivBytes=Buffer.from(iv,'base64url'),tagBytes=Buffer.from(tag,'base64url');
    if(ivBytes.length!==12 || tagBytes.length!==16)return null;
    const decipher=createDecipheriv('aes-256-gcm',deviceKey('encryption'),ivBytes,{authTagLength:16});
    decipher.setAAD(aad(host));decipher.setAuthTag(tagBytes);
    const payload=JSON.parse(Buffer.concat([decipher.update(Buffer.from(text,'base64url')),decipher.final()]).toString('utf8'));
    if(!validSession(payload.session) || !Number.isFinite(payload.expires) || payload.expires<=now
      || payload.expires>now+REMEMBER_SECONDS*1000)return null;
    payload.publicKey=devicePublicKey(payload.publicKey);
    return payload;
  }catch{return null;}
}

function challengeMAC(token,host,value){
  return createHmac('sha256',deviceKey('challenge')).update(aad(host)).update('\n')
    .update(createHash('sha256').update(token).digest()).update('\n'+value).digest();
}
export function deviceChallenge(token,host,now=Date.now()){
  const value=`c1.${now+CHALLENGE_SECONDS*1000}.${randomBytes(32).toString('base64url')}`;
  return `${value}.${challengeMAC(token,host,value).toString('base64url')}`;
}
export function verifyDeviceProof(token,host,payload,challenge,signature,now=Date.now()){
  try{
    if(typeof challenge!=='string' || challenge.length>180 || typeof signature!=='string' || signature.length!==86 || !base64url.test(signature))return false;
    const [version,expiry,nonce,mac,...rest]=challenge.split('.');
    if(version!=='c1' || rest.length || !/^\d{13}$/.test(expiry) || !nonce || nonce.length!==43 || !base64url.test(nonce)
      || !mac || mac.length!==43 || !base64url.test(mac))return false;
    if(Number(expiry)<=now || Number(expiry)>now+CHALLENGE_SECONDS*1000)return false;
    const expected=challengeMAC(token,host,`${version}.${expiry}.${nonce}`),actual=Buffer.from(mac,'base64url');
    if(actual.length!==expected.length || !timingSafeEqual(actual,expected))return false;
    return verify('sha256',Buffer.from(`${purpose}\n${challenge}`),
      {key:createPublicKey({key:payload.publicKey,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url'));
  }catch{return false;}
}
