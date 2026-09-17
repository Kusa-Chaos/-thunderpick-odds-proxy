import fs from 'node:fs/promises';

const KEY=(process.env.PROPLINE_API_KEY||'').trim();
if(!KEY) throw new Error('PROPLINE_API_KEY missing');
const PATH='data/owls-comparison-latest.json';
const cmp=JSON.parse(await fs.readFile(PATH,'utf8'));
const TP=JSON.parse(await fs.readFile('data/owls-latest.json','utf8'));
const ESPORTS=['cs2','dota2','lol','valorant'];
const base='https://api.prop-line.com/v1';

function dec(v){
 const x=Number(v); if(!Number.isFinite(x)) return null;
 // PropLine uses American odds in its The-Odds-API-compatible payload.
 if(x>=100) return 1+x/100;
 if(x<=-100) return 1+100/Math.abs(x);
 // Be tolerant if decimal odds are ever returned.
 return x>1?x:null;
}
function norm(s=''){return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'and').replace(/\b(team|esports|gaming|club)\b/g,'').replace(/[^a-z0-9]/g,'');}
function pair(a,b){return [norm(a),norm(b)].sort().join('|');}
function tpPairs(sport){
 const events=TP?.sports?.[sport]?.data?.data||[];
 return new Set(events.map(e=>pair(e?.teams?.home?.name||e?.market?.home?.name,e?.teams?.away?.name||e?.market?.away?.name)));
}

const r=await fetch(`${base}/sports/esports/odds?markets=h2h`,{
 headers:{'X-API-Key':KEY,Accept:'application/json'},signal:AbortSignal.timeout(30000)
});
const remaining=r.headers.get('x-daily-remaining');
const used=r.headers.get('x-daily-used');
const reset=r.headers.get('x-daily-reset');
if(!r.ok){const text=await r.text();throw new Error(`PropLine ${r.status}: ${text.slice(0,500)}`);}
const body=await r.json();
const events=Array.isArray(body)?body:(Array.isArray(body?.data)?body.data:[]);
let inserted=0,books=new Set(),matchedEvents=0;

for(const sport of ESPORTS){
 const wanted=tpPairs(sport); if(!wanted.size) continue;
 const bucket=cmp?.sports?.[sport]; if(!bucket) continue;
 if(!bucket.data||typeof bucket.data!=='object'||Array.isArray(bucket.data)) bucket.data={};
 for(const e of events){
   if(!wanted.has(pair(e.home_team,e.away_team))) continue;
   matchedEvents++;
   for(const bm of e.bookmakers||[]){
     const bookKey=`propline:${bm.key||bm.title||'unknown'}`;
     const markets=[];
     for(const m of bm.markets||[]){
       if(m.key!=='h2h') continue;
       const outcomes=(m.outcomes||[]).map(o=>({...o,price:dec(o.price)})).filter(o=>o.price>1);
       if(outcomes.length!==2) continue;
       markets.push({...m,key:'h2h',outcomes,last_update:bm.last_update||e.last_update||null});
     }
     if(!markets.length) continue;
     const normalized={...e,status:e.live?'live':'scheduled',bookmakers:[{...bm,key:bookKey,title:bm.title||bm.key,markets}]};
     bucket.data[bookKey]??=[];
     bucket.data[bookKey].push(normalized);
     books.add(bookKey); inserted++;
   }
 }
}
cmp.propline={ok:true,fetchedAt:new Date().toISOString(),requestCountThisRun:1,eventsReturned:events.length,matchedEventBookRows:inserted,independentBooks:[...books].sort(),quota:{used:used?Number(used):null,remaining:remaining?Number(remaining):null,reset:reset||null},mode:'candidate verification / independent h2h evidence'};
cmp.requestCountThisRun=(cmp.requestCountThisRun||0)+1;
cmp.source='Owls v1 normalized odds + PropLine independent-book enrichment';
await fs.writeFile(PATH,JSON.stringify(cmp,null,2));
console.log(`PropLine events=${events.length}, matched book rows=${inserted}, independent books=${books.size}, remaining=${remaining??'unknown'}`);
if(remaining!==null&&Number(remaining)<300) console.warn('PropLine quota reserve below 300; future enrichment should be curtailed.');
