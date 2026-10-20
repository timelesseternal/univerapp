// POST /api/login  { login, password, remember } -> { ok, blockMinutesRemaining } + HttpOnly cookie
//
// Remembered device envelopes may carry encrypted renewal credentials.
// Neither passwords nor upstream tokens are returned in readable form.

import {sameOrigin,sessionKey,sealSession,setWebSession} from './_lib/security.js';
import {loginLimit} from './_lib/login-limit.js';
import {loginToPlatonus} from './_lib/platonus-login.js';
import {devicePublicKey,sealDeviceSession} from './_lib/device-session.js';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow','POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if(!sameOrigin(req)){res.status(403).json({error:'forbidden'});return;}

  const { login, password } = req.body || {};
  if (typeof login !== 'string' || !login.trim() || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'missing_credentials' });
    return;
  }
  if(login.length>160 || password.length>1024){res.status(400).json({error:'missing_credentials'});return;}
  let publicKey;
  if(req.body.remember===true && req.body.devicePublicKey){
    try{publicKey=devicePublicKey(req.body.devicePublicKey);}catch{res.status(400).json({error:'invalid_device_key'});return;}
  }
  try{
    sessionKey();
    const limit=await loginLimit(req,login);
    if(limit?.allowed!==true){
      res.setHeader('Retry-After',String(limit?.retryAfter || 600));res.status(429).json({error:'login_rate_limit'});return;
    }
  }catch{res.status(503).json({error:'security_not_configured'});return;}

  let session, blockMinutesRemaining;
  try {
    ({session,blockMinutesRemaining}=await loginToPlatonus(login,password));
  } catch (error) {
    res.status(error.status || 502).json({error:error.status ? error.message : 'platonus_unreachable'});
    return;
  }
  let sessionToken,deviceSession;
  try{
    const issuedAt=Date.now();
    sessionToken=sealSession(session,issuedAt,req.body.remember===true);
    if(publicKey)deviceSession=sealDeviceSession(session,publicKey,req.headers?.host,issuedAt,{credentials:{login,password}});
  }catch{res.status(502).json({error:'platonus_bad_response'});return;}
  setWebSession(req,res,sessionToken,req.body.remember===true);

  res.status(200).json({
    ok: true,
    ...(deviceSession?{deviceSession}:{}),
    blockMinutesRemaining,
  });
}
