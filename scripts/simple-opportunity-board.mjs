import fs from 'node:fs/promises';

const readJson=async(path,fallback={})=>{try{return JSON.parse(await fs.readFile(path,'utf8'))}catch{return fallback}};
const s=await readJson('data/screen-latest.json',{});
const direct=await readJson('data/simple-direct-discovery-latest.json',{rows:[]});
const tpMeta=await readJson('data/owls-meta.json',{});
const now=new Date().toISOString();
const rows=[];
const key=r=>[r.sport,r.eventId||r.match||r.name,r.marketKey,r.marketLabel||r.market,r.scope?.map??'',r.scope?.round??'',r.target||''].join('|');
const sportAliases={'nfl':'american-football','american_football':'american-football','mlb':'baseball','nba':'basketball'};
const canonSport=s=>sportAliases[String(s||'').toLowerCase()]||String(s||'').toLowerCase();
function tpFreshForSport(sport){
  const m=tpMeta?.sports?.[canonSport(sport)];
  if(!m)return false;
  const status=Number(m.status);
  const coverage=String(m.coverageStatus||'').toLowerCase();
  return m.ok===true && m.httpOk===true && m.usedFallback!==true && (status===200||status===304) && !/stale|fallback|anomaly|error/.test(coverage);
}
function staleSafe(row){
  if(tpFreshForSport(row.sport))return row;
  return {...row,tier:'INFORMATIONAL',thunderpick:null,estimatedEV:null,blocker:`STALE THUNDERPICK SUPPRESSED — ${canonSport(row.sport)} snapshot is fallback/not current; refresh Thunderpick before any EV or bet classification`};
}

function add(r){
  const evA=Number(r?.screenEV?.a ?? r?.ev?.a);
  const evB=Number(r?.screenEV?.b ?? r?.ev?.b);
  const ev=Math.max(Number.isFinite(evA)?evA:-99,Number.isFinite(evB)?evB:-99);
  const tpA=r?.thunderpick?.[0]||r?.thunderpick?.a;
  const tpB=r?.thunderpick?.[1]||r?.thunderpick?.b;
  const target=evA>=evB?tpA:tpB;
  const sources=Number(r.independentSources??r.verifiedIndependentSources??0);
  const actionAllowed=r.actionEligible!==false&&!/stale|fallback/i.test(String(r.blocker||''));
  let tier='INFORMATIONAL';
  if(sources>=3 && ev>=0.02 && actionAllowed) tier='ACTION';
  else if(sources>=2 && ev>=0.01) tier='WATCH';
  else if(sources>=1 && ev>=0.0025) tier='SCREENING';
  else if(sources>=1) tier='PRICE BOARD';
  rows.push(staleSafe({tier,sport:r.sport,match:r.name||r.match||null,target:target?.name||r.target||r.player||null,market:r.marketLabel||r.market||r.marketKey||null,marketKey:r.marketKey||null,line:target?.point??r.line??null,scope:r.scope||null,thunderpick:target?.odds??r.thunderpick??null,outside:(r.outside||[]).slice(0,10),independentSources:sources,estimatedEV:Number.isFinite(ev)&&ev>-90?ev:null,startTime:r.startTime||null,blocker:r.blocker||null}));
}

for(const r of s.limitedExactComparisons||[]) add(r);
for(const r of s.candidates||[]) add(r);

for(const r of direct.rows||[]){const tier=r.tier==='SCREENING'?'SCREENING':'PRICE BOARD';rows.push(staleSafe({...r,tier,blocker:r.blocker||'Loose direct discovery; exact verification required before promotion'}));}
for(const r of s.oneWayPlayerPropScreens||[]) rows.push(staleSafe({tier:'SCREENING',sport:r.sport,match:r.match||null,target:r.player||null,market:r.marketLabel||'Player Prop',marketKey:'player_prop',line:r.line??null,scope:r.scope||null,thunderpick:r.thunderpick??null,outside:[{book:r.book,price:r.outsidePrice}],independentSources:1,estimatedEV:null,startTime:r.startTime||null,blocker:r.blocker||'one-way outside quote; discovery only'}));
for(const r of s.playerPropInventory||[]) rows.push(staleSafe({tier:'INFORMATIONAL',sport:r.sport,match:r.match||null,target:r.player||null,market:r.market||'Player Prop',marketKey:'player_prop',line:r.line??null,scope:r.scope||null,thunderpick:r.thunderpick??null,outside:[],independentSources:0,estimatedEV:null,startTime:r.startTime||null,blocker:r.blocker||'Thunderpick inventory; awaiting outside price'}));

const priority={ACTION:0,WATCH:1,SCREENING:2,'PRICE BOARD':3,INFORMATIONAL:4};
const best=new Map();
for(const r of rows){const k=key(r),old=best.get(k);if(!old||priority[r.tier]<priority[old.tier]||(priority[r.tier]===priority[old.tier]&&(r.estimatedEV??-99)>(old.estimatedEV??-99)))best.set(k,r)}
const dedup=[...best.values()].sort((a,b)=>(priority[a.tier]-priority[b.tier])||((b.estimatedEV??-99)-(a.estimatedEV??-99))||(b.independentSources-a.independentSources));
const tiers=['ACTION','WATCH','SCREENING','PRICE BOARD','INFORMATIONAL'];
const freshnessBySport=Object.fromEntries(Object.keys(tpMeta?.sports||{}).map(sp=>[sp,tpFreshForSport(sp)]));
const out={generatedAt:now,mode:'simple-discovery-first',rules:{action:'3+ independent exact sources and EV >= 2%, with fresh Thunderpick verification',watch:'2+ independent exact sources and EV >= 1%, with fresh Thunderpick price',screening:'1+ outside source and EV >= 0.25%, with fresh Thunderpick price; stale TP never shown as current',informational:'inventory/outside context only; stale Thunderpick price and EV are suppressed'},sourceHealth:{direct:direct.providerHealth||null,strictSnapshotHealthy:s.snapshotHealth?.healthy??s.snapshotHealthy??null,thunderpickFreshBySport:freshnessBySport,thunderpickQuotaExhausted:tpMeta?.quotaExhausted??null,thunderpickQuotaResetMonth:tpMeta?.quotaResetMonth??null},counts:Object.fromEntries(tiers.map(t=>[t,dedup.filter(r=>r.tier===t).length])),rows:dedup.slice(0,250)};
await fs.writeFile('data/simple-opportunity-latest.json',JSON.stringify(out,null,2));
console.log('SIMPLE_BOARD',out.counts,'rows',out.rows.length,'TP_FRESH',freshnessBySport);
