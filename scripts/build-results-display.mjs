import fs from 'node:fs/promises';

const readJson=async(path,fallback={})=>{try{return JSON.parse(await fs.readFile(path,'utf8'))}catch{return fallback}};
const board=await readJson('data/simple-opportunity-latest.json',{});
const audit=await readJson('data/production-coverage-audit-latest.json',{});
const screen=await readJson('data/screen-latest.json',{});
const rows=Array.isArray(board.rows)?board.rows:[];
const actions=rows.filter(r=>r.tier==='ACTION');
const watches=rows.filter(r=>r.tier==='WATCH');
const screening=rows.filter(r=>r.tier==='SCREENING').sort((a,b)=>(b.estimatedEV??-99)-(a.estimatedEV??-99)||(b.independentSources??0)-(a.independentSources??0)).slice(0,12);
const screenRows=[...(screen.limitedExactComparisons||[]),...(screen.candidates||[])];
const norm=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const sameScope=(a,b)=>Number(a?.map||0)===Number(b?.map||0)&&Number(a?.round||0)===Number(b?.round||0);
const tpRows=s=>Array.isArray(s?.thunderpick)?s.thunderpick:[];
function screenMatch(r){
  return screenRows.find(s=>{
    const tp=tpRows(s);
    return String(s.eventId)===String(r.eventId)&&String(s.marketKey||'')===String(r.marketKey||'')&&sameScope(s.scope,r.scope)&&((r.line==null&&((tp[0]?.point??tp[1]?.point)==null))||tp.some(t=>Number(t?.point)===Number(r.line)))&&tp.some(t=>norm(t?.name)===norm(r.target||r.side));
  });
}
function displayRow(r){
  const sm=screenMatch(r); let idx=-1;
  if(sm) idx=tpRows(sm).findIndex(t=>norm(t?.name)===norm(r.target||r.side)&&((r.line==null&&t?.point==null)||Number(t?.point)===Number(r.line)));
  const raw=Array.isArray(r.outside)?r.outside:[];
  const outside=raw.map(o=>{
    let p=o.price??o.odds??o.decimal??null;
    if(!Number.isFinite(Number(p))&&idx>=0) p=idx===0?o.a:o.b;
    return {sourceFamily:o.sourceFamily??null,book:o.book??o.title??o.source??o.provider??o.name??null,price:Number.isFinite(Number(p))?Number(p):null,lastUpdate:o.lastUpdate??o.fetchedAt??null};
  });
  const bestOutside=outside.reduce((best,o)=>Number.isFinite(o.price)&&(best==null||o.price>best)?o.price:best,null);
  let fairProbability=r.fairProbability??r.vigFreeFairProbability??null;
  if(fairProbability==null&&sm?.screenFair&&idx>=0) fairProbability=idx===0?sm.screenFair.aProbability:sm.screenFair.bProbability;
  const fairDecimal=Number(fairProbability)>0?1/Number(fairProbability):(r.fairDecimal??r.vigFreeFairDecimal??r.fairOdds??null);
  return {tier:r.tier,sport:r.sport,eventId:r.eventId??null,match:r.match??null,target:r.target??null,side:r.side??null,market:r.market??null,marketKey:r.marketKey??null,line:r.line??null,scope:r.scope??null,state:r.state??null,settlementScope:r.settlementScope??null,identity:r.identity??null,identityKey:r.identityKey??null,identityComplete:r.identityComplete===true,thunderpick:r.thunderpick??null,outside,bestOutside,independentSources:r.independentSources??0,fairProbability,fairDecimal,estimatedEV:r.estimatedEV??null,startTime:r.startTime??null,blocker:r.blocker??null};
}
const displayed=[...actions,...watches,...screening].map(displayRow);
const identityErrors=rows.filter(r=>(r.tier==='ACTION'||r.tier==='WATCH')&&r.identityComplete!==true).length;
const priceErrors=displayed.filter(r=>!Number.isFinite(Number(r.thunderpick))||((r.tier==='ACTION'||r.tier==='WATCH')&&r.outside.some(o=>!Number.isFinite(Number(o.price))))).length;
const out={generatedAt:board.generatedAt??null,builtAt:new Date().toISOString(),mode:'compact-results-delivery-v3-priced',counts:board.counts??{},parseErrors:{identity:identityErrors,price:priceErrors},actionRows:displayed.slice(0,actions.length),watchRows:displayed.slice(actions.length,actions.length+watches.length),screeningRows:displayed.slice(actions.length+watches.length),coverageAudit:board.coverageAudit??{},productionCoverageStatus:audit.status??null,productionCoverageFailures:audit.failures??[],sourceHealth:board.sourceHealth??null};
await fs.writeFile('data/simple-opportunity-display-latest.json',JSON.stringify(out,null,2));
console.log('RESULTS_DISPLAY',{generatedAt:out.generatedAt,action:out.actionRows.length,watch:out.watchRows.length,screening:out.screeningRows.length,parseErrors:out.parseErrors});