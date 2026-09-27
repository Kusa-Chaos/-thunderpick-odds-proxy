import fs from 'node:fs/promises';

const FILE='data/direct-sources-latest.json';
const out=JSON.parse(await fs.readFile(FILE,'utf8'));
const ROOT='https://eu-offering-api.kambicdn.com/offering/v2018/ub';
const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const NOW=Date.now(), MAX=NOW+4*24*3600e3;
const dec=v=>{const n=Number(v);return Number.isFinite(n)&&n>1000?n/1000:null};
const point=v=>{const n=Number(v);return Number.isFinite(n)?n/1000:null};
const current=v=>{const t=Date.parse(v||'');return Number.isFinite(t)&&t>=NOW-5*60e3&&t<=MAX};
const latestDate=xs=>xs.map(x=>x?.changedDate).filter(Boolean).sort().at(-1)||null;
async function getJson(url){const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':UA},redirect:'follow',signal:AbortSignal.timeout(30000)});const text=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status} ${text.slice(0,160)}`);return JSON.parse(text)}
async function mapLimit(items,limit,fn){const res=[];let i=0;async function w(){while(true){const n=i++;if(n>=items.length)return;try{res[n]=await fn(items[n])}catch(e){res[n]={__error:String(e?.message||e)}}}}await Promise.all(Array.from({length:Math.min(limit,items.length||1)},w));return res}
function teams(e={}){return e.homeName&&e.awayName?[String(e.homeName),String(e.awayName)]:null}
function twoTeams(offer,t){const os=(offer?.outcomes||[]).filter(o=>dec(o.odds)>1);if(os.length!==2)return null;const a=os.find(o=>String(o.participant||o.label||'').toLowerCase()===t[0].toLowerCase());const b=os.find(o=>String(o.participant||o.label||'').toLowerCase()===t[1].toLowerCase());if(!a||!b)return null;return[{name:t[0],price:dec(a.odds)},{name:t[1],price:dec(b.odds)}]}
function handicap(offer,t){const os=(offer?.outcomes||[]).filter(o=>dec(o.odds)>1);if(os.length!==2)return null;const a=os.find(o=>String(o.participant||o.label||'').toLowerCase()===t[0].toLowerCase());const b=os.find(o=>String(o.participant||o.label||'').toLowerCase()===t[1].toLowerCase());if(!a||!b)return null;const pa=point(a.line),pb=point(b.line);if(pa==null||pb==null||Math.abs(pa+pb)>.001)return null;return[{name:t[0],price:dec(a.odds),point:pa},{name:t[1],price:dec(b.odds),point:pb}]}
function overUnder(offer,player=null){const os=(offer?.outcomes||[]).filter(o=>dec(o.odds)>1);const over=os.find(o=>/^over$/i.test(String(o.label||o.englishLabel||''))),under=os.find(o=>/^under$/i.test(String(o.label||o.englishLabel||'')));if(!over||!under)return null;const p=point(over.line??under.line);if(p==null)return null;const extra=player?{description:player,player}:{};return{line:p,outcomes:[{name:`Over ${p}`,price:dec(over.odds),point:p,...extra},{name:`Under ${p}`,price:dec(under.odds),point:p,...extra}]}}
const PROP_LABELS=[
  [/^Total Passing Yards by the Player - Including Overtime$/i,'player_passing_yards','passing_yards'],
  [/^Total Rushing Yards by the Player - Including Overtime$/i,'player_rushing_yards','rushing_yards'],
  [/^Total Receiving Yards by the Player - Including Overtime$/i,'player_receiving_yards','receiving_yards'],
  [/^Total Receptions by the Player - Including Overtime$/i,'player_receptions','receptions'],
  [/^Total Touchdown Passes Thrown by the Player - Including Overtime$/i,'player_passing_touchdowns','passing_touchdowns']
];
function normalize(offer,e){const label=String(offer?.criterion?.englishLabel||offer?.criterion?.label||'').trim(),t=teams(e);if(!t)return null;
  if(/^Moneyline - Including Overtime$/i.test(label)){const outcomes=twoTeams(offer,t);if(!outcomes)return null;return{key:'h2h',name:'Match Winner',title:label,scope:{map:null,round:null},line:null,last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Point Spread - Including Overtime$/i.test(label)){const outcomes=handicap(offer,t);if(!outcomes)return null;return{key:'spreads',name:'Point Spread (Incl. Overtime)',title:label,scope:{map:null,round:null},line:Math.abs(outcomes[0].point),last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Total Points - Including Overtime$/i.test(label)){const q=overUnder(offer);if(!q)return null;return{key:'totals',name:'Total Points (Incl. Overtime)',title:label,scope:{map:null,round:null},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
  const teamTotal=label.match(/^Total Points by (.+) - Including Overtime$/i);if(teamTotal){const q=overUnder(offer);if(!q)return null;const team=teamTotal[1].trim();return{key:'totals',name:`${team} Total Points (Incl. Overtime)`,title:label,team,scope:{map:null,round:null},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
  for(const [rx,key,stat] of PROP_LABELS){if(!rx.test(label))continue;const player=String((offer.outcomes||[]).map(o=>o.participant).find(Boolean)||'').trim();if(!player)return null;const q=overUnder(offer,player);if(!q)return null;return{key,name:`Player ${player} - ${label.replace(/ by the Player - Including Overtime/i,'')}`,title:label,description:player,player,specifiers:`player=${encodeURIComponent(player)}|stat=${stat}|threshold=${q.line}`,scope:{map:null,round:null},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
  return null;
}
let health={ok:false,status:null,rawEvents:0,nflEvents:0,deepRequests:0,acceptedEvents:0,marketCount:0,h2h:0,spreads:0,totals:0,teamTotals:0,playerPropMarkets:0,errors:[],fetchedAt:new Date().toISOString()};
try{
  const board=await getJson(`${ROOT}/listView.json?lang=en_GB&market=GB`),events=board?.events||[];health.rawEvents=events.length;
  const nfl=[];for(const row of events){const e=row?.event||{};if(e.sport!=='AMERICAN_FOOTBALL'||!current(e.start)||String(e.group||'').toUpperCase()!=='NFL'||e.state==='FINISHED')continue;nfl.push({e,row});}health.nflEvents=nfl.length;
  const deep=await mapLimit(nfl,8,async x=>{health.deepRequests++;return{...x,offers:(await getJson(`${ROOT}/betoffer/event/${x.e.id}.json?lang=en_GB&market=GB&includeParticipants=true`))?.betOffers||[]}});
  for(const x of deep){if(x?.__error){health.errors.push(x.__error);continue}const e=x.e,t=teams(e);if(!t)continue;const markets=[];for(const offer of x.offers||[]){const m=normalize(offer,e);if(!m)continue;markets.push(m);health.marketCount++;if(m.key==='h2h')health.h2h++;else if(m.key==='spreads')health.spreads++;else if(m.key==='totals'){health.totals++;if(m.team)health.teamTotals++;}else if(String(m.key).startsWith('player_'))health.playerPropMarkets++;}
    if(!markets.length)continue;out.sports['american-football'].exactV2.push({id:`unibet-kambi-nfl-direct:${e.id}`,home_team:t[0],away_team:t[1],commence_time:e.start,live:false,bookmakers:[{key:'unibet-kambi-nfl-direct',title:'Unibet/Kambi NFL Direct',markets}]});health.acceptedEvents++;}
  health.ok=true;health.status=200;
}catch(e){health.errors.push(String(e?.message||e));health.status=500;}
for(const s of Object.keys(out.sports||{}))out.sports[s].exactV2EventCount=(out.sports[s].exactV2||[]).length;
health.errors=[...new Set(health.errors)].slice(0,20);health.fetchedAt=new Date().toISOString();out.providerHealth ||= {};out.providerHealth.kambiNfl=health;out.generatedAt=new Date().toISOString();await fs.writeFile(FILE,JSON.stringify(out,null,2));
console.log('KAMBI_NFL_HEALTH',JSON.stringify(health));
