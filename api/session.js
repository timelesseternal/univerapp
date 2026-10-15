import {readWebSession,sameOrigin,setWebSession} from './_lib/security.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, private');res.setHeader('Vary','Cookie');
  if(!sameOrigin(req)){res.status(403).json({error:'forbidden'});return;}
  if(req.method==='DELETE'){
    setWebSession(req,res,'');res.status(200).json({ok:true});return;
  }
  if(req.method!=='GET'){res.setHeader('Allow','GET, DELETE');res.status(405).json({error:'method_not_allowed'});return;}
  if(!readWebSession(req)){res.status(401).json({error:'session_expired'});return;}
  res.status(200).json({ok:true});
}
