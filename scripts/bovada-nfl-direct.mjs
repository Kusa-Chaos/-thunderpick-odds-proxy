import fs from 'node:fs/promises';

const FILE='data/direct-sources-latest.json';
const out=JSON.parse(await fs.readFile(FILE,'utf8'));
const URL='https://www.bovada.lv/services/sports/event/coupon/events/A/description/football/nfl?lang=en';
const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const NOW=Date.now(), MAX=NOW+4*24*3600e3;
function dec(v){if(v==null)return null;const s=String(v).trim().toUpperCase();if(s==='EVEN'||s==='EV')return 2;const n=Number(s.replace('+',''));if(!Number.isFinite(n))return null;if(n>0)return 1+n/100;if(n<=-100)return 1+100/Math.abs(n);return null}
function point(v){const n=Number(v);return Number.isFinite(n)?n:null}
function iso(ms){const n=Number(ms);return Number.isFinite(n)?new Date(n).toISOString():null}
function current(v){const t=Number(v);return Number.isFinite(t)&&t>=NOW-5*60e3&&t<=MAX}
function competitors(e={}){let home=null,away=null;for(const c of e.competitors||[]){if(c?.home)home=c?.name;else away=c?.name}return home&&away?[String(home),String(away)]:null}
function activeOutcomes(m={}){return(m.outcomes||[]).filter(o=>o?.status==='O'&&dec(o?.price?.american)>1)}
function ou(m,player=null){const os=activeOutcomes(m),over=os.find(o=>/^over$/i.test(String(o.description||''))),under=os.find(o=>/^under$/i.test(String(o.description||'')));if(!over||!under)return null;const p=point(over?.price?.handicap??under?.price?.handicap);if(p==null)return null;const extra=player?{description:player,player}:{};return{line:p,outcomes:[{name:`Over ${p}`,price:dec(over.price.american),point:p,...extra},{name:`Under ${p}`,price:dec(under.price.american),point:p,...extra}]}}
function twoTeams(m,t){const os=activeOutcomes(m);if(os.length!==2)return null;const a=os.find(o=>String(o.description||'').trim().toLowerCase()===t[0].toLowerCase()),b=os.find(o=>String(o.description||'').trim().toLowerCase()===t[1].toLowerCase());if(!a||!b)return null;return[{name:t[0],price:dec(a.price.american)},{name:t[1],price:dec(b.price.american)}]}
function spread(m,t){const os=activeOutcomes(m);if(os.length!==2)return null;const a=os.find(o=>String(o.description||'').trim().toLowerCase()===t[0].toLowerCase()),b=os.find(o=>String(o.description||'').trim().toLowerCase()===t[1].toLowerCase());if(!a||!b)return null;const pa=point(a?.price?.handicap),pb=point(b?.price?.handicap);if(pa==null||pb==null||Math.abs(pa+pb)>.001)return null;return[{name:t[0],price:dec(a.price.american),point:pa},{name:t[1],price:dec(b.price.american),point:pb}]}
function playerName(desc=''){const p=String(desc).split(' - ').slice(1).join(' - ').trim();return p.replace(/\s*\([A-Z0-9]{2,4}\)\s*$/,'').trim()||null}
const PROP_MAP=[
  [/^Total Passing Yards - /i,'player_passing_yards','passing_yards'],
  [/^Total Rushing Yards - /i,'player_rushing_yards','rushing_yards'],
  [/^Total Receiving Yards - /i,'player_receiving_yards','receiving_yards'],
  [/^Total Receptions - /i,'player_receptions','receptions'],
  [/^Total Passing Touchdowns - /i,'player_passing_touchdowns','passing_touchdowns']
];
function normalizeMarket(m,t){if(m?.status!=='O')return null;const desc=String(m.description||'').trim();
  if(desc==='Moneyline'){const outcomes=twoTeams(m,t);if(!outcomes)return null;return{key:'h2h',name:'Match Winner',title:'Moneyline',scope:{map:null,round:null},line:null,last_update:null,outcomes};}
  if(desc==='Point Spread'){const outcomes=spread(m,t);if(!outcomes)return null;return{key:'spreads',name:'Point Spread',title:'Point Spread',scope:{map:null,round:null},line:Math.abs(outcomes[0].point),last_update:null,outcomes};}
  if(desc==='Total'){const q=ou(m);if(!q)return null;return{key:'totals',name:'Total',title:'Total',scope:{map:null,round:null},line:q.line,last_update:null,outcomes:q.outcomes};}
  const teamTotal=desc.match(/^Total Points - (.+)$/i);if(teamTotal){const team=t.find(x=>x.toLowerCase()===teamTotal[1].trim().toLowerCase());if(!team)return null;const q=ou(m);if(!q)return null;return{key:'team_total',name:`${team} Team Total`,title:desc,team,scope:{map:null,round:null},line:q.line,last_update:null,outcomes:q.outcomes};}
  for(const[rx,key,stat]of PROP_MAP){if(!rx.test(desc))continue;const player=playerName(desc);if(!player)return null;const q=ou(m,player);if(!q)return null;return{key,name:desc,title:desc,description:player,player,specifiers:`player=${encodeURIComponent(player)}|stat=${stat}|threshold=${q.line}`,scope:{map:null,round:null},line:q.line,last_update:null,outcomes:q.outcomes};}
  return null;
}
let health={ok:false,status:null,rawEvents:0,acceptedEvents:0,marketCount:0,h2h:0,spreads:0,totals:0,teamTotals:0,playerPropMarkets:0,playerPassingYards:0,playerRushingYards:0,playerReceivingYards:0,playerReceptions:0,playerPassingTouchdowns:0,errors:[],fetchedAt:new Date().toISOString()};
try{
  const r=await fetch(URL,{headers:{Accept:'application/json','User-Agent':UA},redirect:'follow',signal:AbortSignal.timeout(45000)});const text=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status} ${text.slice(0,160)}`);const body=JSON.parse(text),events=Array.isArray(body)&&body.length?body[0]?.events||[]:[];health.rawEvents=events.length;
  for(const e of events){if(e?.live||!current(e?.startTime))continue;const t=competitors(e);if(!t)continue;const markets=[];for(const g of e.displayGroups||[]){for(const raw of g.markets||[]){const m=normalizeMarket(raw,t);if(!m)continue;markets.push(m);health.marketCount++;if(m.key==='h2h')health.h2h++;else if(m.key==='spreads')health.spreads++;else if(m.key==='totals')health.totals++;else if(m.key==='team_total')health.teamTotals++;else if(String(m.key).startsWith('player_')){health.playerPropMarkets++;if(m.key==='player_passing_yards')health.playerPassingYards++;if(m.key==='player_rushing_yards')health.playerRushingYards++;if(m.key==='player_receiving_yards')health.playerReceivingYards++;if(m.key==='player_receptions')health.playerReceptions++;if(m.key==='player_passing_touchdowns')health.playerPassingTouchdowns++;}}}
    if(!markets.length)continue;out.sports['american-football'].exactV2.push({id:`bovada-nfl-direct:${e.id}`,home_team:t[0],away_team:t[1],commence_time:iso(e.startTime),live:false,bookmakers:[{key:'bovada-nfl-direct',title:'Bovada NFL Direct',markets}]});health.acceptedEvents++;}
  health.ok=true;health.status=200;
}catch(e){health.errors.push(String(e?.message||e));health.status=500;}
for(const s of Object.keys(out.sports||{}))out.sports[s].exactV2EventCount=(out.sports[s].exactV2||[]).length;
health.fetchedAt=new Date().toISOString();out.providerHealth ||= {};out.providerHealth.bovadaNfl=health;out.generatedAt=new Date().toISOString();await fs.writeFile(FILE,JSON.stringify(out,null,2));
console.log('BOVADA_NFL_HEALTH',JSON.stringify(health));
