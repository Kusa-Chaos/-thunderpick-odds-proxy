import {normalizeObjectiveMarket} from './objective-market-normalizer.mjs';

function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function canon(v=''){
  return String(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/\b(team|esports|gaming|club)\b/g,' ').replace(/[^a-z0-9]+/g,'').trim();
}
function eventTeams(event={}){
  return [event.home??event.home_team??event?.teams?.home?.name??event?.market?.home?.name??null,
          event.away??event.away_team??event?.teams?.away?.name??event?.market?.away?.name??null].filter(Boolean).map(String);
}
function eventPair(event={}){return eventTeams(event).map(canon).sort().join('|');}
function eventLabel(event={}){return event.name||event.event||eventTeams(event).join(' vs ')||'unknown';}
function stateOf(event={}){return String(event.state||(event.isLive===true||event.live===true?'live':'prematch')).toLowerCase();}
function sourceFamily(raw=''){
  const s=String(raw).toLowerCase();
  if(s.includes('stake')||s.includes('oddin'))return 'stake-oddin';
  if(s.includes('unibet')||s.includes('kambi'))return 'unibet-kambi';
  if(s.includes('betway'))return 'betway';
  if(s.includes('cloudbet'))return 'cloudbet';
  if(s.includes('pinnacle'))return 'pinnacle';
  if(s.includes('bovada'))return 'bovada';
  if(s.includes('fanduel'))return 'fanduel';
  if(s.includes('draftkings'))return 'draftkings';
  if(s.includes('roobet'))return 'roobet';
  if(s.includes('kalshi'))return 'kalshi';
  if(s.includes('polymarket'))return 'polymarket';
  return s.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'unknown';
}

const TOTAL_FAMILIES=new Set(['total_towers','team_towers','total_barons','total_dragons','total_roshans','total_barracks','total_kills','team_kills']);
const LINE_FAMILIES=new Set([...TOTAL_FAMILIES,'race_to_kills']);

function rawOutcomes(market={}){return [...(market.outcomes||[]),...(market.selections||[])];}
function outcomePrice(o={}){for(const v of [o.price,o.odds]){const n=num(v);if(n>1)return n;}return null;}
function outcomeRole(o={},event={}){
  const name=String(o.name||o.label||'').trim();
  if(/^over\b/i.test(name)||String(o.type||'').toLowerCase()==='over')return {id:'over',label:'Over'};
  if(/^under\b/i.test(name)||String(o.type||'').toLowerCase()==='under')return {id:'under',label:'Under'};
  const teams=eventTeams(event);
  const c=canon(name);
  for(const t of teams){if(c===canon(t))return {id:canon(t),label:t};}
  if(String(o.type||'').toLowerCase()==='home'&&teams[0])return {id:canon(teams[0]),label:teams[0]};
  if(String(o.type||'').toLowerCase()==='away'&&teams[1])return {id:canon(teams[1]),label:teams[1]};
  return null;
}

export function extractObjectiveContract({sport='',source='',event={},market={}}={}){
  const normalized=normalizeObjectiveMarket({sport,source,event,market});
  if(!normalized)return null;
  if(LINE_FAMILIES.has(normalized.family)&&normalized.line===null)return null;
  const candidates=rawOutcomes(market).map(o=>({role:outcomeRole(o,event),price:outcomePrice(o)})).filter(x=>x.role&&x.price>1);
  const byId=new Map();
  for(const x of candidates)if(!byId.has(x.role.id))byId.set(x.role.id,{id:x.role.id,label:x.role.label,price:x.price});
  let sides=[];
  if(TOTAL_FAMILIES.has(normalized.family)){
    if(!byId.has('over')||!byId.has('under'))return null;
    sides=[byId.get('over'),byId.get('under')];
  }else{
    const ids=eventTeams(event).map(canon);
    if(ids.length!==2||!ids.every(id=>byId.has(id)))return null;
    sides=ids.map(id=>byId.get(id));
  }
  if(sides.length!==2||sides[0].id===sides[1].id)return null;
  return {
    sport:String(sport).toLowerCase(),source:sourceFamily(source),event:eventLabel(event),eventKey:eventPair(event),
    family:normalized.family,target:normalized.target?canon(normalized.target):'',targetLabel:normalized.target||null,
    map:normalized.map??null,line:normalized.line??null,state:stateOf(event),settlement:String(market.settlementScope||market.settlement||'standard').toLowerCase(),
    label:normalized.label,sides
  };
}

