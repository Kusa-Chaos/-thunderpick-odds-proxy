import fs from 'node:fs/promises';
import {extractObjectiveContract,objectiveMatchKey,compareObjectiveContractSets,sourceFamily} from './objective-market-comparator.mjs';

const TP_FILE=process.env.TP_FILE||'data/owls-latest.json';
const DIRECT_FILE=process.env.DIRECT_FILE||'data/direct-sources-latest.json';
const GGBET_FILE=process.env.GGBET_FILE||'data/ggbet-direct-latest.json';
const OUT_FILE=process.env.OUT_FILE||'data/objective-market-comparison-latest.json';
const SPORTS=['lol','dota2'];
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const readOptional=async p=>{try{return await read(p)}catch{return {sports:{}}}};
const tp=await read(TP_FILE);
const direct=await read(DIRECT_FILE);
const ggbet=await readOptional(GGBET_FILE);

function eventName(event={}){
  return event.name||[event.home_team,event.away_team].filter(Boolean).join(' vs ')||[event?.teams?.home?.name,event?.teams?.away?.name].filter(Boolean).join(' vs ')||'unknown';
}
function eventShape(event={}){
  return {
    name:eventName(event),
    home:event.home_team??event?.teams?.home?.name??event?.market?.home?.name??null,
    away:event.away_team??event?.teams?.away?.name??event?.market?.away?.name??null,
    state:event.isLive===true||event.live===true?'live':'prematch'
  };
}
function dedupe(contracts=[]){
  const out=[],seen=new Set();
  for(const c of contracts){
    if(!c)continue;
    const key=`${c.source}|${objectiveMatchKey(c)}`;
    if(seen.has(key))continue;
    seen.add(key);out.push(c);
  }
  return out;
}
function countsByFamily(contracts=[]){
  const out={};
  for(const c of contracts)out[c.family]=(out[c.family]||0)+1;
  return Object.fromEntries(Object.entries(out).sort(([a],[b])=>a.localeCompare(b)));
}
function sourcesByFamily(contracts=[]){
  const map={};
  for(const c of contracts){
    if(!map[c.family])map[c.family]=new Set();
    map[c.family].add(c.source);
  }
  return Object.fromEntries(Object.entries(map).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,[...v].sort()]));
}
function appendOutsideContracts(container,sport,outsideContracts){
  for(const e of container?.sports?.[sport]?.exactV2||[]){
    const ev=eventShape(e);
    for(const bm of e.bookmakers||[]){
      const src=sourceFamily(bm.key||bm.title||bm.name||'unknown');
      for(const m of bm.markets||[]){
        const c=extractObjectiveContract({sport,source:src,event:ev,market:m});
        if(c)outsideContracts.push(c);
      }
    }
  }
}

const sports={};
for(const sport of SPORTS){
  const tpContracts=[];
  for(const e of tp?.sports?.[sport]?.data?.data||[]){
    const ev=eventShape(e);
    for(const m of e.preferredMarkets||[]){
      const c=extractObjectiveContract({sport,source:'thunderpick',event:ev,market:m});
      if(c)tpContracts.push(c);
    }
  }
  const outsideContracts=[];
  appendOutsideContracts(direct,sport,outsideContracts);
  appendOutsideContracts(ggbet,sport,outsideContracts);
  const tpExact=dedupe(tpContracts),outsideExact=dedupe(outsideContracts);
  const rows=compareObjectiveContractSets(tpExact,outsideExact).sort((a,b)=>
    String(a.family).localeCompare(String(b.family))||String(a.event).localeCompare(String(b.event))||(Number(a.map||0)-Number(b.map||0))||(Number(a.line||0)-Number(b.line||0))
  );
  const matchedFamilies=[...new Set(rows.map(r=>r.family))].sort();
  sports[sport]={
    summary:{
      tpContracts:tpExact.length,
      outsideContracts:outsideExact.length,
      exactMatches:rows.length,
      unmatchedTpContracts:Math.max(0,tpExact.length-rows.length),
      matchedFamilies:matchedFamilies.length,
      independentOutsideSources:[...new Set(outsideExact.map(c=>c.source))].sort()
    },
    tpByFamily:countsByFamily(tpExact),
    outsideByFamily:countsByFamily(outsideExact),
    outsideSourcesByFamily:sourcesByFamily(outsideExact),
    exactMatchesByFamily:countsByFamily(rows),
    rows
  };
}

const out={generatedAt:new Date().toISOString(),mode:'objective-market-comparison-v2-ggbet',promotionEnabled:true,sports};
await fs.writeFile(OUT_FILE,JSON.stringify(out,null,2));
console.log('OBJECTIVE_MARKET_COMPARISON',JSON.stringify({generatedAt:out.generatedAt,lol:sports.lol.summary,dota2:sports.dota2.summary}));
