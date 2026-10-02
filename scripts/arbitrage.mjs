const valid=v=>Number.isFinite(Number(v))&&Number(v)>1;
const clean=v=>String(v??'').trim().toLowerCase();

export function contractGroupKey(r){
  if(r.eventKey) return r.eventKey;
  const i=r.identity||{};
  return [i.sport??r.sport,i.event??r.match,i.family??r.marketKey??r.market,i.stat,i.line??r.line,i.period,i.map??r.scope?.map,i.round??r.scope?.round,i.set,i.state??r.state??'prematch',i.settlement??r.settlementScope??'standard'].map(clean).join('|');
}

export function detectArbitrage(rows,{nearThreshold=1.01}={}){
  const groups=new Map();
  for(const r of rows||[]){
    if(r.identityComplete===false) continue;
    const key=contractGroupKey(r); if(!key) continue;
    const target=clean(r.identity?.target??r.target??r.side); if(!target) continue;
    const prices=[];
    if(valid(r.thunderpick)) prices.push({sourceFamily:'thunderpick',book:'Thunderpick',price:Number(r.thunderpick)});
    for(const o of r.outside||[]) if(valid(o.price??o.odds??o.decimal)) prices.push({sourceFamily:o.sourceFamily??o.book??o.source??'outside',book:o.book??o.title??o.source??o.sourceFamily??'Outside',price:Number(o.price??o.odds??o.decimal)});
    if(!prices.length) continue;
    prices.sort((a,b)=>b.price-a.price);
    const g=groups.get(key)||new Map();
    const prev=g.get(target); if(!prev||prices[0].price>prev.price) g.set(target,{target,...prices[0]});
    groups.set(key,g);
  }
  const out=[];
  for(const [identityGroup,outcomes] of groups){
    const legs=[...outcomes.values()];
    if(legs.length<2||legs.length>3) continue;
    const inverseSum=legs.reduce((s,l)=>s+1/l.price,0);
    if(inverseSum>nearThreshold) continue;
    const arbMargin=1/inverseSum-1;
    out.push({tier:inverseSum<1?'ARB FOUND':'ARB WATCH',identityGroup,inverseSum,arbMargin,legs,independentSourceFamilies:new Set(legs.map(l=>l.sourceFamily)).size});
  }
  return out.sort((a,b)=>a.inverseSum-b.inverseSum);
}
