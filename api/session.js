import {readWebSession,sameOrigin,setWebSession,sealSession} from './_lib/security.js';
import {readDeviceSession,deviceChallenge,verifyDeviceProof} from './_lib/device-session.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, private');res.setHeader('Vary','Cookie');
  if(!sameOrigin(req)){res.status(403).json({error:'forbidden'});return;}
  if(req.method==='DELETE'){
    setWebSession(req,res,'');res.status(200).json({ok:true});return;
  }
  if(req.method==='POST'){
    const {deviceSession,action,challenge,signature}=req.body || {};
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
    setWebSession(req,res,sealSession(payload.session,now,true,payload.expires),true,payload.expires);
    res.status(200).json({ok:true});return;
  }
  if(req.method!=='GET'){res.setHeader('Allow','GET, POST, DELETE');res.status(405).json({error:'method_not_allowed'});return;}
  if(!readWebSession(req)){res.status(401).json({error:'session_expired'});return;}
  res.status(200).json({ok:true});
}
