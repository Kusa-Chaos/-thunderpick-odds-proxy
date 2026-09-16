import fs from 'node:fs/promises';
const key=(process.env.OWLS_API_KEY||'').replace(/\s+/g,'');
const routes=[
 '/api/v2/thunderpick/soccer',
 '/api/v2/thunderpick/football',
 '/api/v2/thunderpick/soccer/events',
 '/api/v2/thunderpick/football/events'
];
const out={generatedAt:new Date().toISOString(),probes:{}};
function summarize(b){
 const data=Array.isArray(b)?b:(b?.data??b?.events??null);
 const count=Array.isArray(data)?data.length:(data&&typeof data==='object'?Object.keys(data).length:null);
 return {count,keys:b&&typeof b==='object'?Object.keys(b).slice(0,20):[],preview:JSON.stringify(b).slice(0,2500)};
}
for(const route of routes){
 try{
  const r=await fetch('https://api.owlsinsight.com'+route,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
  const t=await r.text(); let b; try{b=JSON.parse(t)}catch{b={raw:t}};
  out.probes[route]={status:r.status,ok:r.ok,...summarize(b)};
 }catch(e){out.probes[route]={status:null,ok:false,error:String(e?.message||e)}}
 await new Promise(x=>setTimeout(x,3300));
}
await fs.mkdir('data',{recursive:true});
await fs.writeFile('data/owls-extra-probe.json',JSON.stringify(out,null,2));
