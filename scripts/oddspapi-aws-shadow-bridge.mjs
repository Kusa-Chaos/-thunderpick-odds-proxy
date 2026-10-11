import fs from 'node:fs/promises';
import {canonicalBookmakerFamily} from './third-source-eligibility.mjs';

const SPORTS=['lol','dota2','cs2','valorant'];
const MAX_AGE_MS=40*60*1000;
const APPROVED_FAMILIES=new Set(['1xbet','bet365','betano','roobet','rivalry','unibet-kambi']);
const plausibleDecimal=x=>typeof x==='number'&&Number.isFinite(x)&&x>1&&x<100;
const text=x=>String(x??'').trim();

function cleanMarket(m={},nowMs){
 const key=text(m.key),scope=m.scope||{},map=scope.map??null;
 const two=Array.isArray(m.outcomes)&&m.outcomes.length===2&&m.outcomes.every(o=>text(o.name)&&plausibleDecimal(o.price));
 if(!two||!['h2h','totals','map_winner'].includes(key))return null;
 if(key==='map_winner'&&!(Number.isInteger(map)&&map>=1&&map<=5))return null;
 if(key!=='map_winner'&&map!=null)return null;
 if(key==='totals'&&(m.name!=='Total Maps'||m.line===null||m.line===undefined||!Number.isFinite(Number(m.line))||Number(m.line)<=0||!m.outcomes.some(o=>o.name==='Over')||!m.outcomes.some(o=>o.name==='Under')))return null;
 if(key==='h2h'&&m.line!=null)return null;
 // Every quote must carry its upstream outcome changedAt, not collection time.
 // Its age is measured at SCAN time, never relative to the shadow upload time.
 const quoteAt=Date.parse(m.last_update||'');
 if(m.quoteTimestampVerified!==true||m.quoteTimestampSource!=='outcome.changedAt'||
    !Number.isFinite(quoteAt)||quoteAt>nowMs+60000||nowMs-quoteAt>40*60000)return null;
 return {...m,scope:{map:key==='map_winner'?map:null,round:null},last_update:m.last_update};
}
export function bridgeOddsPapiSnapshot({direct={},shadow={},nowMs=Date.now(),maxAgeMs=MAX_AGE_MS}={}){
 const out=structuredClone(direct);
 const sports=out.sports??={};
 const removed={};
 for(const sport of SPORTS){
  const bucket=sports[sport]??={exactV2:[]};
  const original=Array.isArray(bucket.exactV2)?bucket.exactV2:[];
  bucket.exactV2=original.filter(e=>!text(e.id).startsWith('oddspapi-direct:'));
  removed[sport]=original.length-bucket.exactV2.length;
 }
 const generatedAt=Date.parse(shadow.generatedAt||'');
 let blocker=null;
 if(shadow.mode!=='SHADOW_ONLY'||shadow.productionEligible!==false)blocker='INVALID_SHADOW_ORIGIN';
 else if(shadow.sourceMode!=='AUTHORIZED_FIXTURE_QUOTE_TIMESTAMPS_VERIFIED'||shadow.upstreamTimestampVerified!==true)blocker='UNVERIFIED_UPSTREAM_QUOTE_TIMESTAMPS';
 else if(shadow.state!=='COLLECTED')blocker='NO_COLLECTED_PRICES';
 else if(!Number.isFinite(generatedAt)||generatedAt>nowMs+60000||nowMs-generatedAt>maxAgeMs)blocker='STALE_OR_FUTURE_SHADOW';
 else if(shadow.entitlement?.state!=='ESPORTS_ELIGIBLE')blocker='ENTITLEMENT_NOT_VERIFIED';
 let acceptedEvents=0,acceptedMarkets=0;
 const familySet=new Set();
 if(!blocker){
  for(const sport of SPORTS){
   const rows=shadow.sports?.[sport]?.exactV2||[];
   for(const e of Array.isArray(rows)?rows:[]){
    if(!text(e.id).startsWith('oddspapi-direct:')||!text(e.home_team)||!text(e.away_team)||text(e.home_team)===text(e.away_team)||e.live!==false)continue;
    const start=Date.parse(e.commence_time||'');
    if(!Number.isFinite(start)||start<nowMs-15*60000||start>nowMs+30*86400000)continue;
    const bookmakers=[],seen=new Set();
    for(const bm of e.bookmakers||[]){
     const fam=canonicalBookmakerFamily(bm.sourceFamily||bm.key||bm.title);
     if(!APPROVED_FAMILIES.has(fam)||seen.has(fam)||!text(bm.key).startsWith('oddspapi-'))continue;
     const markets=(bm.markets||[]).map(m=>cleanMarket(m,nowMs)).filter(Boolean);
     if(!markets.length)continue;
     seen.add(fam);familySet.add(fam);
     acceptedMarkets+=markets.length;
     bookmakers.push({...bm,key:'oddspapi-'+fam,sourceFamily:fam,markets});
    }
    if(!bookmakers.length)continue;
    sports[sport].exactV2.push({...e,bookmakers});
    acceptedEvents++;
   }
  }
 }
 out.providerHealth??={};
 out.providerHealth.oddspapi={
  // A safely expired optional quote cache is not a collector failure.
  // Keep zero eligible markets, but distinguish quota-gated idle from real errors.
  ok:!blocker||blocker==='STALE_OR_FUTURE_SHADOW',
  usable:acceptedMarkets>0,
  state:blocker==='STALE_OR_FUTURE_SHADOW'?'IDLE_NO_FRESH_QUOTA_GATED_QUOTES':blocker||'CONNECTED_EXACT_MARKETS',
  shadowFailure:blocker&&blocker!=='STALE_OR_FUTURE_SHADOW'?blocker:null,
  generatedAt:shadow.generatedAt||null,fetchedAt:shadow.generatedAt||null,
  events:acceptedEvents,markets:acceptedMarkets,families:[...familySet].sort(),
  acceptedFromPrivateShadow:true,removedPrevious:removed,
  eligibleForActionOnlyThroughExactScanner:true
 };
 return {direct:out,health:out.providerHealth.oddspapi};
}

async function main(){
 const source=process.env.ODDSPAPI_SHADOW_FILE||'data/oddspapi-shadow-latest.json';
 const target=process.env.ODDSPAPI_DIRECT_FILE||'data/direct-sources-latest.json';
 const direct=JSON.parse(await fs.readFile(target,'utf8'));
 let shadow={};try{shadow=JSON.parse(await fs.readFile(source,'utf8'));}catch{}
 const {direct:updated,health}=bridgeOddsPapiSnapshot({direct,shadow});
 await fs.writeFile(target,JSON.stringify(updated,null,2));
 console.log('ODDSPAPI_AWS_BRIDGE',JSON.stringify(health));
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)await main();
