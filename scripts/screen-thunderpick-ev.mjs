import fs from 'node:fs/promises';

const tp=JSON.parse(await fs.readFile('data/owls-latest.json','utf8'));
const cmp=JSON.parse(await fs.readFile('data/owls-comparison-latest.json','utf8'));
let meta=null; try{meta=JSON.parse(await fs.readFile('data/owls-meta.json','utf8'));}catch{}
const SPORTS=['cs2','dota2','lol','valorant'];
const now=Date.now(), horizon=now+15*24*3600e3;

const aliases=new Map([
 ['natusvincere','navi'],['navi','navi'],['jd','jd'],['jdg','jd'],['jdgaming','jd'],
 ['invictus','invictus'],['invictusgaming','invictus'],['teamvitality','vitality'],['vitality','vitality'],
 ['furiaesports','furia'],['furia','furia'],['mibr','mibr'],['m80','m80'],['gamerlegion','gamerlegion'],
 ['shopifyrebelliongold','shopifyrebelliongold'],['flyquestred','flyquestred']
]);
function norm(s=''){
 let x=String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'and').replace(/\b(team|esports|gaming|club)\b/g,'').replace(/[^a-z0-9]/g,'');
 return aliases.get(x)||x;
}
function stripLine(s=''){return String(s).replace(/\s*\([+-]?\d+(?:\.\d+)?\)\s*$/,'').replace(/\s+[+-]\d+(?:\.\d+)?\s*$/,'').trim();}
function pairKey(a,b){return [norm(a),norm(b)].sort().join('|');}
function tpEvents(sport){return tp?.sports?.[sport]?.data?.data||[];}
function outsideEvents(sport){
 const data=cmp?.sports?.[sport]?.data||{}; const out=[];
 for(const [book,events] of Object.entries(data)){if(Array.isArray(events))for(const e of events)out.push({book,event:e});}
 return out;
}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function close(a,b,tol=.001){return a==null||b==null?true:Math.abs(Number(a)-Number(b))<=tol;}
function extractPoint(sel={}){
 for(const v of [sel.point,sel.handicap,sel.line]){const x=n(v);if(x!=null)return x;}
 const name=String(sel.name||'');
 let m=name.match(/\(([+-]?\d+(?:\.\d+)?)\)\s*$/); if(m)return Number(m[1]);
 m=name.match(/\b(?:over|under)\s*([+-]?\d+(?:\.\d+)?)/i); if(m)return Number(m[1]);
 m=name.match(/\s([+-]\d+(?:\.\d+)?)\s*$/); return m?Number(m[1]):null;
}
function scopeFromText(text=''){
 const map=String(text).match(/\bmap\s*(\d+)\b/i); const round=String(text).match(/\bround\s*(\d+)\b/i);
 return {map:map?Number(map[1]):null,round:round?Number(round[1]):null};
}
function classifyMarket(m={}){
 const text=`${m.nickName||''} ${m.name||''}`.toLowerCase();
 if(/round/.test(text)&&/(handicap|spread)/.test(text))return 'round_handicap';
 if(/round/.test(text)&&/total/.test(text))return 'round_totals';
 if(/map/.test(text)&&/(handicap|spread)/.test(text))return 'spreads';
 if((/total\s*maps?/.test(text)||(/map/.test(text)&&/total/.test(text))))return 'totals';
 if(/map/.test(text)&&/winner/.test(text))return 'map_winner';
 if(/winner|moneyline/.test(text)&&!(/map|round/.test(text)))return 'h2h';
 return null;
}
function makeSelections(m,key,e){
 const raw=(m.selections||[]).filter(s=>n(s.odds)>1);
 if(raw.length<2)return null;
 if(key==='totals'||key==='round_totals'){
  const over=raw.find(s=>/^over\b/i.test(String(s.name||''))||String(s.type||'').toLowerCase()==='over');
  const under=raw.find(s=>/^under\b/i.test(String(s.name||''))||String(s.type||'').toLowerCase()==='under');
  if(!over||!under)return null;
  return [over,under].map(s=>({name:s.name,role:/^over/i.test(String(s.name||''))?'over':'under',odds:n(s.odds),point:extractPoint(s)}));
 }
 const homeName=e?.teams?.home?.name||e?.market?.home?.name; const awayName=e?.teams?.away?.name||e?.market?.away?.name;
 const home=raw.find(s=>norm(stripLine(s.name))===norm(homeName)||String(s.type||'').toLowerCase()==='home');
 const away=raw.find(s=>norm(stripLine(s.name))===norm(awayName)||String(s.type||'').toLowerCase()==='away');
 if(home&&away)return [home,away].map((s,i)=>({name:s.name,role:i===0?'home':'away',odds:n(s.odds),point:extractPoint(s)}));
 if((key==='map_winner'||key==='h2h')&&raw.length===2)return raw.slice(0,2).map((s,i)=>({name:s.name,role:i===0?'side1':'side2',odds:n(s.odds),point:null}));
 return null;
}
function tpMarkets(e){
 const out=[];
 if(n(e?.market?.home?.odds)>1&&n(e?.market?.away?.odds)>1){
  out.push({key:'h2h',label:'Match Winner',source:'root',scope:{map:null,round:null},selections:[
   {name:e.market.home.name,role:'home',odds:n(e.market.home.odds),point:null},
   {name:e.market.away.name,role:'away',odds:n(e.market.away.odds),point:null}
  ]});
 }
 for(const m of e?.preferredMarkets||[]){
  const key=classifyMarket(m); if(!key)continue;
  const selections=makeSelections(m,key,e); if(!selections)continue;
  const label=m.nickName||m.name||key; const scope=scopeFromText(`${m.nickName||''} ${m.name||''}`);
  out.push({key,label,source:'preferred',scope,selections});
 }
 const seen=new Set();
 return out.filter(m=>{const k=`${m.key}|${m.label}|${m.selections.map(s=>`${norm(s.name)}:${s.odds}:${s.point}`).join('|')}`;if(seen.has(k))return false;seen.add(k);return true;});
}
function outsideMarket(event,key){
 for(const bm of event?.bookmakers||[]){
  const markets=(bm.markets||[]).filter(m=>m.key===key);
  if(markets.length)return markets.map(m=>({bookmaker:bm.key||bm.title,market:m}));
 }
 return [];
}
function outsideScope(m={}){return scopeFromText(`${m.name||''} ${m.title||''} ${m.description||''} ${m.specifiers||''}`);}
function findOutcome(outcomes,sel,key){
 if(key==='totals'||key==='round_totals'){
  return outcomes.find(o=>String(o.name||'').toLowerCase()===sel.role&&close(n(o.point),sel.point));
 }
 return outcomes.find(o=>norm(stripLine(o.name))===norm(stripLine(sel.name))&&close(n(o.point),sel.point));
}
function quoteFor(row,d){
 const candidates=outsideMarket(row.event,d.key); const found=[];
 for(const c of candidates){
  const outs=c.market?.outcomes||[]; if(outs.length<2)continue;
  const a=findOutcome(outs,d.selections[0],d.key), b=findOutcome(outs,d.selections[1],d.key); if(!a||!b)continue;
  const pa=n(a.price),pb=n(b.price); if(!(pa>1&&pb>1))continue;
  const os=outsideScope(c.market);
  let identityVerified=true,identityReason=null;
  if((d.key==='map_winner'||d.key==='round_totals'||d.key==='round_handicap')&&(d.scope.map!=null||d.scope.round!=null)){
   if((d.scope.map!=null&&os.map==null)||(d.scope.round!=null&&os.round==null)){identityVerified=false;identityReason='outside normalized market lacks map/round scope; raw-source verification required';}
   else if(!close(d.scope.map,os.map,0)||!close(d.scope.round,os.round,0)){continue;}
  }
  found.push({book:row.book||c.bookmaker,a:pa,b:pb,identityVerified,identityReason,lastUpdate:c.market?.last_update||null});
 }
 return found;
}
function arbDetector(d,outside){
 const combos=[]; const [a,b]=d.selections;
 for(const q of outside){
  if(q.b>1&&a.odds>1){const sum=1/a.odds+1/q.b;combos.push({thunderpickSide:a.name,thunderpickOdds:a.odds,outsideSide:b.name,outsideOdds:q.b,outsideBook:q.book,arbSum:sum,grossRoi:1/sum-1,identityVerified:q.identityVerified,identityReason:q.identityReason});}
  if(q.a>1&&b.odds>1){const sum=1/b.odds+1/q.a;combos.push({thunderpickSide:b.name,thunderpickOdds:b.odds,outsideSide:a.name,outsideOdds:q.a,outsideBook:q.book,arbSum:sum,grossRoi:1/sum-1,identityVerified:q.identityVerified,identityReason:q.identityReason});}
 }
 combos.sort((x,y)=>x.arbSum-y.arbSum); const best=combos[0]||null;
 return best?{...best,trueArb:best.arbSum<1,nearArb:best.arbSum>=1&&best.arbSum<=1.005}:null;
}

