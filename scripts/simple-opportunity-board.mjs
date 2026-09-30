import fs from 'node:fs/promises';
import {canonSport,exactIdentity,exactKey,identityComplete} from './market-identity.mjs';
import {filterFreshConsensusQuotes} from './source-quality.mjs';

const readJson=async(path,fallback={})=>{try{return JSON.parse(await fs.readFile(path,'utf8'))}catch{return fallback}};
const s=await readJson('data/screen-latest.json',{});
const direct=await readJson('data/simple-direct-discovery-latest.json',{rows:[]});
const tpMeta=await readJson('data/owls-meta.json',{});
const tp=await readJson('data/owls-latest.json',{sports:{}});
const now=new Date().toISOString();
const nowMs=Date.parse(now);
const rows=[];
const key=r=>exactKey(r);
function sourceFamily(v=''){
  const x=String(v||'').toLowerCase();
  if(x.includes('unibet')||x.includes('kambi'))return'unibet-kambi';
  if(x.includes('stake')||x.includes('oddin'))return'stake-oddin';
  if(x.includes('draftkings'))return'draftkings';
  if(x.includes('fanduel'))return'fanduel';
  if(x.includes('caesars'))return'caesars';
  if(x.includes('betmgm'))return'betmgm';
  if(x.includes('bovada'))return'bovada';
  if(x.includes('pinnacle'))return'pinnacle';
  if(x.includes('betway'))return'betway';
  if(x.includes('kalshi'))return'kalshi';
  if(x.includes('polymarket'))return'polymarket';
  if(x.includes('betstamp'))return'betstamp';
  return x.replace(/[^a-z0-9]/g,'')||'unknown';
}
function outsideFamily(o={}){return sourceFamily(o.book||o.title||o.source||o.provider||o.name||'');}
function dedupeOutside(list=[]){
  const by=new Map();
  for(const o of list){
    const fam=outsideFamily(o); if(!fam)continue;
    const old=by.get(fam);
    const t=Date.parse(o?.lastUpdate||o?.fetchedAt||'')||0,ot=Date.parse(old?.lastUpdate||old?.fetchedAt||'')||0;
    if(!old||t>=ot)by.set(fam,{...o,sourceFamily:fam});
  }
  return [...by.values()];
}
const directHealth=direct?.providerHealth||{};
const PROVIDER_FETCHED_AT={
  'stake-oddin':directHealth?.stake?.fetchedAt||null,
  'betway':directHealth?.betway?.fetchedAt||null,
  'pinnacle':directHealth?.pinnacle?.fetchedAt||null,
  'unibet-kambi':directHealth?.kambiTraditional?.fetchedAt||directHealth?.kambi?.fetchedAt||null,
  'bovada':directHealth?.bovadaTraditional?.fetchedAt||directHealth?.bovadaNfl?.fetchedAt||null,
  'fanduel':directHealth?.fanduel?.fetchedAt||directHealth?.fanduelProps?.fetchedAt||null,
  'draftkings':directHealth?.draftkingsTraditional?.fetchedAt||directHealth?.draftkingsNfl?.fetchedAt||null,
  'kalshi':directHealth?.kalshi?.fetchedAt||null,
  'polymarket':directHealth?.polymarket?.fetchedAt||null,
};
function tpFreshForSport(sport){
  const m=tpMeta?.sports?.[canonSport(sport)];
  if(!m)return false;
  const status=Number(m.status);
  const coverage=String(m.coverageStatus||'').toLowerCase();
  const selected=Number(m.deepSelectedEvents||0),success=Number(m.deepMarketSuccess||0),failures=Number(m.deepMarketFailures||0);
  const deepComplete=selected===0||(success===selected&&failures===0);
  return m.ok===true && m.httpOk===true && m.usedFallback!==true && (status===200||status===304) && deepComplete && !/stale|fallback|anomaly|error|partial/.test(coverage);
}
function staleSafe(row){
  if(tpFreshForSport(row.sport))return row;
  return {...row,tier:'INFORMATIONAL',thunderpick:null,estimatedEV:null,blocker:`STALE/INCOMPLETE THUNDERPICK SUPPRESSED — ${canonSport(row.sport)} deep inventory is not fully current; refresh every selected Thunderpick event before EV or bet classification`};
}
function sourceSafeRow(row){
  const outside=dedupeOutside(row.outside||[]);
  const reported=Number(row.independentSources??0);
  const sources=outside.length||reported;
  let blocker=row.blocker||null;
  if(outside.length&&reported>outside.length) blocker=`Same-provider duplicate collapsed (${reported} adapters -> ${outside.length} independent source families)`+(blocker?`; ${blocker}`:'');
  return {...row,outside,independentSources:sources,blocker};
}
function normalized(row){const identity=exactIdentity(row);return {...row,sport:identity.sport,identity,identityKey:exactKey(row),identityComplete:identityComplete(row)};}
function promotionScopeBlock(row){
  const i=row.identity||exactIdentity(row);
  if(i.family==='ml'&&i.set!=='') return 'Scoped Set Winner outside scope is not explicitly proven by the current H2H comparator; SCREENING ONLY';
  if(i.family==='ml'&&i.period!=='') return 'Period-scoped Winner outside scope is not explicitly proven by the current H2H comparator; SCREENING ONLY';
  if(i.family==='round_handicap'&&i.period!=='') return 'Period-scoped Round Handicap outside half/period is not explicitly proven by the current comparator; SCREENING ONLY';
  if(i.family==='round_total'&&i.period!=='') return 'Period-scoped Round Total outside half/period is not explicitly proven by the current comparator; SCREENING ONLY';
  return null;
}
function qualityBlock(rejected=[]){const parts=[...new Set(rejected.map(x=>`${x.quote?.sourceFamily||'source'}:${x.reason}`))];return parts.length?`ACTION source quality gate rejected ${parts.join(', ')}`:null;}
function add(r){
  const tpA=r?.thunderpick?.[0]||r?.thunderpick?.a,tpB=r?.thunderpick?.[1]||r?.thunderpick?.b;
  let evA=Number(r?.screenEV?.a ?? r?.ev?.a),evB=Number(r?.screenEV?.b ?? r?.ev?.b);
  let outside=dedupeOutside(r.outside||[]);
  const reported=Number(r.independentSources??r.verifiedIndependentSources??0);
  const rawSourceCount=outside.length||reported;
  const rawEv=Math.max(Number.isFinite(evA)?evA:-99,Number.isFinite(evB)?evB:-99);
  let rejectedOutside=[];
  let qualityApplied=false;
  if(rawSourceCount>=3&&rawEv>=0.02){
    qualityApplied=true;
    const side=evA>=evB?'a':'b';
    const quality=filterFreshConsensusQuotes(outside,{side,now:nowMs,providerFetchedAt:PROVIDER_FETCHED_AT});
    outside=quality.accepted;
    rejectedOutside=quality.rejected;
    if(outside.length&&outside.every(x=>Number.isFinite(Number(x.pA))&&Number.isFinite(Number(x.pB)))&&Number(tpA?.odds)>1&&Number(tpB?.odds)>1){
      const pA=outside.reduce((n,x)=>n+Number(x.pA),0)/outside.length;
      const pB=outside.reduce((n,x)=>n+Number(x.pB),0)/outside.length;
      evA=Number(tpA.odds)*pA-1;
      evB=Number(tpB.odds)*pB-1;
    }
  }
  const ev=Math.max(Number.isFinite(evA)?evA:-99,Number.isFinite(evB)?evB:-99);
  const target=evA>=evB?tpA:tpB;
  const sources=qualityApplied?outside.length:(outside.length||reported);
  const duplicateCollapsed=outside.length>0&&reported>outside.length;
  let row=normalized({sport:r.sport,eventId:r.eventId,match:r.name||r.match||null,target:target?.name||r.target||r.player||null,side:r.side||target?.name||null,market:r.marketLabel||r.market||r.marketKey||null,marketKey:r.marketKey||null,line:target?.point??r.line??null,scope:r.scope||null,isLive:r.isLive===true,state:r.state||'prematch',settlementScope:r.settlementScope||null,thunderpick:target?.odds??r.thunderpick??null,outside,independentSources:sources,estimatedEV:Number.isFinite(ev)&&ev>-90?ev:null,startTime:r.startTime||null,blocker:r.blocker||null});
  const duplicateBlock=duplicateCollapsed?`Same-provider duplicate collapsed (${reported} adapters -> ${sources} independent source families)`:null;
  const exactBlock=!row.identityComplete?'Exact contract identity incomplete; discovery only':null;
  const scopeBlock=promotionScopeBlock(row);
  const upstreamBlock=r.actionEligible===false&&sources>=3&&ev>=0.02?'ACTION blocked by upstream freshness/verification gate':null;
  const qBlock=qualityBlock(rejectedOutside);
  const actionEvidenceComplete=outside.length>=3;
  const actionAllowed=r.actionEligible!==false&&!/stale|fallback/i.test(String(r.blocker||''))&&row.identityComplete&&!scopeBlock&&actionEvidenceComplete;
  let tier='INFORMATIONAL';
  if(scopeBlock&&sources>=1)tier='SCREENING';
  else if(sources>=3&&ev>=0.02&&actionAllowed)tier='ACTION';
  else if(sources>=2&&ev>=0.01&&row.identityComplete)tier='WATCH';
  else if(sources>=1&&ev>=0.0025)tier='SCREENING';
  else if(sources>=1)tier='PRICE BOARD';
  row={...row,tier,rejectedOutside:rejectedOutside.map(x=>({sourceFamily:x.quote?.sourceFamily||null,reason:x.reason})),blocker:[duplicateBlock,exactBlock,scopeBlock,upstreamBlock,qBlock,r.blocker].filter(Boolean).join('; ')||null};rows.push(staleSafe(row));
}
for(const r of s.limitedExactComparisons||[])add(r);for(const r of s.candidates||[])add(r);for(const r of direct.rows||[]){const cleaned=sourceSafeRow(r);let row=normalized({...cleaned,tier:'SCREENING',blocker:cleaned.blocker||'Loose direct discovery; exact verification required before promotion'});rows.push(staleSafe(row));}for(const r of s.oneWayPlayerPropScreens||[])rows.push(staleSafe(normalized({tier:'SCREENING',sport:r.sport,eventId:r.eventId,match:r.match||null,target:r.player||null,side:r.side||null,market:r.marketLabel||'Player Prop',marketKey:'player_prop',line:r.line??null,scope:r.scope||null,isLive:r.isLive===true,state:r.state||'prematch',settlementScope:r.settlementScope||null,thunderpick:r.thunderpick??null,outside:dedupeOutside([{book:r.book,price:r.outsidePrice}]),independentSources:1,estimatedEV:null,startTime:r.startTime||null,blocker:r.blocker||'one-way outside quote; discovery only'})));for(const r of s.playerPropInventory||[])rows.push(staleSafe(normalized({tier:'INFORMATIONAL',sport:r.sport,eventId:r.eventId,match:r.match||null,target:r.player||null,side:r.side||null,market:r.market||'Player Prop',marketKey:'player_prop',line:r.line??null,scope:r.scope||null,isLive:r.isLive===true,state:r.state||'prematch',settlementScope:r.settlementScope||null,thunderpick:r.thunderpick??null,outside:[],independentSources:0,estimatedEV:null,startTime:r.startTime||null,blocker:r.blocker||'Thunderpick inventory; awaiting outside price'})));
const priority={ACTION:0,WATCH:1,SCREENING:2,'PRICE BOARD':3,INFORMATIONAL:4},best=new Map();for(const r of rows){const k=key(r),old=best.get(k);if(!old||priority[r.tier]<priority[old.tier]||(priority[r.tier]===priority[old.tier]&&(r.estimatedEV??-99)>(old.estimatedEV??-99)))best.set(k,r)}const dedup=[...best.values()].sort((a,b)=>(priority[a.tier]-priority[b.tier])||((b.estimatedEV??-99)-(a.estimatedEV??-99))||(b.independentSources-a.independentSources));const tiers=['ACTION','WATCH','SCREENING','PRICE BOARD','INFORMATIONAL'],sports=['american-football','baseball','basketball','soccer','tennis','cs2','dota2','lol','valorant'],freshnessBySport=Object.fromEntries(sports.map(sp=>[sp,tpFreshForSport(sp)])),coverageAudit={};
for(const sp of sports){const sr=tp?.sports?.[sp],events=Array.isArray(sr?.data?.data)?sr.data.data:[],tpMarkets=events.reduce((n,e)=>n+(Array.isArray(e?.preferredMarkets)?e.preferredMarkets.length:0)+(e?.market?1:0),0),deepMarkets=events.reduce((n,e)=>n+(e?.deepMarketsFresh===true&&Array.isArray(e?.preferredMarkets)?e.preferredMarkets.length:0),0),rr=dedup.filter(r=>canonSport(r.sport)===sp);coverageAudit[sp]={events:events.length,tpMarkets,deepMarkets,deepSelectedEvents:Number(tpMeta?.sports?.[sp]?.deepSelectedEvents||0),deepSuccessfulEvents:Number(tpMeta?.sports?.[sp]?.deepMarketSuccess||0),deepFailedEvents:Number(tpMeta?.sports?.[sp]?.deepMarketFailures||0),exact1Source:rr.filter(r=>r.identityComplete&&r.independentSources===1).length,exact2Source:rr.filter(r=>r.identityComplete&&r.independentSources===2).length,exact3Plus:rr.filter(r=>r.identityComplete&&r.independentSources>=3).length,action:rr.filter(r=>r.tier==='ACTION').length,watch:rr.filter(r=>r.tier==='WATCH').length,screening:rr.filter(r=>r.tier==='SCREENING').length,identityIncomplete:rr.filter(r=>!r.identityComplete).length};}
const out={generatedAt:now,mode:'simple-discovery-first-full-board-v4-strict-scope-source-quality',identitySchema:'sport+event+market family+target+stat+exact line+period/map/round/set+side+prematch/live+settlement scope',rules:{action:'3+ independent exact source families and EV >= 2%, with fresh complete Thunderpick deep verification, complete exact-contract identity, fresh source timestamps, and source-consensus quality gate',watch:'2+ independent exact source families and EV >= 1%, with fresh complete Thunderpick deep price and complete exact-contract identity; scoped winners/round markets require explicit outside scope proof',screening:'1+ outside source family and EV >= 0.25%, or incomplete/exact-scope discrepancy requiring verification; stale/partial TP never shown as current',informational:'inventory/outside context only; stale/partial Thunderpick price and EV are suppressed'},sourceHealth:{direct:direct.providerHealth||null,strictSnapshotHealthy:s.snapshotHealth?.healthy??s.snapshotHealthy??null,thunderpickFreshBySport:freshnessBySport,thunderpickQuotaExhausted:tpMeta?.quotaExhausted??null,thunderpickQuotaResetMonth:tpMeta?.quotaResetMonth??null},coverageAudit,counts:Object.fromEntries(tiers.map(t=>[t,dedup.filter(r=>r.tier===t).length])),rows:dedup.slice(0,500)};await fs.writeFile('data/simple-opportunity-latest.json',JSON.stringify(out,null,2));console.log('SIMPLE_BOARD',out.counts,'rows',out.rows.length,'TP_FRESH',freshnessBySport,'COVERAGE',coverageAudit);