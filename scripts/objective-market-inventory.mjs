import fs from 'node:fs/promises';
import {normalizeObjectiveMarket,objectiveContractKey} from './objective-market-normalizer.mjs';

const TP_FILE=process.env.TP_FILE||'data/owls-latest.json';
const DIRECT_FILE=process.env.DIRECT_FILE||'data/direct-sources-latest.json';
const GGBET_FILE=process.env.GGBET_FILE||'data/ggbet-direct-latest.json';
const OUT_FILE=process.env.OUT_FILE||'data/objective-market-inventory-latest.json';
const SPORTS=['lol','dota2'];

const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const readOptional=async p=>{try{return await read(p)}catch{return {sports:{}}}};
const tp=await read(TP_FILE);
const direct=await read(DIRECT_FILE);
const ggbet=await readOptional(GGBET_FILE);

function sourceFamily(raw=''){
  const s=String(raw).toLowerCase();
  if(s.includes('stake')||s.includes('oddin'))return 'stake-oddin';
  if(s.includes('unibet')||s.includes('kambi'))return 'unibet-kambi';
  if(s.includes('betway'))return 'betway';
  if(s.includes('cloudbet'))return 'cloudbet';
  if(s.includes('pinnacle'))return 'pinnacle';
  if(s.includes('bovada'))return 'bovada';
  if(s.includes('fanduel'))return 'fanduel';
  if(s.includes('draftkings'))return 'draftkings';
  if(s.includes('kalshi'))return 'kalshi';
  if(s.includes('polymarket'))return 'polymarket';
  return s.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'unknown';
}

function eventName(event={}){
  return event.name||[event.home_team,event.away_team].filter(Boolean).join(' vs ')||
    [event?.teams?.home?.name,event?.teams?.away?.name].filter(Boolean).join(' vs ')||'unknown';
}
function eventTeams(event={}){
  return {
    home:event.home_team??event?.teams?.home?.name??event?.market?.home?.name??null,
    away:event.away_team??event?.teams?.away?.name??event?.market?.away?.name??null
  };
}
function eventState(event={}){return event.isLive===true||event.live===true?'live':'prematch';}

const raw=[];
for(const sport of SPORTS){
  const tpEvents=tp?.sports?.[sport]?.data?.data||[];
  for(const e of tpEvents){
    const teams=eventTeams(e);
    for(const m of e.preferredMarkets||[]){
      const n=normalizeObjectiveMarket({sport,source:'thunderpick',event:teams,market:m});
      if(!n)continue;
      raw.push({...n,sport,source:'thunderpick',event:eventName(e),state:eventState(e),label:m.name||m.nickName||n.label});
    }
  }
  const outside=[...(direct?.sports?.[sport]?.exactV2||[]),...(ggbet?.sports?.[sport]?.exactV2||[])];
  for(const e of outside){
    const teams=eventTeams(e);
    for(const bm of e.bookmakers||[]){
      const source=sourceFamily(bm.key||bm.title||bm.name||'unknown');
      for(const m of bm.markets||[]){
        const n=normalizeObjectiveMarket({sport,source,event:teams,market:m});
        if(!n)continue;
        raw.push({...n,sport,source,event:eventName(e),state:'prematch',label:m.name||m.title||m.key||n.label});
      }
    }
  }
}

const sports={};
for(const sport of SPORTS)sports[sport]={sources:{},totals:{contracts:0,families:0,sources:0}};
const seenByBucket=new Map();
for(const r of raw){
  const s=sports[r.sport];
  const src=s.sources[r.source]??={families:{},contracts:0};
  const fam=src.families[r.family]??={contracts:0,events:0,maps:[],lines:[],targets:[],sampleLabels:[],samples:[]};
  const key=objectiveContractKey({sport:r.sport,event:r.event,family:r.family,target:r.target||'',map:r.map,line:r.line,side:'market',state:r.state,settlement:'standard'});
  const bucket=`${r.sport}|${r.source}|${r.family}`;
  if(!seenByBucket.has(bucket))seenByBucket.set(bucket,new Set());
  const seen=seenByBucket.get(bucket);
  if(seen.has(key))continue;
  seen.add(key);
  fam.contracts++;
  src.contracts++;
  if(r.map!==null&&!fam.maps.includes(r.map))fam.maps.push(r.map);
  if(r.line!==null&&!fam.lines.includes(r.line))fam.lines.push(r.line);
  if(r.target&&!fam.targets.includes(r.target))fam.targets.push(r.target);
  if(r.label&&!fam.sampleLabels.includes(r.label)&&fam.sampleLabels.length<8)fam.sampleLabels.push(r.label);
  if(fam.samples.length<5)fam.samples.push({event:r.event,label:r.label,map:r.map,line:r.line,target:r.target||null,state:r.state});
}
for(const sport of SPORTS){
  const s=sports[sport];
  for(const src of Object.values(s.sources)){
    for(const fam of Object.values(src.families)){
      fam.maps.sort((a,b)=>a-b); fam.lines.sort((a,b)=>a-b); fam.targets.sort();
      fam.events=new Set(fam.samples.map(x=>x.event)).size;
    }
  }
  s.totals.contracts=Object.values(s.sources).reduce((n,x)=>n+x.contracts,0);
  s.totals.sources=Object.keys(s.sources).length;
  s.totals.families=new Set(Object.values(s.sources).flatMap(x=>Object.keys(x.families))).size;
}

const out={generatedAt:new Date().toISOString(),mode:'objective-market-inventory-v1',sports};
await fs.writeFile(OUT_FILE,JSON.stringify(out,null,2));
console.log('OBJECTIVE_MARKET_INVENTORY',JSON.stringify({generatedAt:out.generatedAt,lol:sports.lol.totals,dota2:sports.dota2.totals,sources:{lol:Object.keys(sports.lol.sources),dota2:Object.keys(sports.dota2.sources)}}));
