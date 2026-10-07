import fs from 'node:fs/promises';
export const PINNWIRE_SOURCE_FAMILY='pinnacle';
export const PINNWIRE_SPORT_ID=11;
const FILE='data/direct-sources-latest.json';
const out=JSON.parse(await fs.readFile(FILE,'utf8'));
const health={ok:false,status:null,events:0,acceptedEvents:0,acceptedMarkets:0,specials:0,errors:[],fetchedAt:new Date().toISOString(),sourceFamily:PINNWIRE_SOURCE_FAMILY};
const norm=v=>String(v||'').toLowerCase();
function sportOf(e={}){const s=norm([e.league_name,e.home,e.away].join(' '));if(/counter.?strike|cs2|csgo/.test(s))return'cs2';if(/dota/.test(s))return'dota2';if(/league of legends|\blol\b|\blck\b|\blpl\b|\blec\b|\blcs\b/.test(s))return'lol';if(/valorant/.test(s))return'valorant';return null;}
const push=(a,name,price,point)=>{const p=Number(price);if(name&&p>1&&Number.isFinite(p))a.push({name:String(name),price:p,...(Number.isFinite(Number(point))?{point:Number(point)}:{})});};
function fixtureMarkets(e={}){
 const ms=[];
 for(const [pk,p] of Object.entries(e.periods||{})){
  const period=Number(p?.number??String(pk).replace(/\D/g,''));const scope={period:Number.isFinite(period)?period:null,map:null,round:null};
  if(p?.money_line&&!p.money_line.draw){const o=[];push(o,e.home,p.money_line.home);push(o,e.away,p.money_line.away);if(o.length===2)ms.push({key:period===0?'h2h':'period_winner',name:period===0?'Match Winner':'Period Winner',scope,line:null,last_update:null,outcomes:o});}
  for(const x of Object.values(p?.spreads||{})){const o=[];push(o,e.home,x.home,x.hdp);push(o,e.away,x.away,-Number(x.hdp));if(o.length===2)ms.push({key:'spreads',name:'Handicap',scope,line:Number(x.hdp),last_update:null,outcomes:o});}
  for(const x of Object.values(p?.totals||{})){const o=[];push(o,'Over',x.over,x.points);push(o,'Under',x.under,x.points);if(o.length===2)ms.push({key:'totals',name:'Total',scope,line:Number(x.points),last_update:null,outcomes:o});}
  for(const side of ['home','away'])for(const x of Object.values(p?.team_totals?.[side]||{})){const o=[];push(o,'Over',x.over,x.points);push(o,'Under',x.under,x.points);if(o.length===2)ms.push({key:'team_totals',name:(side==='home'?e.home:e.away)+' Team Total',scope,line:Number(x.points),last_update:null,outcomes:o});}
 }
 return ms;
}
try{
 const key=process.env.PINNWIRE_API_KEY?.trim();
 if(!key)throw new Error('PINNWIRE_API_KEY_NOT_CONFIGURED');
 const u='https://pinnwire.com/kit/v1/prematch/fixtures?sport_id=11&include_specials=nested';
 const r=await fetch(u,{headers:{Accept:'application/json','User-Agent':'thunderpick-scanner/1.0','x-api-key':key},signal:AbortSignal.timeout(30000)});health.status=r.status;const body=await r.text();if(!r.ok)throw new Error('HTTP '+r.status+' '+body.slice(0,120));
 const j=JSON.parse(body),events=Array.isArray(j.events)?j.events:[];health.events=events.length;
 for(const e of events){const sport=sportOf(e);if(!sport||!out?.sports?.[sport])continue;const markets=fixtureMarkets(e);
  for(const sp of e.specials||[]){for(const rows of Object.values(sp.special_markets||{}))for(const m of rows||[]){const o=[];for(const q of m.prices||[])push(o,q.name,q.price,q.points);if(o.length>=2){health.specials++;markets.push({key:'player_prop',name:sp.special||sp.special_category||m.type||'Special',scope:{period:0,map:null,round:null},line:null,last_update:null,outcomes:o});}}}
  if(!markets.length)continue;out.sports[sport].exactV2.push({id:'pinnwire-direct:'+e.event_id,home_team:e.home,away_team:e.away,commence_time:e.starts||e.start_ts,live:false,bookmakers:[{key:'pinnacle-direct',title:'Pinnacle (PinnWire)',sourceFamily:'pinnacle',markets}]});health.acceptedEvents++;health.acceptedMarkets+=markets.length;
 }
 health.ok=true;
}catch(e){health.errors.push(String(e?.message||e));}
out.providerHealth ||= {};out.providerHealth.pinnwire=health;out.generatedAt=new Date().toISOString();await fs.writeFile(FILE,JSON.stringify(out,null,2));console.log('PINNWIRE_DIRECT_HEALTH',JSON.stringify(health));
