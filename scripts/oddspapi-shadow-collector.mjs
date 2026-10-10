import fs from 'node:fs/promises';
import {readOddsPapiEntitlement,ODDS_PAPI_ESPORT_SPORTS} from './third-source-eligibility.mjs';
import {normalizeOddsPapiEvent} from './oddspapi-exact-normalizer.mjs';

const SPORT_ORDER=['lol','dota2','cs2','valorant'];
const snapshot=(at)=>({
 generatedAt:at,mode:'SHADOW_ONLY',productionEligible:false,state:'INITIAL',
 sports:Object.fromEntries(SPORT_ORDER.map(s=>[s,{exactV2:[]}])),
 bookmakerFamilies:[],counts:{events:0,markets:0,books:0,requests:0},errors:[]
});
export async function collectOddsPapiShadow({get,nowIso=new Date().toISOString()}={}){
 const out=snapshot(nowIso),now=Date.parse(nowIso);
 if(typeof get!=='function'||!Number.isFinite(now)){out.state='INVALID_INPUT';return out;}
 let calls=0;
 try{
  const account=await get('/account',{});calls++;
  const access=readOddsPapiEntitlement(account);
  out.entitlement={state:access.state,sports:access.sports,remaining:access.remaining,candidateFamilies:access.candidateFamilies};
  if(access.state!=='ESPORTS_ELIGIBLE'){out.state=access.state;return out;}
  const requestBudget=Math.min(10,Math.max(0,access.remaining-4));
  if(requestBudget<4){out.state='QUOTA_RESERVED';return out;}
  const markets=await get('/markets',{language:'en'});calls++;
  if(!Array.isArray(markets)||markets.length===0){out.state='MARKET_CATALOG_MISSING';return out;}
  const to=new Date(now+36*3600000).toISOString(),families=new Set();
  for(const sport of SPORT_ORDER){
   if(!access.sports.includes(sport)||calls+2>requestBudget)continue;
   try{
    const list=await get('/fixtures',{sportId:ODDS_PAPI_ESPORT_SPORTS[sport],from:nowIso,to,statusId:0,hasOdds:true});calls++;
    const rows=Array.isArray(list)?list:Array.isArray(list?.data)?list.data:[];
    const event=rows.filter(x=>Number(x.statusId)===0&&x.hasOdds===true&&Date.parse(x.startTime)>=now)
      .sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime))[0];
    if(!event?.fixtureId)continue;
    const priced=await get('/odds',{fixtureId:event.fixtureId,oddsFormat:'decimal',language:'en',verbosity:3});calls++;
    const normalized=normalizeOddsPapiEvent(priced,markets,{fetchedAt:new Date().toISOString()});
    if(!normalized)continue;
    out.sports[sport].exactV2.push(normalized);
    for(const b of normalized.bookmakers||[])families.add(b.sourceFamily);
   }catch(e){out.errors.push(sport+':'+String(e?.name||'read-error').slice(0,35));}
  }
  out.bookmakerFamilies=[...families].sort();
  out.counts.events=SPORT_ORDER.reduce((n,s)=>n+out.sports[s].exactV2.length,0);
  out.counts.books=out.bookmakerFamilies.length;
  out.counts.markets=SPORT_ORDER.reduce((n,s)=>n+out.sports[s].exactV2.reduce((sum,e)=>sum+(e.bookmakers||[]).reduce((k,b)=>k+(b.markets||[]).length,0),0),0);
  out.state=out.counts.events?'COLLECTED':'NO_EXACT_IDENTITIES';
 }catch(e){out.state='COLLECTOR_ERROR';out.errors.push(String(e?.name||'error').slice(0,40));}
 finally{out.counts.requests=calls;}
 return out;
}
async function run(){
 const key=(process.env.ODDSPAPI_API_KEY||'').trim();
 if(!key){console.log('ODDSPAPI_SHADOW',JSON.stringify({state:'NO_CONFIGURED_KEY'}));return;}
 let last=0;
 const get=async(path,params={})=>{
  const elapsed=Date.now()-last;if(elapsed<1100&&last)await new Promise(resolve=>setTimeout(resolve,1100-elapsed));
  const url=new URL('https://api.oddspapi.io/v4'+path);
  url.searchParams.set('apiKey',key);
  for(const [name,value] of Object.entries(params))url.searchParams.set(name,String(value));
  last=Date.now();
  const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Object.assign(new Error('upstream-status'),{name:'HTTP_'+response.status});
  return response.json();
 };
 const result=await collectOddsPapiShadow({get});
 await fs.mkdir('data',{recursive:true});
 await fs.writeFile('data/oddspapi-shadow-latest.json',JSON.stringify(result));
 console.log('ODDSPAPI_SHADOW',JSON.stringify({generatedAt:result.generatedAt,state:result.state,counts:result.counts,bookmakerFamilies:result.bookmakerFamilies,entitlement:result.entitlement,errors:result.errors,productionEligible:false}));
}
if(process.argv[1]?.endsWith('/oddspapi-shadow-collector.mjs'))await run();
