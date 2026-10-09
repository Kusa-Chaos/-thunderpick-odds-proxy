const MAX_AGE_MS=40*60*1000;

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function sourceName(q={}){return String(q.source||q.sourceFamily||q.book||q.title||'unknown');}
function dedupeQuotes(quotes=[]){
  const by=new Map();
  for(const q of quotes){const s=sourceName(q);if(!s||s==='thunderpick')continue;if(!by.has(s))by.set(s,q);}
  return [...by.values()];
}
function bestSide(row={}){
  const prices=row?.thunderpick?.prices||{},labels=row?.thunderpick?.sideLabels||{},ev=row?.ev||{};
  const ids=Object.keys(prices).filter(id=>finite(prices[id])>1&&finite(ev[id])!==null);
  if(!ids.length)return null;
  ids.sort((a,b)=>Number(ev[b])-Number(ev[a]));
  const id=ids[0];
  return {id,label:labels[id]||id,price:Number(prices[id]),ev:Number(ev[id]),fair:finite(row?.fairProbabilities?.[id])};
}
function tierFor({sources,ev,fresh,exact}){
  if(!fresh||!exact)return'INFORMATIONAL';
  if(sources>=5&&ev>=0.02)return'ACTION';
  if(sources>=3&&ev>=0.01)return'WATCH';
  if(sources>=1&&ev>=0.0025)return'SCREENING';
  if(sources>=1)return'PRICE BOARD';
  return'INFORMATIONAL';
}

export function promoteObjectiveComparison({comparison={},tpFreshBySport={},now=Date.now(),maxAgeMs=MAX_AGE_MS}={}){
  const generated=Date.parse(comparison?.generatedAt||'');
  const comparisonFresh=Number.isFinite(generated)&&generated<=now&&(now-generated)<=maxAgeMs;
  const out=[];
  for(const sport of ['lol','dota2']){
    for(const row of comparison?.sports?.[sport]?.rows||[]){
      const best=bestSide(row);if(!best)continue;
      const quotes=dedupeQuotes(row.outsideQuotes||[]);
      const outside=quotes.map(q=>({
        sourceFamily:sourceName(q),book:sourceName(q),price:finite(q?.prices?.[best.id]),
        prices:q?.prices||null,lastUpdate:q?.lastUpdate??q?.fetchedAt??null
      })).filter(q=>q.price>1);
      const sources=outside.length;
      const fresh=comparisonFresh&&tpFreshBySport[sport]===true;
      const exact=row.exactIdentity===true;
      const tier=tierFor({sources,ev:best.ev,fresh,exact});
      const staleBlock=!comparisonFresh?'Objective comparison snapshot is stale':tpFreshBySport[sport]!==true?'Thunderpick objective inventory is not fully fresh':!exact?'Objective exact identity not verified':null;
      const sourceBlock=tier==='SCREENING'&&sources===1?'1 SOURCE — SCREENING ONLY':tier==='PRICE BOARD'?'Objective exact comparison below +EV screening threshold':sources===0?'No outside exact objective source':null;
      const fair=best.fair;
      out.push({
        tier,sport,eventId:null,match:row.event||null,target:row.target||null,side:String(best.id),
        market:row?.thunderpick?.label||row.family,marketKey:row.family,line:row.line??null,
        scope:{map:row.map??null,period:null,round:null,set:null},state:row.state||'prematch',
        settlementScope:row.settlement||'standard',
        thunderpick:fresh?best.price:null,outside,independentSources:sources,
        fairProbability:fresh?fair:null,fairDecimal:fresh&&fair>0?1/fair:null,
        bestOutside:outside.length?Math.max(...outside.map(x=>x.price)):null,
        estimatedEV:fresh?best.ev:null,startTime:null,
        objectiveMarket:true,exactObjectiveIdentity:exact,
        blocker:[staleBlock,sourceBlock].filter(Boolean).join('; ')||null
      });
    }
  }
  return out;
}

export {tierFor};
