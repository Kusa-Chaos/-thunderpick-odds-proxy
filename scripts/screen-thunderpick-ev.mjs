import fs from 'node:fs/promises';

const tp=JSON.parse(await fs.readFile('data/owls-latest.json','utf8'));
const cmp=JSON.parse(await fs.readFile('data/owls-comparison-latest.json','utf8'));
const SPORTS=['cs2','dota2','lol','valorant'];
const now=Date.now(), horizon=now+15*24*3600e3;

const aliases=new Map([
 ['natusvincere','navi'],['navi','navi'],['jd','jd'],['jdg','jd'],['jdgaming','jd'],
 ['invictus','invictus'],['invictusgaming','invictus'],['teamvitality','vitality'],['vitality','vitality'],
 ['furiaesports','furia'],['furia','furia'],['mibr','mibr'],['m80','m80'],['gamerlegion','gamerlegion'],
 ['shopifyrebelliongold','shopifyrebelliongold'],['flyquestred','flyquestred']
]);
function norm(s=''){
 let x=s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'and').replace(/\b(team|esports|gaming|club)\b/g,'').replace(/[^a-z0-9]/g,'');
 return aliases.get(x)||x;
}
function pairKey(a,b){return [norm(a),norm(b)].sort().join('|');}
function tpEvents(sport){return tp?.sports?.[sport]?.data?.data||[];}
function outsideEvents(sport){
 const data=cmp?.sports?.[sport]?.data||{}; const out=[];
 for(const [book,events] of Object.entries(data)){
  if(!Array.isArray(events)) continue;
  for(const e of events) out.push({book,event:e});
 }
 return out;
}
function h2h(e){
 for(const bm of e?.bookmakers||[]){
  const m=(bm.markets||[]).find(x=>x.key==='h2h');
  if(m?.outcomes?.length>=2) return {bookmaker:bm.key||bm.title, outcomes:m.outcomes};
 }
 return null;
}
function tpLine(e){
 const m=e?.market;
 if(m?.home?.odds&&m?.away?.odds) return {home:{name:m.home.name,odds:Number(m.home.odds)},away:{name:m.away.name,odds:Number(m.away.odds)}};
 const w=(e?.preferredMarkets||[]).find(m=>/winner/i.test(m.nickName||m.name||'')&&Array.isArray(m.selections)&&m.selections.length>=2);
 if(w){const home=w.selections.find(s=>s.type==='home')||w.selections[0], away=w.selections.find(s=>s.type==='away')||w.selections[1];return {home:{name:home.name,odds:Number(home.odds)},away:{name:away.name,odds:Number(away.odds)}};}
 return null;
}

const all=[]; let eligible=0, matched=0;
for(const sport of SPORTS){
 const idx=new Map();
 for(const row of outsideEvents(sport)){
  const e=row.event; if(e.status&&e.status!=='scheduled') continue;
  const key=pairKey(e.home_team,e.away_team); if(!idx.has(key))idx.set(key,[]); idx.get(key).push(row);
 }
 for(const e of tpEvents(sport)){
  const t=Date.parse(e.startTime); if(!Number.isFinite(t)||t<now||t>horizon||e.isLive) continue;
  const line=tpLine(e); if(!line) continue; eligible++;
  const rows=idx.get(pairKey(e.teams?.home?.name||line.home.name,e.teams?.away?.name||line.away.name))||[];
  const fair=[]; const outside=[];
  for(const row of rows){
   const he=h2h(row.event); if(!he) continue;
   const oh=he.outcomes.find(o=>norm(o.name)===norm(line.home.name));
   const oa=he.outcomes.find(o=>norm(o.name)===norm(line.away.name));
   if(!oh||!oa||Number(oh.price)<=1||Number(oa.price)<=1) continue;
   const ih=1/Number(oh.price), ia=1/Number(oa.price), z=ih+ia;
   fair.push({book:row.book,home:ih/z,away:ia/z});
   outside.push({book:row.book,home:Number(oh.price),away:Number(oa.price)});
  }
  if(!fair.length) continue; matched++;
  const ph=fair.reduce((s,x)=>s+x.home,0)/fair.length, pa=fair.reduce((s,x)=>s+x.away,0)/fair.length;
  const homeEv=line.home.odds*ph-1, awayEv=line.away.odds*pa-1;
  all.push({sport,eventId:e.id,name:e.name,startTime:e.startTime,thunderpick:{home:line.home,away:line.away},sourceDepth:fair.length,outside,fair:{homeProbability:ph,awayProbability:pa,homeOdds:1/ph,awayOdds:1/pa},ev:{home:homeEv,away:awayEv},plausible:Math.max(homeEv,awayEv)>=-0.01});
 }
}
all.sort((a,b)=>Math.max(b.ev.home,b.ev.away)-Math.max(a.ev.home,a.ev.away));
const output={generatedAt:new Date().toISOString(),thunderpickGeneratedAt:tp.generatedAt,comparisonGeneratedAt:cmp.generatedAt,horizonDays:15,eligibleThunderpickEvents:eligible,matchedEvents:matched,unmatchedEvents:eligible-matched,candidates:all.filter(x=>x.plausible),topScreens:all.slice(0,50)};
await fs.writeFile('data/screen-latest.json',JSON.stringify(output,null,2));
console.log(`Eligible TP=${eligible}, matched=${matched}, candidates=${output.candidates.length}`);
