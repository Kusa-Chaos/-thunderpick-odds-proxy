import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const API_KEY=(process.env.OWLS_API_KEY||'').replace(/\s+/g,'');
if(!API_KEY) throw new Error('OWLS_API_KEY missing');
const SPORTS=['cs2','dota2','lol','valorant'];
const base='https://api.owlsinsight.com/api/v1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
let previous=null; try{previous=JSON.parse(await fs.readFile('data/owls-comparison-latest.json','utf8'));}catch{}
const sports={}; const failures=[];
for(const sport of SPORTS){
  console.log(`Fetching outside ${sport} board...`);
  try{
    const r=await fetch(`${base}/${sport}/odds`,{headers:{Authorization:`Bearer ${API_KEY}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
    const text=await r.text(); let body; try{body=JSON.parse(text)}catch{body={raw:text}};
    const h=hash(body);
    sports[sport]={ok:r.ok,status:r.status,fetchedAt:new Date().toISOString(),hash:h,changedSincePrevious:previous?.sports?.[sport]?.hash!==h,meta:body?.meta??null,data:body?.data??null};
    if(!r.ok) failures.push({sport,status:r.status,body});
  }catch(e){sports[sport]={ok:false,status:null,fetchedAt:new Date().toISOString(),error:String(e?.message||e),data:null};failures.push({sport,error:String(e?.message||e)});}
  await sleep(3300);
}
await fs.mkdir('data',{recursive:true});
await fs.writeFile('data/owls-comparison-latest.json',JSON.stringify({generatedAt:new Date().toISOString(),source:'Owls v1 normalized esports odds',requestCountThisRun:SPORTS.length,failedSports:failures,sports},null,2));
if(failures.length) process.exitCode=1;
