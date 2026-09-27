import fs from 'node:fs/promises';

const FILE='data/direct-sources-latest.json';
const out=JSON.parse(await fs.readFile(FILE,'utf8'));
const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const NOW=Date.now(), MAX=NOW+7*24*3600e3;
const SOURCES={
  basketball:'https://www.bovada.lv/services/sports/event/coupon/events/A/description/basketball?lang=en',
  baseball:'https://www.bovada.lv/services/sports/event/coupon/events/A/description/baseball?lang=en',
  tennis:'https://www.bovada.lv/services/sports/event/coupon/events/A/description/tennis?lang=en'
};
function dec(v){if(v==null)return null;const s=String(v).trim().toUpperCase();if(s==='EVEN'||s==='EV')return 2;const n=Number(s.replace('+',''));if(!Number.isFinite(n))return null;if(n>0)return 1+n/100;if(n<=-100)return 1+100/Math.abs(n);return null}
function point(v){const n=Number(v);return Number.isFinite(n)?n:null}
function iso(ms){const n=Number(ms);return Number.isFinite(n)?new Date(n).toISOString():null}
function current(v){const t=Number(v);return Number.isFinite(t)&&t>=NOW-5*60e3&&t<=MAX}
function competitors(e={}){let home=null,away=null;for(const c of e.competitors||[]){if(c?.home)home=c?.name;else away=c?.name}return home&&away?[String(home),String(away)]:null}
function activeOutcomes(m={}){return(m.outcomes||[]).filter(o=>o?.status==='O'&&dec(o?.price?.american)>1)}
function ou(m,player=null){const os=activeOutcomes(m),over=os.find(o=>/^over(?:\b|\s*-)/i.test(String(o.description||''))),under=os.find(o=>/^under(?:\b|\s*-)/i.test(String(o.description||'')));if(!over||!under)return null;const p=point(over?.price?.handicap??under?.price?.handicap);if(p==null)return null;const extra=player?{description:player,player}:{};return{line:p,outcomes:[{name:`Over ${p}`,price:dec(over.price.american),point:p,...extra},{name:`Under ${p}`,price:dec(under.price.american),point:p,...extra}]}}
function twoTeams(m,t){const os=activeOutcomes(m);if(os.length!==2)return null;const norm=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');const a=os.find(o=>norm(o.description)===norm(t[0])),b=os.find(o=>norm(o.description)===norm(t[1]));if(!a||!b)return null;return[{name:t[0],price:dec(a.price.american)},{name:t[1],price:dec(b.price.american)}]}
function spread(m,t){const os=activeOutcomes(m);if(os.length!==2)return null;const norm=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');const a=os.find(o=>norm(o.description)===norm(t[0])),b=os.find(o=>norm(o.description)===norm(t[1]));if(!a||!b)return null;const pa=point(a?.price?.handicap),pb=point(b?.price?.handicap);if(pa==null||pb==null||Math.abs(pa+pb)>.001)return null;return[{name:t[0],price:dec(a.price.american),point:pa},{name:t[1],price:dec(b.price.american),point:pb}]}
function playerName(desc=''){const raw=String(desc).split(' - ').slice(1).join(' - ').trim();return raw.replace(/\s*\([A-Z0-9]{2,5}\)\s*$/i,'').trim()||null}
function propMarket(m,key,stat,label){const player=playerName(m.description);if(!player)return null;const q=ou(m,player);if(!q)return null;return{key,name:m.description,title:m.description,description:player,player,specifiers:`player=${encodeURIComponent(player)}|stat=${stat}|threshold=${q.line}`,scope:{map:null,round:null,set:null,period:'full'},line:q.line,last_update:null,outcomes:q.outcomes,statLabel:label}}
const BASKETBALL_PROPS=[
 [/^Total Points - /i,'player_points','points','Points'],
 [/^Total Rebounds - /i,'player_rebounds','rebounds','Rebounds'],
 [/^Total Assists - /i,'player_assists','assists','Assists'],
 [/^Total (?:Three|3) Pointers(?: Made)? - /i,'player_three_pointers','three_pointers','Three Pointers'],
 [/^Total Steals - /i,'player_steals','steals','Steals'],
 [/^Total Blocks - /i,'player_blocks','blocks','Blocks'],
 [/^Total Turnovers - /i,'player_turnovers','turnovers','Turnovers'],
 [/^Total Points and Rebounds - /i,'player_points_rebounds','points_rebounds','Points + Rebounds'],
 [/^Total Points and Assists - /i,'player_points_assists','points_assists','Points + Assists'],
 [/^Total Rebounds and Assists - /i,'player_rebounds_assists','rebounds_assists','Rebounds + Assists'],
 [/^Total Points, Rebounds and Assists - /i,'player_points_rebounds_assists','points_rebounds_assists','PRA']
];
const BASEBALL_PROPS=[
 [/^Total Strikeouts - /i,'player_strikeouts','strikeouts','Strikeouts'],
 [/^Total Hits - /i,'player_hits','hits','Hits'],
 [/^Total Bases - /i,'player_total_bases','total_bases','Total Bases'],
 [/^Total RBIs? - /i,'player_rbi','rbi','RBI'],
 [/^Total Walks - /i,'player_walks','walks','Walks']
];
const TENNIS_PROPS=[
 [/^Total Aces - /i,'player_aces','aces','Aces'],
 [/^Total Double Faults - /i,'player_double_faults','double_faults','Double Faults']
];
function normalizeMarket(m,t,sport){if(m?.status!=='O')return null;const desc=String(m.description||'').trim();
 if(desc==='Moneyline'){const outcomes=twoTeams(m,t);if(!outcomes)return null;return{key:'h2h',name:'Match Winner',title:desc,scope:{map:null,round:null,set:null,period:'full'},line:null,last_update:null,outcomes};}
 if(desc==='Point Spread'||desc==='Run Line'){const outcomes=spread(m,t);if(!outcomes)return null;return{key:'spreads',name:desc,title:desc,scope:{map:null,round:null,set:null,period:'full'},line:Math.abs(outcomes[0].point),last_update:null,outcomes};}
 if(desc==='Total'||desc==='Total Points'||desc==='Total Runs'||desc==='Total Games'){const q=ou(m);if(!q)return null;return{key:'totals',name:desc,title:desc,scope:{map:null,round:null,set:null,period:'full'},line:q.line,last_update:null,outcomes:q.outcomes};}
 const dict=sport==='basketball'?BASKETBALL_PROPS:sport==='baseball'?BASEBALL_PROPS:TENNIS_PROPS;
 for(const[rx,key,stat,label]of dict){if(rx.test(desc))return propMarket(m,key,stat,label);}
 return null;
}
let health={ok:false,status:null,rawEvents:0,acceptedEvents:0,marketCount:0,playerPropMarkets:0,bySport:{},errors:[],fetchedAt:new Date().toISOString()};
try{
 for(const [sport,url] of Object.entries(SOURCES)){
  const hs=health.bySport[sport]={rawEvents:0,acceptedEvents:0,markets:0,playerProps:0};
  try{
   const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':UA},redirect:'follow',signal:AbortSignal.timeout(60000)});const text=await r.text();if(!r.ok)throw new Error(`${sport} HTTP ${r.status} ${text.slice(0,160)}`);const body=JSON.parse(text);const events=[];for(const block of Array.isArray(body)?body:[])for(const e of block?.events||[])events.push(e);hs.rawEvents=events.length;health.rawEvents+=events.length;
   for(const e of events){if(e?.live||!current(e?.startTime))continue;const t=competitors(e);if(!t)continue;const markets=[];for(const g of e.displayGroups||[]){for(const raw of g.markets||[]){const m=normalizeMarket(raw,t,sport);if(!m)continue;markets.push(m);health.marketCount++;hs.markets++;if(String(m.key).startsWith('player_')){health.playerPropMarkets++;hs.playerProps++;}}}
    if(!markets.length)continue;const event={id:`bovada-traditional-direct:${sport}:${e.id}`,home_team:t[0],away_team:t[1],commence_time:iso(e.startTime),live:false,bookmakers:[{key:'bovada-traditional-direct',title:'Bovada Direct',markets}]};const arr=out.sports[sport].exactV2||=[];const idx=arr.findIndex(v=>String(v.id)===event.id);if(idx>=0)arr[idx]=event;else arr.push(event);health.acceptedEvents++;hs.acceptedEvents++;}
  }catch(e){health.errors.push(String(e?.message||e));}
 }
 health.ok=health.acceptedEvents>0;health.status=health.ok?200:500;
}catch(e){health.errors.push(String(e?.message||e));health.status=500}
for(const s of Object.keys(out.sports||{}))out.sports[s].exactV2EventCount=(out.sports[s].exactV2||[]).length;
health.errors=[...new Set(health.errors)].slice(0,20);health.fetchedAt=new Date().toISOString();out.providerHealth ||= {};out.providerHealth.bovadaTraditional=health;out.generatedAt=new Date().toISOString();await fs.writeFile(FILE,JSON.stringify(out,null,2));
console.log('BOVADA_TRADITIONAL_HEALTH',JSON.stringify(health));
