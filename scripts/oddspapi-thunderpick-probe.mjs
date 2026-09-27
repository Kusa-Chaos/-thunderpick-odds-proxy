const KEY=(process.env.ODDSPAPI_API_KEY||'').trim();
if(!KEY){console.log('ODDSPAPI_PROBE',JSON.stringify({configured:false}));process.exit(0);}
const BASE='https://api.oddspapi.io/v4';
async function get(path,params={}){
  const u=new URL(BASE+path);u.searchParams.set('apiKey',KEY);
  for(const [k,v] of Object.entries(params))if(v!=null)u.searchParams.set(k,String(v));
  const r=await fetch(u,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(60000)});
  const text=await r.text();let body;try{body=JSON.parse(text)}catch{body={raw:text.slice(0,300)}};
  return {ok:r.ok,status:r.status,body};
}
function objects(v,out=[],depth=0){if(depth>6||v==null)return out;if(Array.isArray(v)){for(const x of v.slice(0,50))objects(x,out,depth+1);return out;}if(typeof v==='object'){out.push(v);for(const x of Object.values(v))if(x&&typeof x==='object')objects(x,out,depth+1);}return out;}
function firstField(objs,names){for(const o of objs)for(const n of names)if(o[n]!=null)return o[n];return null;}
const acct=await get('/account');
const a=acct.body||{};const objs=objects(a);
const limitRaw=firstField(objs,['request_limit','requestLimit']);
const countRaw=firstField(objs,['request_count','requestCount']);
const limit=Number(limitRaw),count=Number(countRaw);
const remaining=Number.isFinite(limit)&&Number.isFinite(count)?Math.max(0,limit-count):null;
let thunderAccess=null;for(const o of objs){if(o?.bookmakers?.['thunderpick.io']){thunderAccess=o.bookmakers['thunderpick.io'];break;}}
const topKeys=a&&typeof a==='object'?Object.keys(a).slice(0,20):[];
const nestedKeys=[...new Set(objs.flatMap(o=>Object.keys(o)).filter(k=>/request|subscription|bookmaker|valid|active/i.test(k)))].slice(0,40);
console.log('ODDSPAPI_ACCOUNT',JSON.stringify({configured:true,status:acct.status,ok:acct.ok,topKeys,nestedKeys,requestLimit:Number.isFinite(limit)?limit:null,requestCount:Number.isFinite(count)?count:null,remaining,thunderpickAccess:thunderAccess?{hasLiveOdds:thunderAccess.has_live_odds??thunderAccess.hasLiveOdds??null,hasPlayerProps:thunderAccess.has_player_props??thunderAccess.hasPlayerProps??null}:null}));
if(!acct.ok||remaining==null||remaining<2){console.log('ODDSPAPI_PROBE_STOP',JSON.stringify({reason:!acct.ok?'account-check-failed':'insufficient-or-unreadable-quota',remaining}));process.exit(0);}
const from=new Date();const to=new Date(from.getTime()+47*3600*1000);
const fixtures=await get('/fixtures',{sportId:14,from:from.toISOString(),to:to.toISOString(),statusId:0,hasOdds:true,bookmakers:'thunderpick.io'});
const rows=Array.isArray(fixtures.body)?fixtures.body:(fixtures.body?.data||fixtures.body?.fixtures||[]);
console.log('ODDSPAPI_NFL_FIXTURES',JSON.stringify({status:fixtures.status,ok:fixtures.ok,count:Array.isArray(rows)?rows.length:0,sample:(Array.isArray(rows)?rows:[]).slice(0,5).map(x=>({fixtureId:x.fixtureId,startTime:x.startTime,home:x.participant1Name,away:x.participant2Name,tournament:x.tournamentName}))}));
if(!fixtures.ok||!Array.isArray(rows)||!rows.length)process.exit(0);
const f=rows[0];
await new Promise(r=>setTimeout(r,1100));
const odds=await get('/odds',{fixtureId:f.fixtureId,bookmakers:'thunderpick.io',oddsFormat:'decimal',language:'en',verbosity:3});
const b=odds.body||{};const tp=b.bookmakerOdds?.['thunderpick.io']??b.bookmakers?.['thunderpick.io']??b.odds?.['thunderpick.io']??null;
const markets=tp?.markets??tp??{};const keys=markets&&typeof markets==='object'?Object.keys(markets):[];const raw=JSON.stringify(tp||{});
console.log('ODDSPAPI_THUNDERPICK_ODDS',JSON.stringify({status:odds.status,ok:odds.ok,fixtureId:f.fixtureId,startTime:f.startTime,home:f.participant1Name,away:f.participant2Name,thunderpickPresent:Boolean(tp),marketCount:keys.length,marketKeys:keys.slice(0,50),hasPlayerProps:/player|passing|rushing|receiving|receptions|touchdown/i.test(raw),payloadBytes:raw.length}));
