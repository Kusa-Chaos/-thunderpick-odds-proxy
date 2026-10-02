import fs from 'node:fs/promises';

const readJson=async(path,fallback={})=>{try{return JSON.parse(await fs.readFile(path,'utf8'))}catch{return fallback}};
const valid=v=>Number.isFinite(Number(v))&&Number(v)>1;
const clean=v=>String(v??'').trim();
const familyFromBook=v=>{
  const x=String(v||'').toLowerCase();
  if(x.includes('unibet')||x.includes('kambi'))return'unibet-kambi';
  if(x.includes('stake')||x.includes('oddin'))return'stake-oddin';
  if(x.includes('draftkings'))return'draftkings';
  if(x.includes('fanduel'))return'fanduel';
  if(x.includes('bovada'))return'bovada';
  if(x.includes('pinnacle'))return'pinnacle';
  if(x.includes('betway'))return'betway';
  if(x.includes('cloudbet'))return'cloudbet';
  if(x.includes('kalshi'))return'kalshi';
  if(x.includes('polymarket'))return'polymarket';
  return x.replace(/[^a-z0-9]/g,'')||'unknown';
};
function explicitScope(screen={}){
  const scope={...(screen.scope||{})};
  const label=String(screen.marketLabel||screen.market||'');
  const setMatch=label.match(/\bset\s*(\d+)\b/i);
  const mapMatch=label.match(/\bmap\s*(\d+)\b/i);
  const roundMatch=label.match(/\bround\s*(\d+)\b/i);
  return {
    ...scope,
    set: scope.set??(setMatch?Number(setMatch[1]):null),
    map: scope.map??(mapMatch?Number(mapMatch[1]):null),
    round: scope.round??(roundMatch?Number(roundMatch[1]):null),
  };
}
function requiresExplicitScope(screen={}){
  const label=String(screen.marketLabel||screen.market||'');
  return {
    set:/\bset\s*\d+\b/i.test(label),
    map:/\bmap\s*\d+\b/i.test(label),
    round:/\bround\s*\d+\b/i.test(label),
  };
}
function normalize(screen={}){
  const arb=screen.arbScreen||{};
  const reciprocalSum=Number(arb.arbSum);
  if(!Number.isFinite(reciprocalSum)||reciprocalSum<=0||reciprocalSum>1.01) return null;
  const scope=explicitScope(screen);
  const req=requiresExplicitScope(screen);
  // A parsed label is not enough to prove the outside quote was actually scoped.
  // For promotion to ARB FOUND, the upstream comparison must have persisted the scope itself.
  const originalScope=screen.scope||{};
  const scopeComplete=(!req.set||originalScope.set!=null)&&(!req.map||originalScope.map!=null)&&(!req.round||originalScope.round!=null);
  const identityVerified=screen.identityVerified===true&&arb.identityVerified===true&&scopeComplete;
  const thunderpickPrice=Number(arb.thunderpickOdds);
  const outsidePrice=Number(arb.outsideOdds);
  if(!valid(thunderpickPrice)||!valid(outsidePrice)) return null;
  const roi=1/reciprocalSum-1;
  const outsideBook=clean(arb.outsideBook||'outside');
  const outsideFamily=familyFromBook(outsideBook);
  const outsideQuote=(screen.outside||[]).find(o=>String(o.book||'')===outsideBook)||{};
  const blocker=!scopeComplete?'Exact settlement scope not explicitly persisted by upstream comparator':(!identityVerified?'Exact identity verification incomplete':null);
  const tier=reciprocalSum<1&&identityVerified?'ARB FOUND':'ARB WATCH';
  return {
    tier,
    sport:screen.sport||null,
    eventId:screen.eventId??null,
    match:screen.name||screen.match||null,
    market:screen.marketLabel||screen.marketKey||null,
    marketKey:screen.marketKey||null,
    scope,
    startTime:screen.startTime||null,
    exactContractKey:screen.exactContractKey||null,
    reciprocalSum,
    arbROI:roi,
    independentOutsideSources:Number(screen.verifiedIndependentSources??screen.independentSources??0),
    sourceFamilies:['thunderpick',outsideFamily],
    freshness:{outsideLastUpdate:outsideQuote.lastUpdate??null},
    identityVerified,
    upstreamIdentityVerified:screen.identityVerified===true&&arb.identityVerified===true,
    blocker,
    legs:[
      {outcome:arb.thunderpickSide,book:'Thunderpick',sourceFamily:'thunderpick',price:thunderpickPrice},
      {outcome:arb.outsideSide,book:outsideBook,sourceFamily:outsideFamily,price:outsidePrice},
    ],
  };
}

const screen=await readJson('data/screen-latest.json',{});
const board=await readJson('data/simple-opportunity-latest.json',{});
if(!board.generatedAt) throw new Error('authoritative board missing generatedAt');
const rawScreens=Array.isArray(screen.arbScreens)?screen.arbScreens:[];
const normalized=rawScreens.map(normalize).filter(Boolean);
const found=normalized.filter(x=>x.tier==='ARB FOUND');
const watch=normalized.filter(x=>x.tier==='ARB WATCH');
const rejectedIncomplete=normalized.filter(x=>x.blocker).length;
board.strictSnapshotHealthy=board?.sourceHealth?.strictSnapshotHealthy===true;
board.arbitrageAudit={
  generatedAt:screen.generatedAt??null,
  marketsTested:Number(screen.arbitrageMarketsTested||0),
  screensEvaluated:rawScreens.length,
  found,
  watch,
  rejectedIncomplete,
};
board.counts={...(board.counts||{}),'ARB FOUND':found.length,'ARB WATCH':watch.length};
await fs.writeFile('data/simple-opportunity-latest.json',JSON.stringify(board,null,2));
console.log('ARBITRAGE_AUDIT_PERSISTED',{marketsTested:board.arbitrageAudit.marketsTested,screensEvaluated:rawScreens.length,found:found.length,watch:watch.length,rejectedIncomplete,strictSnapshotHealthy:board.strictSnapshotHealthy});
