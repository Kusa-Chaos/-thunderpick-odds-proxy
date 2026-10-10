import {canonicalBookmakerFamily,NEW_BOOKMAKER_FAMILIES} from './third-source-eligibility.mjs';
const SP = new Set([16,17,18,61]);
const ORDINALS={first:1,second:2,third:3,fourth:4,fifth:5};
const validPrice=v=>typeof v==='number'&&Number.isFinite(v)&&v>1&&v<100;
const activeQuote=(m,id)=>{const p=m?.outcomes?.[String(id)]?.players?.['0'];return p?.active===true&&validPrice(p.price)?p.price:null;};
function classify(meta){
 const name=String(meta?.marketName||''),period=String(meta?.period||'').toLowerCase(),type=String(meta?.marketType||'').toLowerCase();
 if(name==='Winner'&&period==='result'&&type==='moneyline')return {key:'h2h',name:'Match Winner',scope:{map:null,round:null},line:null};
 if(name==='Total Maps Over Under'&&period==='result'&&type==='totals'&&typeof meta.handicap==='number'&&Number.isFinite(meta.handicap)&&meta.handicap>0)
  return {key:'totals',name:'Total Maps',scope:{map:null,round:null},line:meta.handicap};
 const match=name.match(/^(First|Second|Third|Fourth|Fifth) Map Winner \(incl\. overtime\)$/i);
 const map=match?ORDINALS[match[1].toLowerCase()]:null;
 if(map&&period==='p'+map&&type==='moneyline')return {key:'map_winner',name:'Map '+map+' Winner',scope:{map,round:null},line:null};
 return null;
}
function selections(meta,quoted,kind,home,away){
 const dictionary=new Map((meta?.outcomes||[]).map(o=>[String(o.outcomeId),String(o.outcomeName||'')]));
 const wanted=kind==='totals'?['Over','Under']:['1','2'];
 const rows=[];
 for(const target of wanted){
  const matches=[...dictionary].filter(([,name])=>name.toLowerCase()===target.toLowerCase());
  if(matches.length!==1)return null;
  const price=activeQuote(quoted,matches[0][0]);
  if(price===null)return null;
  const name=kind==='totals'?target:target==='1'?home:away;
  rows.push({name,price,...(kind==='totals'?{point:meta.handicap}:{})});
 }
 return rows;
}
export function normalizeOddsPapiEvent(odds={},catalog=[],{fetchedAt=new Date().toISOString()}={}){
 const id=String(odds.fixtureId||'').trim(),home=String(odds.participant1Name||'').trim(),away=String(odds.participant2Name||'').trim();
 const start=odds.startTime;
 if(!id||!home||!away||home===away||Number(odds.statusId)!==0||!SP.has(Number(odds.sportId))||!Number.isFinite(Date.parse(start||''))||!Number.isFinite(Date.parse(fetchedAt||'')))return null;
 if(!Array.isArray(catalog)||!catalog.length)return null;
 const catalogById=new Map(catalog.map(m=>[String(m.marketId),m]));
 const candidates=new Map();
 for(const [slug,book] of Object.entries(odds.bookmakerOdds||{})){
  const family=canonicalBookmakerFamily(slug);
  if(!NEW_BOOKMAKER_FAMILIES.includes(family)||book?.bookmakerIsActive!==true||book?.suspended===true)continue;
  const markets=[];
  for(const [marketId,q] of Object.entries(book.markets||{})){
   if(q?.marketActive!==true)continue;
   const meta=catalogById.get(marketId),kind=classify(meta);
   if(!kind)continue;
   const outcomes=selections(meta,q,kind.key,home,away);
   if(!outcomes||outcomes.length!==2)continue;
   markets.push({...kind,last_update:fetchedAt,outcomes});
  }
  if(!markets.length)continue;
  const entry={key:'oddspapi-'+family,title:slug+' (OddsPapi)',sourceFamily:family,markets};
  const old=candidates.get(family);
  if(!old||String(slug).toLowerCase()===family.replace(/[^a-z0-9]/g,''))candidates.set(family,entry);
 }
 if(!candidates.size)return null;
 return {id:'oddspapi-direct:'+id,home_team:home,away_team:away,commence_time:start,live:false,bookmakers:[...candidates.values()]};
}
