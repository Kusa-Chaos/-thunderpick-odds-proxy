import fs from 'node:fs/promises';
const key=(process.env.OWLS_API_KEY||'').replace(/\s+/g,'');
const routes=[
 '/api/v1/soccer/odds',
 '/api/v1/soccer/moneyline',
 '/api/v1/soccer/events',
 '/api/v1/soccer/realtime',
 '/api/v1/soccer/ps3838-realtime',
 '/api/v1/1xbet/soccer',
 '/api/v2/stake/soccer',
 '/api/v2/bet365/soccer',
 '/api/v2/betonline/soccer',
 '/api/v2/betonline/soccer/leagues',
 '/api/v2/draftkings/soccer/leagues',
 '/api/v2/fanduel/soccer/leagues',
 '/api/v2/thunderpick/soccer',
 '/api/v2/thunderpick/football',
 '/api/v2/thunderpick/soccer/events',
 '/api/v2/thunderpick/football/events'
];
const out={generatedAt:new Date().toISOString(),probes:{}};
function summarize(b){
 const data=Array.isArray(b)?b:(b?.data??b?.events??b?.leagues??null);
 const count=Array.isArray(data)?data.length:(data&&typeof data==='object'?Object.keys(data).length:null);
 return {count,keys:b&&typeof b==='object'?Object.keys(b).slice(0,20):[],preview:JSON.stringify(b).slice(0,4000)};
}
for(const route of routes){
 try{
  const r=await fetch('https://api.owlsinsight.com'+route,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
  const t=await r.text(); let b; try{b=JSON.parse(t)}catch{b={raw:t}};
  out.probes[route]={status:r.status,ok:r.ok,...summarize(b)};
 }catch(e){out.probes[route]={status:null,ok:false,error:String(e?.message||e)}}
 await new Promise(x=>setTimeout(x,3500));
}
await fs.mkdir('data',{recursive:true});
await fs.writeFile('data/owls-extra-probe.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
