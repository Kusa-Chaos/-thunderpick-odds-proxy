import fs from 'node:fs/promises';

const key = process.env.OWLS_API_KEY;
if (!key) throw new Error('OWLS_API_KEY missing');
const base = 'https://api.owlsinsight.com';
const paths = [
  '/api/v2/thunderpick/soccer',
  '/api/v2/thunderpick/soccer?status=scheduled',
  '/api/v2/thunderpick/soccer?status=upcoming',
  '/api/v2/thunderpick/soccer?limit=100',
  '/api/v2/thunderpick/soccer?page=1&limit=100',
  '/api/v2/thunderpick/soccer?includeMarkets=true',
  '/api/v2/thunderpick/soccer?live=false',
  '/api/v2/thunderpick/soccer?prematch=true'
];
const headersVariants = [
  { Authorization: `Bearer ${key}` },
  { 'X-API-Key': key },
  { 'x-api-key': key },
  { Authorization: key }
];
function countEvents(j) {
  const candidates = [j?.data?.events,j?.events,j?.data,j?.results,j?.data?.data];
  for (const x of candidates) if (Array.isArray(x)) return x.length;
  if (j?.data && typeof j.data === 'object') {
    for (const v of Object.values(j.data)) if (Array.isArray(v)) return v.length;
  }
  return 0;
}
const results=[];
for (const path of paths) {
  for (let i=0;i<headersVariants.length;i++) {
    try {
      const r=await fetch(base+path,{headers:{...headersVariants[i],Accept:'application/json','User-Agent':'thunderpick-odds-proxy/1.0'}});
      const text=await r.text(); let json=null; try{json=JSON.parse(text)}catch{}
      results.push({path,authVariant:i,status:r.status,ok:r.ok,count:countEvents(json),keys:json&&typeof json==='object'?Object.keys(json):[],preview:text.slice(0,1000)});
    } catch(e) { results.push({path,authVariant:i,error:String(e)}); }
  }
}
const out={generatedAt:new Date().toISOString(),results};
await fs.mkdir('data',{recursive:true});
await fs.writeFile('data/owls-thunderpick-soccer-debug.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
