import fs from 'node:fs/promises';

const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const screen=await read('data/screen-latest.json');
const board=await read('data/simple-opportunity-latest.json');
const display=await read('data/simple-opportunity-display-latest.json');

const tested=Number(screen.arbitrageMarketsTested||0);
const screens=Array.isArray(screen.arbScreens)?screen.arbScreens:[];
if(tested<=0) throw new Error(`expected arbitrage markets to be tested, got ${tested}`);
if(Number(screen.arbScreenCount||0)!==screens.length) throw new Error('screen arb count mismatch');
if(!board.arbitrageAudit) throw new Error('authoritative board missing arbitrageAudit');
if(Number(board.arbitrageAudit.marketsTested||0)!==tested) throw new Error('board arbitrage marketsTested mismatch');
const boardArbs=[...(board.arbitrageAudit.found||[]),...(board.arbitrageAudit.watch||[])];
if(boardArbs.length!==screens.length) throw new Error(`board persisted ${boardArbs.length} arb screens; expected ${screens.length}`);
const displayArbs=[...(display.arbFoundRows||[]),...(display.arbWatchRows||[])];
if(displayArbs.length!==screens.length) throw new Error(`display persisted ${displayArbs.length} arb screens; expected ${screens.length}`);
for(const a of board.arbitrageAudit.found||[]){
  const label=String(a.market||a.marketLabel||'');
  const missingSet=/\bset\s*\d+\b/i.test(label) && a.scope?.set==null;
  if(missingSet) throw new Error(`scope-incomplete set market promoted to ARB FOUND: ${label}`);
  if(!(Number(a.reciprocalSum)<1)) throw new Error('ARB FOUND reciprocal sum must be <1');
}
for(const a of boardArbs){
  const sum=Number(a.reciprocalSum);
  if(!Number.isFinite(sum)) throw new Error('arb row missing reciprocalSum');
  const roi=1/sum-1;
  if(Math.abs(roi-Number(a.arbROI))>1e-10) throw new Error('arb ROI formula mismatch');
}
console.log('ARB_PERSISTENCE_VERIFIED',{tested,screens:screens.length,found:(board.arbitrageAudit.found||[]).length,watch:(board.arbitrageAudit.watch||[]).length});