const all=[]; let eligibleEvents=0,matchedEvents=0,eligibleMarkets=0,matchedMarkets=0; const matchedEventIds=new Set();
const eligibleBySport={},matchedBySport={},marketTypeCounts={};
for(const sport of SPORTS){
 eligibleBySport[sport]=0;matchedBySport[sport]=0;
 const idx=new Map();
 for(const row of outsideEvents(sport)){const e=row.event;if(e.status&&e.status!=='scheduled')continue;const k=pairKey(e.home_team,e.away_team);if(!idx.has(k))idx.set(k,[]);idx.get(k).push(row);}
 for(const e of tpEvents(sport)){
  const t=Date.parse(e.startTime);if(!Number.isFinite(t)||t<now||t>horizon||e.isLive)continue;
  const markets=tpMarkets(e);if(!markets.length)continue;eligibleEvents++;eligibleBySport[sport]++;
  const rows=idx.get(pairKey(e.teams?.home?.name||e.market?.home?.name,e.teams?.away?.name||e.market?.away?.name))||[];
  let eventMatched=false;
  for(const d of markets){
   eligibleMarkets++;marketTypeCounts[d.key]??={eligible:0,matched:0,candidates:0};marketTypeCounts[d.key].eligible++;
   const outside=[];for(const row of rows)outside.push(...quoteFor(row,d));
   if(!outside.length)continue;
   matchedMarkets++;marketTypeCounts[d.key].matched++;eventMatched=true;
   const fair=outside.map(q=>{const ia=1/q.a,ib=1/q.b,z=ia+ib;return{book:q.book,a:ia/z,b:ib/z,identityVerified:q.identityVerified};});
   const usableFair=fair.filter(x=>x.identityVerified); const base=usableFair.length?usableFair:fair;
   const pA=base.reduce((s,x)=>s+x.a,0)/base.length,pB=base.reduce((s,x)=>s+x.b,0)/base.length;
   const evA=d.selections[0].odds*pA-1,evB=d.selections[1].odds*pB-1;const arbScreen=arbDetector(d,outside);
   const identityVerified=outside.some(q=>q.identityVerified);
   const row={sport,eventId:e.id,name:e.name,startTime:e.startTime,marketKey:d.key,marketLabel:d.label,scope:d.scope,thunderpick:{a:d.selections[0],b:d.selections[1]},sourceDepth:outside.length,verifiedIdentityDepth:outside.filter(q=>q.identityVerified).length,outside,fair:{aProbability:pA,bProbability:pB,aOdds:1/pA,bOdds:1/pB},ev:{a:evA,b:evB},arbScreen,identityVerified,plausible:Math.max(evA,evB)>=-0.01||Boolean(arbScreen?.trueArb||arbScreen?.nearArb)};
   if(row.plausible)marketTypeCounts[d.key].candidates++;all.push(row);
  }
  if(eventMatched){matchedEventIds.add(`${sport}:${e.id}`);matchedBySport[sport]++;}
 }
}
matchedEvents=matchedEventIds.size;
all.sort((x,y)=>Math.max(y.ev.a,y.ev.b)-Math.max(x.ev.a,x.ev.b));
const arbScreens=all.filter(x=>x.arbScreen?.trueArb||x.arbScreen?.nearArb).sort((a,b)=>a.arbScreen.arbSum-b.arbScreen.arbSum);
const snapshotHealth={manifestPresent:Boolean(meta),generatedAt:meta?.generatedAt||tp.generatedAt||null,snapshotBytes:meta?.snapshotBytes??null,successfulSports:meta?.successfulSports||tp.successfulSports||[],failedSports:meta?.failedSports||tp.failedSports||[],totalEvents:meta?.totalEvents??null,totalRetainedMarkets:meta?.totalRetainedMarkets??null,sportEventCounts:Object.fromEntries(Object.entries(meta?.sports||{}).map(([sport,row])=>[sport,row?.eventCount??null])),healthy:Boolean((meta?.generatedAt||tp.generatedAt)&&!(meta?.failedSports||tp.failedSports||[]).length)};
const output={generatedAt:new Date().toISOString(),thunderpickGeneratedAt:tp.generatedAt,comparisonGeneratedAt:cmp.generatedAt,horizonDays:15,snapshotHealth,eligibleThunderpickEvents:eligibleEvents,matchedEvents,unmatchedEvents:eligibleEvents-matchedEvents,eligibleMarkets,matchedMarkets,unmatchedMarkets:eligibleMarkets-matchedMarkets,eligibleBySport,matchedBySport,marketTypeCounts,arbitrageMarketsTested:matchedMarkets,arbScreenCount:arbScreens.length,arbScreens,candidates:all.filter(x=>x.plausible),topScreens:all.slice(0,100)};
await fs.writeFile('data/screen-latest.json',JSON.stringify(output,null,2));
console.log(`Eligible events=${eligibleEvents}, matched events=${matchedEvents}, eligible markets=${eligibleMarkets}, matched markets=${matchedMarkets}, candidates=${output.candidates.length}, arbScreens=${arbScreens.length}, snapshotHealthy=${snapshotHealth.healthy}`);
