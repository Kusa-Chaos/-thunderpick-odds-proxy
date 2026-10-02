import fs from 'node:fs/promises';
import {exactIdentity,exactKey,identityComplete,canonSport} from './market-identity.mjs';
import {promoteObjectiveComparison} from './objective-market-promotion.mjs';

const TIERS=['ACTION','WATCH','SCREENING','PRICE BOARD','INFORMATIONAL'];
const priority={ACTION:0,WATCH:1,SCREENING:2,'PRICE BOARD':3,INFORMATIONAL:4};
const readJson=async(path,fallback={})=>{try{return JSON.parse(await fs.readFile(path,'utf8'))}catch{return fallback}};

function normalized(row={}){
  const identity=exactIdentity(row);
  return {...row,sport:identity.sport,identity,identityKey:exactKey(row),identityComplete:identityComplete(row)};
}
function chooseBetter(a,b){
  if(!a)return b;if(!b)return a;
  const pa=priority[a.tier]??99,pb=priority[b.tier]??99;
  if(pb<pa)return b;if(pa<pb)return a;
  const ea=Number(a.estimatedEV),eb=Number(b.estimatedEV);
  if(Number.isFinite(eb)&&(!Number.isFinite(ea)||eb>ea))return b;
  if((b.independentSources||0)>(a.independentSources||0))return b;
  return a;
}
function recomputeCoverage(board,rows){
  const audit={...(board.coverageAudit||{})};
  const sports=new Set([...Object.keys(audit),...rows.map(r=>canonSport(r.sport)).filter(Boolean)]);
  for(const sp of sports){
    const rr=rows.filter(r=>canonSport(r.sport)===sp);
    const old=audit[sp]||{};
    audit[sp]={...old,
      exact1Source:rr.filter(r=>r.identityComplete&&Number(r.independentSources)===1).length,
      exact2Source:rr.filter(r=>r.identityComplete&&Number(r.independentSources)===2).length,
      exact3Plus:rr.filter(r=>r.identityComplete&&Number(r.independentSources)>=3).length,
      action:rr.filter(r=>r.tier==='ACTION').length,
      watch:rr.filter(r=>r.tier==='WATCH').length,
      screening:rr.filter(r=>r.tier==='SCREENING').length,
      identityIncomplete:rr.filter(r=>!r.identityComplete).length,
      objectiveContracts:rr.filter(r=>r.objectiveMarket===true).length
    };
  }
  return audit;
}

export function mergeObjectiveRowsIntoBoard({board={},objectiveRows=[]}={}){
  const map=new Map();
  for(const raw of board.rows||[]){const r=raw.identity&&raw.identityKey?raw:normalized(raw);map.set(r.identityKey,chooseBetter(map.get(r.identityKey),r));}
  for(const raw of objectiveRows||[]){const r=normalized(raw);if(!r.identityComplete&&r.tier!=='INFORMATIONAL')r.tier='INFORMATIONAL';map.set(r.identityKey,chooseBetter(map.get(r.identityKey),r));}
  const rows=[...map.values()].sort((a,b)=>(priority[a.tier]??99)-(priority[b.tier]??99)||(Number(b.estimatedEV??-99)-Number(a.estimatedEV??-99))||(Number(b.independentSources||0)-Number(a.independentSources||0)));
  const counts=Object.fromEntries(TIERS.map(t=>[t,rows.filter(r=>r.tier===t).length]));
  return {...board,counts,rows:rows.slice(0,500),coverageAudit:recomputeCoverage(board,rows),objectiveMarketPromotion:{enabled:true,rows:rows.filter(r=>r.objectiveMarket===true).length,generatedAt:new Date().toISOString()}};
}

async function main(){
  const boardPath=process.env.BOARD_FILE||'data/simple-opportunity-latest.json';
  const comparisonPath=process.env.OBJECTIVE_COMPARISON_FILE||'data/objective-market-comparison-latest.json';
  const board=await readJson(boardPath,{});
  if(!board.generatedAt)throw new Error('objective board merge requires existing generated board');
  const comparison=await readJson(comparisonPath,{sports:{}});
  const fresh=board?.sourceHealth?.thunderpickFreshBySport||{};
  const objectiveRows=promoteObjectiveComparison({comparison,tpFreshBySport:fresh,now:Date.now()});
  const out=mergeObjectiveRowsIntoBoard({board,objectiveRows});
  await fs.writeFile(boardPath,JSON.stringify(out,null,2));
  const byTier=Object.fromEntries(TIERS.map(t=>[t,objectiveRows.filter(r=>r.tier===t).length]));
  console.log('OBJECTIVE_MARKET_BOARD_MERGE',JSON.stringify({generatedAt:out.generatedAt,objectiveRows:objectiveRows.length,objectiveByTier:byTier,boardCounts:out.counts}));
}

if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href)await main();
