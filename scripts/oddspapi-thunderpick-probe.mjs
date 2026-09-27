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
const acct=await get('/account');
const a=acct.body||{};
const sub=a.subscription||a.active_subscription||a.activeSubscription||a;
const limit=Number(sub.request_limit??sub.requestLimit??a.request_limit??a.requestLimit);
const count=Number(sub.request_count??sub.requestCount??a.request_count??a.requestCount);
const remaining=Number.isFinite(limit)&&Number.isFinite(count)?Math.max(0,limit-count):null;
const thunderAccess=sub.bookmakers?.['thunderpick.io']??a.bookmakers?.['thunderpick.io']??null;
console.log('ODDSPAPI_ACCOUNT',JSON.stringify({configured:true,status:acct.status,ok:acct.ok,requestLimit:Number.isFinite(limit)?limit:null,requestCount:Number.isFinite(count)?count:null,remaining,validUntil:sub.valid_until??sub.validUntil??null,isActive:sub.is_active??sub.isActive??null,thunderpickAccess:thunderAccess?{hasLiveOdds:thunderAccess.has_live_odds??thunderAccess.hasLiveOdds??null,hasPlayerProps:thunderAccess.has_player_props??thunderAccess.hasPlayerProps??null}:null}));
if(!acct.ok||remaining==null||remaining<2){console.log('ODDSPAPI_PROBE_STOP',JSON.stringify({reason:!acct.ok?'account-check-failed':'insufficient-quota',remaining}));process.exit(0);}
const from=new Date();const to=new Date(from.getTime()+47*3600*1000);
const fixtures=await get('/fixtures',{sportId:14,from:from.toISOString(),to:to.toISOString(),statusId:0,hasOdds:true,bookmakers:'thunderpick.io'});
const rows=Array.isArray(fixtures.body)?fixtures.body:(fixtures.body?.data||fixtures.body?.fixtures||[]);
console.log('ODDSPAPI_NFL_FIXTURES',JSON.stringify({status:fixtures.status,ok:fixtures.ok,count:Array.isArray(rows)?rows.length:0,sample:(Array.isArray(rows)?rows:[]).slice(0,5).map(x=>({fixtureId:x.fixtureId,startTime:x.startTime,home:x.participant1Name,away:x.participant2Name,tournament:x.tournamentName}))}));
if(!fixtures.ok||!Array.isArray(rows)||!rows.length)process.exit(0);
const f=rows[0];
await new Promise(r=>setTimeout(r,1100));
const odds=await get('/odds',{fixtureId:f.fixtureId,bookmakers:'thunderpick.io',oddsFormat:'decimal',language:'en',verbosity:3});
const b=odds.body||{};const tp=b.bookmakerOdds?.['thunderpick.io']??b.bookmakers?.['thunderpick.io']??b.odds?.['thunderpick.io']??null;
const markets=tp?.markets??tp??{};
const keys=markets&&typeof markets==='object'?Object.keys(markets):[];
const raw=JSON.stringify(tp||{});
console.log('ODDSPAPI_THUNDERPICK_ODDS',JSON.stringify({status:odds.status,ok:odds.ok,fixtureId:f.fixtureId,startTime:f.startTime,home:f.participant1Name,away:f.participant2Name,thunderpickPresent:Boolean(tp),marketCount:keys.length,marketKeys:keys.slice(0,50),hasPlayerProps:/player|passing|rushing|receiving|receptions|touchdown/i.test(raw),payloadBytes:raw.length}));
