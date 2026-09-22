import fs from 'node:fs/promises';

const KEY=(process.env.PROPLINE_API_KEY||'').trim();
if(!KEY) throw new Error('PROPLINE_API_KEY missing');
const PATH='data/owls-comparison-latest.json';
const cmp=JSON.parse(await fs.readFile(PATH,'utf8'));
const TP=JSON.parse(await fs.readFile('data/owls-latest.json','utf8'));
const base='https://api.prop-line.com/v1';

const FEEDS=[
 {api:'esports', targets:['cs2','dota2','lol','valorant'], markets:'h2h,spreads,totals,map_winner,round_handicap,round_totals'},
 {api:'football_nfl', targets:['american-football']},
 {api:'americanfootball_ncaaf', targets:['american-football']},
 {api:'baseball_mlb', targets:['baseball']},
 {api:'basketball_nba', targets:['basketball']},
 {api:'basketball_wnba', targets:['basketball']},
 {api:'basketball_ncaab', targets:['basketball']},
 {api:'tennis', targets:['tennis']}
];

function dec(v){const x=Number(v);if(!Number.isFinite(x))return null;if(x>=100)return 1+x/100;if(x<=-100)return 1+100/Math.abs(x);return x>1?x:null;}
const TEAM_ALIASES=new Map([
 ['lasvegasaces','lasvegasaces'],['lvaces','lasvegasaces'],['aces','lasvegasaces'],
 ['seattlestorm','seattlestorm'],['storm','seattlestorm'],
 ['phoenixmercury','phoenixmercury'],['mercury','phoenixmercury'],
 ['portlandfire','portlandfire'],['fire','portlandfire'],
 ['connecticutsun','connecticutsun'],['sun','connecticutsun'],
 ['atlantadream','atlantadream'],['dream','atlantadream'],
 ['washingtonmystics','washingtonmystics'],['mystics','washingtonmystics'],
 ['chicagosky','chicagosky'],['sky','chicagosky'],
 ['losangelessparks','losangelessparks'],['lasparks','losangelessparks'],['sparks','losangelessparks'],
 ['dallaswings','dallaswings'],['wings','dallaswings'],
 ['newyorkliberty','newyorkliberty'],['liberty','newyorkliberty'],
 ['minnesotalynx','minnesotalynx'],['lynx','minnesotalynx'],
 ['indianafever','indianafever'],['fever','indianafever'],
 ['goldenstatevalkyries','goldenstatevalkyries'],['valkyries','goldenstatevalkyries'],
 ['torontotempo','torontotempo'],['tempo','torontotempo']
]);
function norm(s=''){
 let x=String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'and')
  .replace(/\b(team|esports|gaming|club|university|college|women|womens|female)\b/g,'')
  .replace(/\((?:w|women)\)/g,'').replace(/[^a-z0-9]/g,'');
 x=x.replace(/(?:women|womens|female)$/,'').replace(/w$/,'');
 return TEAM_ALIASES.get(x)||x;
}
function pair(a,b){return [norm(a),norm(b)].sort().join('|');}
function tpEvents(sport){return TP?.sports?.[sport]?.data?.data||[];}
function tpIndex(sport){
 const map=new Map();
 for(const e of tpEvents(sport)){
  const h=e?.teams?.home?.name||e?.market?.home?.name,a=e?.teams?.away?.name||e?.market?.away?.name;
  if(!h||!a)continue;
  map.set(pair(h,a),{event:e,home:h,away:a,start:Date.parse(e.startTime)});
 }
 return map;
}
function sameTeam(a,b){const x=norm(a),y=norm(b);return x===y||(x.length>=5&&y.length>=5&&(x.includes(y)||y.includes(x)));}
function findTPMatch(index,e){
 const exact=index.get(pair(e.home_team,e.away_team));if(exact)return exact;
 const start=Date.parse(e.commence_time||e.start_time||e.startTime);
 const candidates=[];
 for(const row of index.values()){
  const teams=(sameTeam(row.home,e.home_team)&&sameTeam(row.away,e.away_team))||(sameTeam(row.home,e.away_team)&&sameTeam(row.away,e.home_team));
  if(!teams)continue;
  if(Number.isFinite(start)&&Number.isFinite(row.start)&&Math.abs(start-row.start)>12*3600e3)continue;
  candidates.push(row);
 }
 return candidates.length===1?candidates[0]:null;
}
function ensureBucket(sport){cmp.sports??={};cmp.sports[sport]??={ok:true,status:200,data:{}};const b=cmp.sports[sport];if(!b.data||typeof b.data!=='object'||Array.isArray(b.data))b.data={};return b;}

