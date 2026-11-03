import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildRelease} from './build-release.mjs';

const appURL='https://univerapp.vercel.app';
export function announcementText(version,notes) {
  if (!/^[a-f0-9]{64}$/.test(version) || !Array.isArray(notes?.changes) || !notes.changes.length
    || notes.changes.length>10 || notes.changes.some(line=>typeof line!=='string' || !line.trim() || line.length>300)) throw new Error('invalid_release_notes');
  return `🚀 Что нового в UniLink\n\n${notes.changes.map(line=>`• ${line.trim()}`).join('\n')}\n\nВерсия ${version.slice(0,8)}`;
}
export async function announceRelease({env=process.env,version,notes,fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  const {SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:key,TELEGRAM_BOT_TOKEN:token}=env;
  if (!url || !key || !token) return {skipped:'Configure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and TELEGRAM_BOT_TOKEN in GitHub Actions secrets'};
  if (new URL(url).protocol!=='https:') throw new Error('invalid_database_url');
  const text=announcementText(version,notes);
  async function json(target,options={}) {
    let response;
    try { response=await fetchImpl(target,{...options,signal:AbortSignal.timeout(15000)}); }
    catch { throw new Error('release_request_unavailable'); } // Never log credential-bearing URLs.
    const data=await response.json().catch(()=>null);
    return {ok:response.ok,status:response.status,data};
  }
  const live=await json(`${appURL}/version.json?announcement=${version}`,{cache:'no-store'});
  if (!live.ok || live.data?.version!==version) return {skipped:'This release is not the current production version'};
  const headers={apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}), 'Content-Type':'application/json'};
  async function database(path,method='GET',body,prefer='return=representation') {
    const result=await json(`${url.replace(/\/$/,'')}/rest/v1/${path}`,{method,headers:{...headers,Prefer:prefer},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if (!result.ok) throw new Error('release_database_unavailable_check_migration_009');
    return result.data;
  }
  const totals={sent:0,skipped:0,failed:0,uncertain:0},seen=new Set();
  for(let offset=0;;offset+=500) {
    const recipients=await database(`chat_telegram_links?select=telegram_id&order=user_id&limit=500&offset=${offset}`);
    if (!Array.isArray(recipients)) throw new Error('invalid_release_recipients');
    for(const recipient of recipients) {
      const id=String(recipient.telegram_id);
      if (!/^[1-9]\d{0,18}$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      const claim=await database('chat_release_deliveries?on_conflict=release_id,telegram_id','POST',
        {release_id:version,telegram_id:id,state:'sending'},'resolution=ignore-duplicates,return=representation');
      if (!Array.isArray(claim)) throw new Error('invalid_release_claim');
      if (!claim.length) { totals.skipped++; continue; }
      let outcome='uncertain';
      try {
        for(let attempt=0;attempt<5;attempt++) {
          const sent=await json(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
            chat_id:id,text,link_preview_options:{is_disabled:true},
            reply_markup:{inline_keyboard:[[{text:'Открыть UniLink',url:appURL}]]},
          })});
          if (sent.ok && sent.data?.ok) { outcome='sent'; break; }
          if (sent.status===429 || sent.data?.error_code===429) {
            outcome='failed'; await sleep(Math.min(60,Math.max(1,Number(sent.data?.parameters?.retry_after)||1))*1000); continue;
          }
          outcome=sent.status>=500 ? 'uncertain' : 'failed'; break;
        }
      } catch { outcome='uncertain'; }
      await database(`chat_release_deliveries?release_id=eq.${version}&telegram_id=eq.${id}`,'PATCH',
        {state:outcome,updated_at:new Date().toISOString()});
      totals[outcome]++;
      await sleep(60); // Leave headroom for personal-message notifications; also respect 429.
    }
    if(recipients.length<500) break;
  }
  return totals;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const configured=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','TELEGRAM_BOT_TOKEN'].every(key=>process.env[key]);
    const root=fileURLToPath(new URL('../',import.meta.url));
    const result=await announceRelease({version:configured?buildRelease(root):'',notes:configured?JSON.parse(readFileSync(resolve(root,'release-notes.json'),'utf8')):null});
    if(result.skipped) console.log(`::warning::${result.skipped}`);
    else console.log(`Release announcement: sent=${result.sent}, skipped=${result.skipped}, failed=${result.failed}, uncertain=${result.uncertain}`);
    if(result.uncertain) process.exitCode=1;
  } catch { console.error('Release announcement failed. Check configuration, migration 009 and network availability.');process.exitCode=1; }
}
