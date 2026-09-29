import fs from 'node:fs/promises';

const readJson=async(path,fallback={})=>{try{return JSON.parse(await fs.readFile(path,'utf8'))}catch{return fallback}};
const board=await readJson('data/simple-opportunity-latest.json',{});
const audit=await readJson('data/production-coverage-audit-latest.json',{});
const screen=await readJson('data/screen-latest.json',{});
const rows=Array.isArray(board.rows)?board.rows:[];
const actions=rows.filter(r=>r.tier==='ACTION');
const watches=rows.filter(r=>r.tier==='WATCH');
const rank=(a,b)=>(b.estimatedEV??-99)-(a.estimatedEV??-99)||(b.independentSources??0)-(a.independentSources??0);
const screeningAll=rows.filter(r=>r.tier==='SCREENING').sort(rank);
const screening=screeningAll.slice(0,10);
const priceBoard=rows.filter(r=>r.tier==='PRICE BOARD').sort(rank).slice(0,3);
const informational=rows.filter(r=>r.tier==='INFORMATIONAL');
const screenRows=[...(screen.limitedExactComparisons||[]),...(screen.candidates||[]),...(screen.actionCandidates||[]),...(screen.watchCandidates||[]),...(screen.potentialCandidates||[])];
const norm=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const sameScope=(a,b)=>Number(a?.map||0)===Number(b?.map||0)&&Number(a?.round||0)===Number(b?.round||0);
const tpRows=s=>Array.isArray(s?.thunderpick)?s.thunderpick:(s?.thunderpick?.a||s?.thunderpick?.b?[s.thunderpick.a,s.thunderpick.b].filter(Boolean):[]);
const validDecimal=v=>Number.isFinite(Number(v))&&Number(v)>1;
function screenMatch(r){return screenRows.find(s=>{const tp=tpRows(s);return String(s.eventId)===String(r.eventId)&&String(s.marketKey||'')===String(r.marketKey||'')&&sameScope(s.scope,r.scope)&&((r.line==null&&((tp[0]?.point??tp[1]?.point)==null))||tp.some(t=>Number(t?.point)===Number(r.line)))&&tp.some(t=>norm(t?.name)===norm(r.target||r.side));});}
function displayRow(r){
  const sm=screenMatch(r); let idx=-1;
  if(sm) idx=tpRows(sm).findIndex(t=>norm(t?.name)===norm(r.target||r.side)&&((r.line==null&&t?.point==null)||Number(t?.point)===Number(r.line)));
  const raw=Array.isArray(r.outside)?r.outside:[];
  const outside=raw.map(o=>{let p=o.price??o.odds??o.decimal??null;if(!validDecimal(p)&&idx>=0){const sidePrice=idx===0?o.a:o.b;if(validDecimal(sidePrice)) p=sidePrice;else{const smOutside=Array.isArray(sm?.outside)?sm.outside:[];const source=norm(o.sourceFamily??o.book??o.title??o.source??o.provider??o.name);const matched=smOutside.find(x=>norm(x.sourceFamily??x.book??x.title??x.source??x.provider??x.name)===source)||smOutside.find(x=>source&&norm(x.sourceFamily??x.book??x.title??x.source??x.provider??x.name).includes(source))||smOutside.find(x=>{const sx=norm(x.sourceFamily??x.book??x.title??x.source??x.provider??x.name);return sx&&source&&(sx.includes(source)||source.includes(sx));});const recovered=idx===0?matched?.a:matched?.b;if(validDecimal(recovered)) p=recovered;}}return {sourceFamily:o.sourceFamily??null,book:o.book??o.title??o.source??o.provider??o.name??null,price:validDecimal(p)?Number(p):null,lastUpdate:o.lastUpdate??o.fetchedAt??null};});
  const bestOutside=outside.reduce((best,o)=>validDecimal(o.price)&&(best==null||o.price>best)?o.price:best,null);
  let fairProbability=r.fairProbability??r.vigFreeFairProbability??null;
  if(fairProbability==null&&idx>=0){if(sm?.screenFair) fairProbability=idx===0?sm.screenFair.aProbability:sm.screenFair.bProbability;else if(sm?.fair) fairProbability=idx===0?sm.fair.aProbability:sm.fair.bProbability;}
  const fairDecimal=Number(fairProbability)>0?1/Number(fairProbability):(r.fairDecimal??r.vigFreeFairDecimal??r.fairOdds??null);
  return {tier:r.tier,sport:r.sport,eventId:r.eventId??null,match:r.match??null,target:r.target??null,side:r.side??null,market:r.market??null,marketKey:r.marketKey??null,line:r.line??null,scope:r.scope??null,state:r.state??null,settlementScope:r.settlementScope??null,identity:r.identity??null,identityKey:r.identityKey??null,identityComplete:r.identityComplete===true,thunderpick:r.thunderpick??null,outside,bestOutside,independentSources:r.independentSources??0,fairProbability,fairDecimal,estimatedEV:r.estimatedEV??null,startTime:r.startTime??null,blocker:r.blocker??null};
}
const actionRows=actions.map(displayRow),watchRows=watches.map(displayRow),topScreeningRows=screening.map(displayRow),topPriceBoardRows=priceBoard.map(displayRow);
const familyOf=r=>r.marketKey||r.market||r.identity?.family||'unknown';
const informationalBreakdown=informational.reduce((acc,r)=>{const k=familyOf(r);acc[k]=(acc[k]||0)+1;return acc;},{});
const identityErrors=[...actionRows,...watchRows].filter(r=>r.identityComplete!==true).length;
const priceErrors=[...actionRows,...watchRows,...topScreeningRows].filter(r=>!validDecimal(r.thunderpick)||((r.tier==='ACTION'||r.tier==='WATCH')&&r.outside.some(o=>!validDecimal(o.price)))).length;
const expectedScreening=Math.min(10,Number(board.counts?.SCREENING||0));
if(topScreeningRows.length!==expectedScreening) throw new Error(`TOP SCREENING delivery mismatch expected=${expectedScreening} actual=${topScreeningRows.length}`);
for(const [i,r] of topScreeningRows.entries()){if(!norm(r.target||r.side)) throw new Error(`TOP SCREENING row ${i+1} missing target/side`);if(!validDecimal(r.thunderpick)) throw new Error(`TOP SCREENING row ${i+1} missing valid Thunderpick price`);}
const out={generatedAt:board.generatedAt??null,builtAt:new Date().toISOString(),mode:'compact-results-delivery-v6-h2h-price-recovery',counts:board.counts??{},parseErrors:{identity:identityErrors,price:priceErrors},actionRows,watchRows,topScreeningRows,screeningRows:topScreeningRows,topPriceBoardRows,informationalBreakdown,coverageAudit:board.coverageAudit??{},productionCoverageStatus:audit.status??null,productionCoverageFailures:audit.failures??[],sourceHealth:board.sourceHealth??null};
await fs.writeFile('data/simple-opportunity-display-latest.json',JSON.stringify(out,null,2));
console.log('RESULTS_DISPLAY',{generatedAt:out.generatedAt,action:actionRows.length,watch:watchRows.length,topScreening:topScreeningRows.length,topPriceBoard:topPriceBoardRows.length,informational:informational.length,parseErrors:out.parseErrors});
