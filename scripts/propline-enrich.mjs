import fs from 'node:fs/promises';

const KEY=(process.env.PROPLINE_API_KEY||'').trim();
if(!KEY) throw new Error('PROPLINE_API_KEY missing');
const PATH='data/owls-comparison-latest.json';
const cmp=JSON.parse(await fs.readFile(PATH,'utf8'));
const TP=JSON.parse(await fs.readFile('data/owls-latest.json','utf8'));
const base='https://api.prop-line.com/v1';

// Circuit breaker: once the previous run proves the daily quota is exhausted,
// do not burn more requests until the provider reset time has passed.
const previous=cmp?.propline||{};
const previousRemaining=Number(previous?.quota?.remaining);
const previousReset=Date.parse(previous?.quota?.reset||'');
if(Number.isFinite(previousRemaining)&&previousRemaining<=0&&(!Number.isFinite(previousReset)||Date.now()<previousReset)){
  cmp.propline={...previous,ok:false,circuitOpen:true,skippedAt:new Date().toISOString(),reason:'daily quota exhausted; preserving previous healthy comparison data'};
  cmp.sourceHealth={...(cmp.sourceHealth||{}),propline:{healthy:false,circuitOpen:true,reason:'quota exhausted',reset:previous?.quota?.reset||null}};
  await fs.writeFile(PATH,JSON.stringify(cmp,null,2));
  console.warn('PROPLINE_CIRCUIT_OPEN',previous?.quota?.reset||'reset unknown');
  process.exit(0);
}

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
const TEAM_ALIASES=new Map();
function norm(s=''){return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'and').replace(/\b(team|esports|gaming|club|university|college|women|womens|female)\b/g,'').replace(/\((?:w|women)\)/g,'').replace(/[^a-z0-9]/g,'');}
function pair(a,b){return [norm(a),norm(b)].sort().join('|');}
function tpEvents(sport){return TP?.sports?.[sport]?.data?.data||[];}
function tpIndex(sport){const map=new Map();for(const e of tpEvents(sport)){const h=e?.teams?.home?.name||e?.market?.home?.name,a=e?.teams?.away?.name||e?.market?.away?.name;if(h&&a)map.set(pair(h,a),{event:e,home:h,away:a,start:Date.parse(e.startTime)});}return map;}
function sameTeam(a,b){const x=norm(a),y=norm(b);return x===y||(x.length>=5&&y.length>=5&&(x.includes(y)||y.includes(x)));}
function findTPMatch(index,e){const exact=index.get(pair(e.home_team,e.away_team));if(exact)return exact;const start=Date.parse(e.commence_time||e.start_time||e.startTime);const candidates=[];for(const row of index.values()){const teams=(sameTeam(row.home,e.home_team)&&sameTeam(row.away,e.away_team))||(sameTeam(row.home,e.away_team)&&sameTeam(row.away,e.home_team));if(!teams)continue;if(Number.isFinite(start)&&Number.isFinite(row.start)&&Math.abs(start-row.start)>12*3600e3)continue;candidates.push(row);}return candidates.length===1?candidates[0]:null;}
function ensureBucket(sport){cmp.sports??={};cmp.sports[sport]??={ok:true,status:200,data:{}};const b=cmp.sports[sport];if(!b.data||typeof b.data!=='object'||Array.isArray(b.data))b.data={};return b;}
let inserted=0,matchedEvents=0,requestCount=0;const books=new Set(),feedStats=[];let quota={used:null,remaining:null,reset:null};
let circuitOpened=false;
for(const feed of FEEDS){
 if(circuitOpened)break;
 const wanted=feed.markets||'h2h,spreads,totals,player_props';
 let r;
 try{r=await fetch(`${base}/sports/${feed.api}/odds?markets=${encodeURIComponent(wanted)}&period=all`,{headers:{'X-API-Key':KEY,Accept:'application/json'},signal:AbortSignal.timeout(30000)});}catch(err){feedStats.push({feed:feed.api,ok:false,error:'timeout'});continue;}
 requestCount++;
 quota={used:Number(r.headers.get('x-daily-used'))||quota.used,remaining:Number(r.headers.get('x-daily-remaining'))||quota.remaining,reset:r.headers.get('x-daily-reset')||quota.reset};
 if(r.status===429||quota.remaining===0){circuitOpened=true;feedStats.push({feed:feed.api,ok:false,status:r.status,error:'quota/rate limit; circuit opened'});break;}
 if(!r.ok){feedStats.push({feed:feed.api,ok:false,status:r.status});continue;}
 const body=await r.json(),events=Array.isArray(body)?body:(Array.isArray(body?.data)?body.data:[]);let feedMatched=0,feedRows=0;
 for(const target of feed.targets){const index=tpIndex(target);if(!index.size)continue;const bucket=ensureBucket(target);for(const e of events){const tpMatch=findTPMatch(index,e);if(!tpMatch)continue;matchedEvents++;feedMatched++;for(const bm of e.bookmakers||[]){const bookKey=`propline:${bm.key||bm.title||'unknown'}`,markets=[];for(const m of bm.markets||[]){if(!['h2h','spreads','totals','map_winner','round_handicap','round_totals'].includes(m.key)&&!/(player|batter|pitcher|kills?|headshots?|aces?|strikeouts?|passing|rushing|receiving|receptions|points|rebounds|assists)/i.test(String(m.key||'')))continue;const outcomes=(m.outcomes||[]).map(o=>({...o,price:dec(o.price)})).filter(o=>o.price>1);if(outcomes.length)markets.push({...m,outcomes});}if(!markets.length)continue;const normalized={...e,home_team:tpMatch.home,away_team:tpMatch.away,status:e.live?'live':'scheduled',sourceLeague:feed.api,bookmakers:[{...bm,key:bookKey,title:bm.title||bm.key,markets}]};bucket.data[bookKey]??=[];bucket.data[bookKey].push(normalized);books.add(bookKey);inserted++;feedRows++;}}}
 feedStats.push({feed:feed.api,ok:true,eventsReturned:events.length,matchedEvents:feedMatched,bookRows:feedRows});
}
cmp.propline={ok:!circuitOpened,circuitOpen:circuitOpened,fetchedAt:new Date().toISOString(),requestCountThisRun:requestCount,matchedEvents,matchedEventBookRows:inserted,independentBooks:[...books].sort(),quota,feeds:feedStats,mode:'quota-aware Thunderpick-targeted enrichment'};
cmp.sourceHealth={...(cmp.sourceHealth||{}),propline:{healthy:!circuitOpened,circuitOpen:circuitOpened,reset:quota.reset||null,remaining:quota.remaining}};
cmp.requestCountThisRun=(cmp.requestCountThisRun||0)+requestCount;
await fs.writeFile(PATH,JSON.stringify(cmp,null,2));
console.log('PropLine',JSON.stringify({requestCount,matchedEvents,inserted,books:books.size,quota,circuitOpened}));
