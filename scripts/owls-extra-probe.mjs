import fs from 'node:fs/promises';
const key=(process.env.OWLS_API_KEY||'').replace(/\s+/g,'');
const routes=['/api/v2/bookmaker/esports/leagues','/api/v2/fanaticsmarkets/cs2/leagues','/api/v2/fanaticsmarkets/lol/leagues','/api/v2/fanaticsmarkets/dota2/leagues','/api/v2/fanaticsmarkets/valorant/leagues'];
const out={generatedAt:new Date().toISOString(),probes:{}};
for(const route of routes){
 const r=await fetch('https://api.owlsinsight.com'+route,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 const t=await r.text(); let b; try{b=JSON.parse(t)}catch{b={raw:t}};
 out.probes[route]={status:r.status,ok:r.ok,leagues:b.leagues??null,meta:b.meta??null,error:r.ok?null:b};
 await new Promise(x=>setTimeout(x,3300));
}
await fs.mkdir('data',{recursive:true});
await fs.writeFile('data/owls-extra-probe.json',JSON.stringify(out,null,2));
