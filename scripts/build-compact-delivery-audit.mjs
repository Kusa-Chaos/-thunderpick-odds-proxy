import fs from 'node:fs/promises';
const SPORTS=['american-football','baseball','basketball','soccer','tennis','cs2','dota2','lol','valorant'];
const NUMBER_FIELDS=['events','tpMarkets','deepMarkets','deepSelectedEvents','deepSuccessfulEvents','deepFailedEvents','exact1Source','exact2Source','exact3Plus','objectiveContracts','action','watch','screening','identityIncomplete'];
const SOURCE_FIELDS=['ok','usable','status','state','events','markets','acceptedEvents','acceptedMarkets','marketCount','fetchedAt','generatedAt','fetchSelected','fetchSuccessful','fetchFailed'];
const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
export function buildCompactDeliveryAudit(board={}){
 if(!board.generatedAt||!Number.isFinite(Date.parse(board.generatedAt)))throw new Error('delivery audit requires a valid board generatedAt');
 const source=board.sourceHealth?.direct||{};
 if(!Object.keys(source).length)throw new Error('delivery audit requires sourceHealth.direct');
 const sportAudit=board.coverageAudit||{};
 const missing=SPORTS.filter(sp=>!sportAudit[sp]||typeof sportAudit[sp]!=='object');
 if(missing.length)throw new Error('nine-sport coverage missing: '+missing.join(','));
 const coverageAudit=Object.fromEntries(SPORTS.map(sp=>[sp,Object.fromEntries(NUMBER_FIELDS.map(k=>[k,numeric(sportAudit[sp][k])]))]));
 const sourceHealth=Object.fromEntries(Object.entries(source).map(([name,v])=>{
  const q=v&&typeof v==='object'?v:{};
  const vals=Object.fromEntries(SOURCE_FIELDS.filter(k=>Object.hasOwn(q,k)).map(k=>[k,q[k]]));
  return [name,{...vals,errors:Array.isArray(q.errors)?q.errors.slice(0,2).map(e=>String(e).slice(0,125)):[]}];
 }));
 const a=board.arbitrageAudit||{};
 const arb=Object.fromEntries(['marketsTested','screensEvaluated','rejectedIncomplete'].map(k=>[k,numeric(a[k])]));
 const informational=Object.fromEntries(Object.entries(board.informationalBreakdown||{}).filter(([k,v])=>k.length<80&&typeof v==='number'&&Number.isFinite(v)).slice(0,40));
 return {
  generatedAt:board.generatedAt,
  builtAt:board.builtAt??null,
  auditGeneratedAt:new Date().toISOString(),
  mode:'tiny-delivery-audit-v1',
  health:{
   strictSnapshotHealthy:board.strictSnapshotHealthy===true,
   productionCoverageStatus:board.productionCoverageStatus??null,
   productionCoverageFailures:(board.productionCoverageFailures||[]).slice(0,9).map(v=>String(v).slice(0,125)),
   parseErrors:{identity:numeric(board.parseErrors?.identity),price:numeric(board.parseErrors?.price)}
  },
  counts:board.counts||{},
  coverageAudit,
  objectiveAudit:Object.fromEntries(['dota2','lol'].map(sp=>[sp,Object.fromEntries(['objectiveContracts','exact1Source','exact2Source','exact3Plus','action','watch','screening'].map(k=>[k,coverageAudit[sp][k]]))])),
  sourceHealth,
  arbitrageAudit:{...arb,arbFound:Array.isArray(a.found)?a.found.length:null,arbWatch:Array.isArray(a.watch)?a.watch.length:null,arbScreening:Array.isArray(a.screening)?a.screening.length:null},
  informationalBreakdown:informational
 };
}
if(process.argv[1]?.endsWith('/build-compact-delivery-audit.mjs')){
 const input=JSON.parse(await fs.readFile('data/simple-opportunity-display-latest.json','utf8'));
 const out=buildCompactDeliveryAudit(input);
 const json=JSON.stringify(out);
 if(json.length>16000)throw new Error('Compact delivery audit exceeded 16 KB limit: '+json.length);
 await fs.writeFile('data/simple-delivery-audit-latest.json',json);
 console.log('COMPACT_DELIVERY_AUDIT',JSON.stringify({generatedAt:out.generatedAt,bytes:json.length,sports:Object.keys(out.coverageAudit).length,sources:Object.keys(out.sourceHealth).length}));
}