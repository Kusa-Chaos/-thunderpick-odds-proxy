import fs from 'node:fs/promises';

const KEY=(process.env.PROPLINE_API_KEY||'').trim();
if(!KEY) throw new Error('PROPLINE_API_KEY missing');
const PATH='data/owls-comparison-latest.json';
const cmp=JSON.parse(await fs.readFile(PATH,'utf8'));
const TP=JSON.parse(await fs.readFile('data/owls-latest.json','utf8'));
const base='https://api.prop-line.com/v1';

// PropLine is The-Odds-API compatible. Query the actual sport/league feeds instead
// of trying to reuse the esports endpoint for traditional sports.
const FEEDS=[
 {api:'esports', targets:['cs2','dota2','lol','valorant']},
 {api:'football_nfl', targets:['american-football']},
 {api:'americanfootball_ncaaf', targets:['american-football']},
 {api:'baseball_mlb', targets:['baseball']},
 {api:'basketball_nba', targets:['basketball']},
 {api:'basketball_wnba', targets:['basketball']},
 {api:'basketball_ncaab', targets:['basketball']},
 {api:'tennis', targets:['tennis']}
];

function dec(v){
 const x=Number(v); if(!Number.isFinite(x)) return null;
 if(x>=100) return 1+x/100;
 if(x<=-100) return 1+100/Math.abs(x);
 return x>1?x:null;
}
function norm(s=''){
 return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/&/g,'and').replace(/\b(team|esports|gaming|club|university|college)\b/g,'')
  .replace(/[^a-z0-9]/g,'');
}
function pair(a,b){return [norm(a),norm(b)].sort().join('|');}
function tpPairs(sport){
 const events=TP?.sports?.[sport]?.data?.data||[];
 return new Set(events.map(e=>pair(e?.teams?.home?.name||e?.market?.home?.name,e?.teams?.away?.name||e?.market?.away?.name)));
}
function ensureBucket(sport){
 cmp.sports??={}; cmp.sports[sport]??={ok:true,status:200,data:{}};
 const b=cmp.sports[sport];
 if(!b.data||typeof b.data!=='object'||Array.isArray(b.data)) b.data={};
 return b;
}

let inserted=0, matchedEvents=0, requestCount=0; const books=new Set(); const feedStats=[];
let quota={used:null,remaining:null,reset:null};
for(const feed of FEEDS){
 const r=await fetch(`${base}/sports/${feed.api}/odds?markets=h2h,spreads,totals`,{
  headers:{'X-API-Key':KEY,Accept:'application/json'},signal:AbortSignal.timeout(30000)
 });
 requestCount++;
 quota={used:Number(r.headers.get('x-daily-used'))||quota.used,remaining:Number(r.headers.get('x-daily-remaining'))||quota.remaining,reset:r.headers.get('x-daily-reset')||quota.reset};
 if(!r.ok){const text=await r.text();feedStats.push({feed:feed.api,ok:false,status:r.status,error:text.slice(0,200)});continue;}
 const body=await r.json(); const events=Array.isArray(body)?body:(Array.isArray(body?.data)?body.data:[]);
 let feedMatched=0,feedRows=0;
 for(const target of feed.targets){
  const wanted=tpPairs(target); if(!wanted.size) continue;
  const bucket=ensureBucket(target);
  for(const e of events){
   if(!wanted.has(pair(e.home_team,e.away_team))) continue;
   matchedEvents++; feedMatched++;
   for(const bm of e.bookmakers||[]){
    const bookKey=`propline:${bm.key||bm.title||'unknown'}`; const markets=[];
    for(const m of bm.markets||[]){
     if(!['h2h','spreads','totals'].includes(m.key)) continue;
     const outcomes=(m.outcomes||[]).map(o=>({...o,price:dec(o.price)})).filter(o=>o.price>1);
     if(outcomes.length<2) continue;
     markets.push({...m,outcomes,last_update:bm.last_update||e.last_update||null});
    }
    if(!markets.length) continue;
    const normalized={...e,status:e.live?'live':'scheduled',sourceLeague:feed.api,bookmakers:[{...bm,key:bookKey,title:bm.title||bm.key,markets}]};
    bucket.data[bookKey]??=[]; bucket.data[bookKey].push(normalized);
    books.add(bookKey); inserted++; feedRows++;
   }
  }
 }
 feedStats.push({feed:feed.api,ok:true,eventsReturned:events.length,matchedEvents:feedMatched,bookRows:feedRows});
}
cmp.propline={ok:true,fetchedAt:new Date().toISOString(),requestCountThisRun:requestCount,matchedEvents,matchedEventBookRows:inserted,independentBooks:[...books].sort(),quota,feeds:feedStats,mode:'Thunderpick-targeted exact event/game-line enrichment'};
cmp.requestCountThisRun=(cmp.requestCountThisRun||0)+requestCount;
cmp.source='Owls v1 normalized odds + PropLine esports and traditional-sports enrichment';
await fs.writeFile(PATH,JSON.stringify(cmp,null,2));
console.log(`PropLine requests=${requestCount}, matched events=${matchedEvents}, matched book rows=${inserted}, independent books=${books.size}, remaining=${quota.remaining??'unknown'}`);
console.log('PropLine feed stats',JSON.stringify(feedStats));
if(quota.remaining!==null&&quota.remaining<300) console.warn('PropLine quota reserve below 300; future enrichment should be curtailed.');
