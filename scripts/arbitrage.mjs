const valid=v=>Number.isFinite(Number(v))&&Number(v)>1;
const clean=v=>String(v??'').trim().toLowerCase();

const sideOutcomeFamilies=new Set(['player_prop','total','round_total']);
function familyOf(r={}){return clean(r.identity?.family??r.marketKey??r.market);}
function sideOutcomeFamily(r={}){return sideOutcomeFamilies.has(familyOf(r));}

export function contractGroupKey(r){
  const i=r.identity||{};
  const family=familyOf(r);
  // eventKey is safe for named-opponent markets, but side-based contracts need
  // their subject (player/team) retained in the group to prevent cross-player
  // or cross-team false arbitrage at the same line.
  if(r.eventKey&&!sideOutcomeFamilies.has(family)) return r.eventKey;
  const subject=sideOutcomeFamilies.has(family)?(i.target??r.contractTarget??r.team??''):'';
  return [i.sport??r.sport,i.event??r.match,family,i.stat,subject,i.line??r.line,i.period,i.map??r.scope?.map,i.round??r.scope?.round,i.set,i.state??r.state??'prematch',i.settlement??r.settlementScope??'standard'].map(clean).join('|');
}

function outcomeKey(r={}){
  const i=r.identity||{};
  if(sideOutcomeFamily(r)){
    const side=clean(i.side??r.side??r.selectionSide??r.target??r.selection);
    return side==='over'||side==='under'?side:'';
  }
  return clean(i.target??r.target??r.side);
}

export function detectArbitrage(rows,{nearThreshold=1.01}={}){
  const groups=new Map();
  for(const r of rows||[]){
    if(r.identityComplete===false) continue;
    const key=contractGroupKey(r); if(!key) continue;
    const target=outcomeKey(r); if(!target) continue;
    const prices=[];
    if(valid(r.thunderpick)) prices.push({sourceFamily:'thunderpick',book:'Thunderpick',price:Number(r.thunderpick)});
    for(const o of r.outside||[]) if(valid(o.price??o.odds??o.decimal)) prices.push({sourceFamily:o.sourceFamily??o.book??o.source??'outside',book:o.book??o.title??o.source??o.sourceFamily??'Outside',price:Number(o.price??o.odds??o.decimal)});
    if(!prices.length) continue;
    prices.sort((a,b)=>b.price-a.price);
    const g=groups.get(key)||{family:familyOf(r),sport:clean(r.identity?.sport??r.sport),outcomes:new Map()};
    const prev=g.outcomes.get(target); if(!prev||prices[0].price>prev.price) g.outcomes.set(target,{target,...prices[0]});
    groups.set(key,g);
  }
  const out=[];
  for(const [identityGroup,g] of groups){
    const legs=[...g.outcomes.values()];
    if(sideOutcomeFamilies.has(g.family)){
      const names=new Set(legs.map(x=>x.target));
      if(legs.length!==2||!names.has('over')||!names.has('under')) continue;
    }else{
      if(legs.length<2||legs.length>3) continue;
      // Match Winner in soccer is a three-way contract. Fail closed when Draw
      // is absent instead of manufacturing a two-leg arb from an incomplete set.
      if(g.family==='ml'&&g.sport==='soccer'){
        const names=new Set(legs.map(x=>x.target));
        if(legs.length!==3||![...names].some(x=>x==='draw'||x==='tie')) continue;
      }
    }
    const inverseSum=legs.reduce((s,l)=>s+1/l.price,0);
    if(inverseSum>nearThreshold) continue;
    const arbMargin=1/inverseSum-1;
    out.push({tier:inverseSum<1?'ARB FOUND':'ARB WATCH',identityGroup,inverseSum,arbMargin,legs,independentSourceFamilies:new Set(legs.map(l=>l.sourceFamily)).size});
  }
  return out.sort((a,b)=>a.inverseSum-b.inverseSum);
}
