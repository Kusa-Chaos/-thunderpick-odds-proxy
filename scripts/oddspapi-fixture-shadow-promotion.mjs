import fs from 'node:fs/promises';
import {canonicalBookmakerFamily,NEW_BOOKMAKER_FAMILIES} from './third-source-eligibility.mjs';

const SPORTS=['lol','dota2','cs2','valorant'];
export function prepareVerifiedFixtureShadow(batch={}, {at=new Date().toISOString()}={}){
 const now=Date.parse(at),collected=Date.parse(batch.generatedAt||'');
 if(batch.mode!=='TOURNAMENT_SHADOW_ONLY'||batch.productionEligible!==false||
    batch.entitlement?.state!=='ESPORTS_ELIGIBLE'||!Number.isFinite(now)||!Number.isFinite(collected)||
    collected>now+60000||now-collected>10*60000||batch.source!=='OddsPapi /v4/odds (verified exact fixture)'||
    !Number.isInteger(batch.counts?.requests)||batch.counts.requests>5||batch.counts.requests<0){
   throw new Error('ODDSPAPI_FIXTURE_SHADOW_POLICY_NOT_VERIFIED');
 }
 const sports=Object.fromEntries(SPORTS.map(s=>[s,{exactV2:[]}]));
 const families=new Set();let events=0,markets=0;
 for(const sport of SPORTS){
  for(const event of batch.sports?.[sport]?.exactV2||[]){
   if(event?.live!==false||!String(event?.id||'').startsWith('oddspapi-direct:'))continue;
   const start=Date.parse(event.commence_time||'');
   if(!Number.isFinite(start)||start<=now-15*60000||start>now+30*86400000)continue;
   const bookmakers=[],seen=new Set();
   for(const book of event.bookmakers||[]){
    const family=canonicalBookmakerFamily(book.sourceFamily||book.key);
    if(!NEW_BOOKMAKER_FAMILIES.includes(family)||seen.has(family))continue;
    const accepted=(book.markets||[]).filter(m=>{
     if(m?.quoteTimestampVerified!==true||m.quoteTimestampSource!=='outcome.changedAt')return false;
     const quoteAt=Date.parse(m.last_update||'');
     if(!Number.isFinite(quoteAt)||quoteAt>now+60000||now-quoteAt>40*60000)return false;
     if(!Array.isArray(m.outcomes)||m.outcomes.length!==2||
        !m.outcomes.every(o=>typeof o.price==='number'&&o.price>1&&o.price<100))return false;
     return ['h2h','map_winner','totals'].includes(m.key);
    });
    if(!accepted.length)continue;
    seen.add(family);families.add(family);markets+=accepted.length;
    bookmakers.push({...book,key:'oddspapi-'+family,sourceFamily:family,markets:accepted});
   }
   if(!bookmakers.length)continue;
   sports[sport].exactV2.push({...event,bookmakers});events++;
  }
 }
 return {
  generatedAt:batch.generatedAt,mode:'SHADOW_ONLY',productionEligible:false,
  sourceMode:'AUTHORIZED_FIXTURE_QUOTE_TIMESTAMPS_VERIFIED',
  state:events?'COLLECTED':'NO_EXACT_IDENTITIES',
  sports,bookmakerFamilies:[...families].sort(),
  counts:{events,markets,books:families.size,requests:batch.counts.requests,
   quoteAgeRejected:batch.counts.quoteAgeRejected||0},
  errors:Array.isArray(batch.errors)?batch.errors:[],
  entitlement:batch.entitlement,
  marketCatalog:batch.marketCatalog||null,
  providerRawFamilyCount:(batch.bookmakerSlugsObserved||[]).length,
  upstreamTimestampVerified:true,
  upstreamMethod:'odds-by-fixture'
 };
}
async function main(){
 const source=process.env.ODDSPAPI_VERIFIED_FIXTURE_SOURCE||'data/oddspapi-tournament-shadow-latest.json';
 const target=process.env.ODDSPAPI_VERIFIED_FIXTURE_TARGET||'data/oddspapi-shadow-latest.json';
 const batch=JSON.parse(await fs.readFile(source,'utf8'));
 const result=prepareVerifiedFixtureShadow(batch);
 await fs.writeFile(target,JSON.stringify(result));
 console.log('ODDSPAPI_VERIFIED_FIXTURE_SHADOW',JSON.stringify({
  state:result.state,counts:result.counts,bookmakerFamilies:result.bookmakerFamilies,
  sourceMode:result.sourceMode,productionEligible:result.productionEligible
 }));
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)await main();