let inserted=0,matchedEvents=0,requestCount=0;const books=new Set(),feedStats=[];let quota={used:null,remaining:null,reset:null};
for(const feed of FEEDS){
 const wanted=feed.markets||'h2h,spreads,totals,player_props';
 let r=await fetch(`${base}/sports/${feed.api}/odds?markets=${encodeURIComponent(wanted)}&period=all`,{headers:{'X-API-Key':KEY,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 requestCount++;quota={used:Number(r.headers.get('x-daily-used'))||quota.used,remaining:Number(r.headers.get('x-daily-remaining'))||quota.remaining,reset:r.headers.get('x-daily-reset')||quota.reset};
 if(!r.ok&&feed.api==='esports'){
   const err=await r.text();
   console.warn('PROPLINE_ESPORTS_DERIVATIVE_QUERY_FAILED',r.status,err.slice(0,300));
   r=await fetch(`${base}/sports/${feed.api}/odds?markets=h2h,spreads,totals&period=all`,{headers:{'X-API-Key':KEY,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
   requestCount++;quota={used:Number(r.headers.get('x-daily-used'))||quota.used,remaining:Number(r.headers.get('x-daily-remaining'))||quota.remaining,reset:r.headers.get('x-daily-reset')||quota.reset};
 }
 if(!r.ok){const text=await r.text();feedStats.push({feed:feed.api,ok:false,status:r.status,error:text.slice(0,200)});continue;}
 const body=await r.json(),events=Array.isArray(body)?body:(Array.isArray(body?.data)?body.data:[]);let feedMatched=0,feedRows=0;
 if(feed.api==='esports'){
   const keyCounts={};
   for(const ev of events) for(const bm of ev.bookmakers||[]) for(const m of bm.markets||[]) keyCounts[m.key]=(keyCounts[m.key]||0)+1;
   console.log('PROPLINE_ESPORTS_MARKET_KEYS',JSON.stringify(keyCounts));
 }
 for(const target of feed.targets){
  const index=tpIndex(target);if(!index.size)continue;const bucket=ensureBucket(target);
  for(const e of events){
   const tpMatch=findTPMatch(index,e);if(!tpMatch)continue;
   matchedEvents++;feedMatched++;
   for(const bm of e.bookmakers||[]){
    const bookKey=`propline:${bm.key||bm.title||'unknown'}`,markets=[];
    for(const m of bm.markets||[]){if(!['h2h','spreads','totals','map_winner','round_handicap','round_totals'].includes(m.key)&&!/player/i.test(String(m.key||'')))continue;const outcomes=(m.outcomes||[]).map(o=>{let name=o.name;if(m.key!=='totals'){if(sameTeam(o.name,e.home_team))name=tpMatch.home;else if(sameTeam(o.name,e.away_team))name=tpMatch.away;}return {...o,source_name:o.name,name,price:dec(o.price)};}).filter(o=>o.price>1);if(outcomes.length<2)continue;markets.push({...m,outcomes,last_update:bm.last_update||e.last_update||null});}
    if(!markets.length)continue;
    // Canonicalize team display names to Thunderpick after a unique identity match so the downstream exact pair join is stable.
    const normalized={...e,home_team:tpMatch.home,away_team:tpMatch.away,status:e.live?'live':'scheduled',sourceLeague:feed.api,bookmakers:[{...bm,key:bookKey,title:bm.title||bm.key,markets}]};
    bucket.data[bookKey]??=[];bucket.data[bookKey].push(normalized);books.add(bookKey);inserted++;feedRows++;
   }
  }
 }
 feedStats.push({feed:feed.api,ok:true,eventsReturned:events.length,matchedEvents:feedMatched,bookRows:feedRows});
}
cmp.propline={ok:true,fetchedAt:new Date().toISOString(),requestCountThisRun:requestCount,matchedEvents,matchedEventBookRows:inserted,independentBooks:[...books].sort(),quota,feeds:feedStats,mode:'Thunderpick-targeted exact/unique team identity + time-window enrichment'};
cmp.requestCountThisRun=(cmp.requestCountThisRun||0)+requestCount;cmp.source='Owls v1 normalized odds + PropLine esports and traditional-sports enrichment';
await fs.writeFile(PATH,JSON.stringify(cmp,null,2));
console.log(`PropLine requests=${requestCount}, matched events=${matchedEvents}, matched book rows=${inserted}, independent books=${books.size}, remaining=${quota.remaining??'unknown'}`);console.log('PropLine feed stats',JSON.stringify(feedStats));
if(quota.remaining!==null&&quota.remaining<300)console.warn('PropLine quota reserve below 300; future enrichment should be curtailed.');
