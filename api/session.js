import {readWebSession,sameOrigin,setWebSession,sealSession} from './_lib/security.js';
import {readDeviceSession,deviceChallenge,verifyDeviceProof,sealDeviceSession} from './_lib/device-session.js';
import {loginToPlatonus} from './_lib/platonus-login.js';
import {loginLimit} from './_lib/login-limit.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, private');res.setHeader('Vary','Cookie');
  if(!sameOrigin(req)){res.status(403).json({error:'forbidden'});return;}
  if(req.method==='DELETE'){
    setWebSession(req,res,'');res.status(200).json({ok:true});return;
  }
  if(req.method==='POST'){
    const {deviceSession,action,challenge,signature,refresh}=req.body || {};
    if(!['challenge','restore'].includes(action)){res.status(400).json({error:'invalid_action'});return;}
    const now=Date.now(),host=req.headers?.host;
    const payload=readDeviceSession(deviceSession,host,now);
    if(!payload){res.status(401).json({error:'session_expired'});return;}
    if(action==='challenge'){
      res.status(200).json({ok:true,challenge:deviceChallenge(deviceSession,host,now)});return;
    }
    if(!verifyDeviceProof(deviceSession,host,payload,challenge,signature,now)){
      res.status(401).json({error:'invalid_device_proof'});return;
    }
    let renewed;
    if(refresh===true){
      if(!payload.credentials){res.status(401).json({error:'reauthentication_required'});return;}
      try{
        const limit=await loginLimit(req,payload.credentials.login);
        if(limit?.allowed!==true){
          res.setHeader('Retry-After',String(limit?.retryAfter || 600));
          res.status(429).json({error:'login_rate_limit'});return;
        }
      }catch{res.status(503).json({error:'security_not_configured'});return;}
      try{
        const result=await loginToPlatonus(payload.credentials.login,payload.credentials.password);
        payload.session=result.session;
        renewed=sealDeviceSession(payload.session,payload.publicKey,host,Date.now(),
          {credentials:payload.credentials,expires:payload.expires});
      }catch(error){res.status(error.status || 502).json({error:error.status?error.message:'platonus_unreachable'});return;}
    }
    setWebSession(req,res,sealSession(payload.session,Date.now(),true,payload.expires),true,payload.expires);
    res.status(200).json({ok:true,...(renewed?{deviceSession:renewed}:{})});return;
  }
  if(req.method!=='GET'){res.setHeader('Allow','GET, POST, DELETE');res.status(405).json({error:'method_not_allowed'});return;}
  if(!readWebSession(req)){res.status(401).json({error:'session_expired'});return;}
  res.status(200).json({ok:true});
}