export function objectiveMatchKey(c={}){
  return [c.sport,c.eventKey,c.family,'target='+String(c.target||''),'map='+(c.map??''),'line='+(c.line??''),'state='+String(c.state||''),'settlement='+String(c.settlement||'')].join('|');
}

function quoteFrom(c){return {source:c.source,label:c.label,prices:Object.fromEntries(c.sides.map(s=>[s.id,s.price])),sideLabels:Object.fromEntries(c.sides.map(s=>[s.id,s.label]))};}
function devig(prices={}){
  const entries=Object.entries(prices).filter(([,p])=>Number(p)>1);
  if(entries.length!==2)return null;
  const inv=entries.map(([s,p])=>[s,1/Number(p)]),z=inv.reduce((n,[,p])=>n+p,0);
  if(!(z>0))return null;
  return Object.fromEntries(inv.map(([s,p])=>[s,p/z]));
}

export function compareObjectiveContractSets(thunderpick=[],outside=[]){
  const groups=new Map();
  for(const c of outside){if(!c)continue;const k=objectiveMatchKey(c);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c);}
  const rows=[];
  for(const tp of thunderpick){
    if(!tp)continue;
    const matches=groups.get(objectiveMatchKey(tp))||[];
    const tpIds=tp.sides.map(s=>s.id).sort().join('|');
    const bySource=new Map();
    for(const c of matches){
      if(c.source==='thunderpick')continue;
      if(c.sides.map(s=>s.id).sort().join('|')!==tpIds)continue;
      if(!bySource.has(c.source))bySource.set(c.source,c);
    }
    const exact=[...bySource.values()];
    if(!exact.length)continue;
    const outsideQuotes=exact.map(quoteFrom);
    const fairByQuote=outsideQuotes.map(q=>devig(q.prices)).filter(Boolean);
    const sideIds=tp.sides.map(s=>s.id);
    const fairProbabilities=Object.fromEntries(sideIds.map(id=>[id,fairByQuote.reduce((n,q)=>n+(q[id]||0),0)/fairByQuote.length]));
    const tpPrices=Object.fromEntries(tp.sides.map(s=>[s.id,s.price]));
    const ev=Object.fromEntries(sideIds.map(id=>[id,tpPrices[id]*fairProbabilities[id]-1]));
    let bestArb=null;
    for(const tpSide of sideIds){
      const other=sideIds.find(x=>x!==tpSide); if(!other)continue;
      let bestOutside=null;
      for(const q of outsideQuotes){const p=q.prices[other];if(p>1&&(!bestOutside||p>bestOutside.price))bestOutside={source:q.source,side:other,price:p};}
      if(!bestOutside)continue;
      const sum=1/tpPrices[tpSide]+1/bestOutside.price;
      const cand={thunderpickSide:tpSide,thunderpickPrice:tpPrices[tpSide],outsideSource:bestOutside.source,outsideSide:other,outsidePrice:bestOutside.price,reciprocalSum:sum,roi:1/sum-1};
      if(!bestArb||cand.reciprocalSum<bestArb.reciprocalSum)bestArb=cand;
    }
    rows.push({sport:tp.sport,event:tp.event,family:tp.family,target:tp.targetLabel,map:tp.map,line:tp.line,state:tp.state,settlement:tp.settlement,exactIdentity:true,thunderpick:{label:tp.label,prices:tpPrices,sideLabels:Object.fromEntries(tp.sides.map(s=>[s.id,s.label]))},outsideQuotes,independentOutsideSources:outsideQuotes.length,fairProbabilities,ev,bestArb});
  }
  return rows;
}

export {sourceFamily};
