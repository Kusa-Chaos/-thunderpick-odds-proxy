import fs from 'node:fs/promises';

const s=JSON.parse(await fs.readFile('data/screen-latest.json','utf8'));
const now=new Date().toISOString();
const rows=[];
const key=r=>[r.sport,r.eventId||r.match||r.name,r.marketKey,r.marketLabel||r.market,r.scope?.map??'',r.scope?.round??'',r.target||''].join('|');

function add(r){
  const evA=Number(r?.screenEV?.a ?? r?.ev?.a);
  const evB=Number(r?.screenEV?.b ?? r?.ev?.b);
  const ev=Math.max(Number.isFinite(evA)?evA:-99,Number.isFinite(evB)?evB:-99);
  const tpA=r?.thunderpick?.[0]||r?.thunderpick?.a;
  const tpB=r?.thunderpick?.[1]||r?.thunderpick?.b;
  const target=evA>=evB?tpA:tpB;
  const sources=Number(r.independentSources??r.verifiedIndependentSources??0);
  // Discovery is deliberately permissive. Money-facing ACTION still requires
  // an exact normalized contract and 3+ independent sources.
  let tier='INFORMATIONAL';
  if(sources>=3 && ev>=0.02) tier='ACTION';
  else if(sources>=2 && ev>=0.01) tier='WATCH';
  else if(sources>=1 && ev>=0.0025) tier='SCREENING';
  else if(sources>=1) tier='PRICE BOARD';
  rows.push({tier,sport:r.sport,match:r.name||r.match||null,target:target?.name||r.target||r.player||null,market:r.marketLabel||r.market||r.marketKey||null,marketKey:r.marketKey||null,line:target?.point??r.line??null,scope:r.scope||null,thunderpick:target?.odds??r.thunderpick??null,outside:(r.outside||[]).slice(0,10),independentSources:sources,estimatedEV:Number.isFinite(ev)&&ev>-90?ev:null,startTime:r.startTime||null,blocker:r.blocker||null});
}

for(const r of s.limitedExactComparisons||[]) add(r);
for(const r of s.candidates||[]) add(r);
for(const r of s.oneWayPlayerPropScreens||[]) rows.push({tier:'SCREENING',sport:r.sport,match:r.match||null,target:r.player||null,market:r.marketLabel||'Player Prop',marketKey:'player_prop',line:r.line??null,scope:r.scope||null,thunderpick:r.thunderpick??null,outside:[{book:r.book,price:r.outsidePrice}],independentSources:1,estimatedEV:null,startTime:r.startTime||null,blocker:r.blocker||'one-way outside quote; discovery only'});
for(const r of s.playerPropInventory||[]) rows.push({tier:'INFORMATIONAL',sport:r.sport,match:r.match||null,target:r.player||null,market:r.market||'Player Prop',marketKey:'player_prop',line:r.line??null,scope:r.scope||null,thunderpick:r.thunderpick??null,outside:[],independentSources:0,estimatedEV:null,startTime:r.startTime||null,blocker:r.blocker||'Thunderpick inventory; awaiting outside price'});

const priority={ACTION:0,WATCH:1,SCREENING:2,'PRICE BOARD':3,INFORMATIONAL:4};
const dedup=[...new Map(rows.map(r=>[key(r),r])).values()].sort((a,b)=>(priority[a.tier]-priority[b.tier])||((b.estimatedEV??-99)-(a.estimatedEV??-99))||(b.independentSources-a.independentSources));
const out={generatedAt:now,mode:'simple-discovery-first',rules:{action:'3+ independent exact sources and EV >= 2%',watch:'2+ independent exact sources and EV >= 1%',screening:'1+ outside source and EV >= 0.25% or one-way semantic match',informational:'Thunderpick inventory with no outside quote'},counts:Object.fromEntries(['ACTION','WATCH','SCREENING','PRICE BOARD','INFORMATIONAL'].map(t=>[t,dedup.filter(r=>r.tier===t).length])),rows:dedup.slice(0,250)};
await fs.writeFile('data/simple-opportunity-latest.json',JSON.stringify(out,null,2));
console.log('SIMPLE_BOARD',out.counts,'rows',out.rows.length);
