import fs from 'node:fs/promises';

const FILE='data/direct-sources-latest.json';
const out=JSON.parse(await fs.readFile(FILE,'utf8'));
const NOW=Date.now(), MAX_FUTURE=NOW+30*24*3600e3;
const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';

const pages=[
  ['esports','https://betway.com/g/en/sports/cat/esports'],
  ['american-football','https://betway.com/g/en/sports/cat/american-football'],
  ['baseball','https://betway.com/g/en/sports/cat/baseball'],
  ['basketball','https://betway.com/g/en/sports/cat/basketball'],
  ['soccer','https://betway.com/g/en/sports/cat/soccer'],
  ['tennis','https://betway.com/g/en/sports/cat/tennis'],
];

function esportOf(sub=''){
  const s=String(sub).toLowerCase();
  if(/counter[- ]?strike|cs2|cs:go|csgo/.test(s)) return 'cs2';
  if(/dota\s*2|\bdota\b/.test(s)) return 'dota2';
  if(/league of legends|\blol\b/.test(s)) return 'lol';
  if(/valorant/.test(s)) return 'valorant';
  return null;
}
function pair(name=''){
  const p=String(name).split(/\s+-\s+/).map(x=>x.trim()).filter(Boolean);
  return p.length===2?p:null;
}
function current(start){
  const t=Date.parse(start||'');
  return Number.isFinite(t)&&t>=NOW-2*3600e3&&t<=MAX_FUTURE;
}
function decode(s=''){
  return String(s).replace(/\\"/g,'"').replace(/\\u0026/g,'&').replace(/\\u003c/g,'<').replace(/\\u003e/g,'>');
}
function parsePage(raw,forcedSport){
  const t=decode(raw),events=new Map(),markets=new Map(),outcomes=new Map();
  const er=/"(\d+)":\{"id":\1,.*?"started":(true|false),.*?"name":"([^"]+)",.*?"subcategoryName":"([^"]+)",.*?"startsAt":"([^"]+)"/gs;
  for(const m of t.matchAll(er)) events.set(m[1],{started:m[2]==='true',name:m[3],sub:m[4],start:m[5]});
  const mr=/"(\d+)":\{"id":\1,.*?"name":\{"default":"Match Winner"\},"marketCName":"match-winner","eventId":(\d+),.*?"outcomes":\[(\d+),(\d+)\]/gs;
  for(const m of t.matchAll(mr)) markets.set(m[1],{event:m[2],outs:[m[3],m[4]]});
  const or=/"(\d+)":\{"id":\1,.*?"name":\{.*?"default":"([^"]+)"\},"eventId":(\d+),"marketId":(\d+),.*?"displayed":(true|false),"suspended":(true|false).*?"oddsDecimal":([0-9.]+)/gs;
  for(const m of t.matchAll(or)) outcomes.set(m[1],{name:m[2],event:m[3],market:m[4],displayed:m[5]==='true',suspended:m[6]==='true',odds:Number(m[7])});
  const rows=[];
  for(const [mid,m] of markets){
    const e=events.get(m.event),os=m.outs.map(id=>outcomes.get(id));
    if(!e||e.started||!current(e.start)||os.some(x=>!x||!x.displayed||x.suspended||!(x.odds>1))) continue;
    const teams=pair(e.name); if(!teams) continue;
    const sport=forcedSport==='esports'?esportOf(e.sub):forcedSport;
    if(!sport||!out?.sports?.[sport]) continue;
    rows.push({sport,eventId:m.event,marketId:mid,name:e.name,teams,start:e.start,outcomes:os});
  }
  return {events:events.size,markets:markets.size,outcomes:outcomes.size,rows};
}

let fetchedPages=0,rawEvents=0,rawMarkets=0,rawOutcomes=0,acceptedEvents=0;
const errors=[];
const seen=new Set();
for(const [forcedSport,url] of pages){
  try{
    const r=await fetch(url,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':UA},redirect:'follow',signal:AbortSignal.timeout(30000)});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const parsed=parsePage(await r.text(),forcedSport); fetchedPages++; rawEvents+=parsed.events; rawMarkets+=parsed.markets; rawOutcomes+=parsed.outcomes;
    for(const q of parsed.rows){
      const k=`${q.sport}|${q.eventId}|${q.marketId}`; if(seen.has(k)) continue; seen.add(k);
      out.sports[q.sport].exactV2.push({
        id:`betway-direct:${q.eventId}`,
        home_team:q.teams[0],away_team:q.teams[1],commence_time:q.start,live:false,
        bookmakers:[{key:'betway-direct',title:'Betway Direct',markets:[{
          key:'h2h',name:'Match Winner',title:'Match Winner',scope:{map:null,round:null},line:null,last_update:new Date().toISOString(),
          outcomes:q.outcomes.map(o=>({name:o.name,price:o.odds}))
        }]}]
      });
      acceptedEvents++;
    }
  }catch(e){errors.push({page:forcedSport,error:String(e?.message||e)});}
}
for(const s of Object.keys(out.sports||{})) out.sports[s].exactV2EventCount=(out.sports[s].exactV2||[]).length;
out.providerHealth ||= {};
out.providerHealth.betway={ok:errors.length<pages.length,status:errors.length?207:200,fetchedPages,rawEvents,rawMarkets,rawOutcomes,acceptedEvents,errors,fetchedAt:new Date().toISOString(),note:'Public Betway pre-match Match Winner prices; distinct bookmaker source from Stake/Oddin'};
out.generatedAt=new Date().toISOString();
await fs.writeFile(FILE,JSON.stringify(out,null,2));
console.log('BETWAY_DIRECT_HEALTH',JSON.stringify(out.providerHealth.betway));
console.log('BETWAY_DIRECT_COUNTS',JSON.stringify(Object.fromEntries(Object.entries(out.sports).map(([s,v])=>[s,(v.exactV2||[]).filter(e=>String(e.id).startsWith('betway-direct:')).length]))));
