import fs from 'node:fs/promises';
export const PINNWIRE_SOURCE_FAMILY='pinnacle';
export const PINNWIRE_SPORT_ID=11;
const FILE='data/direct-sources-latest.json';
const out=JSON.parse(await fs.readFile(FILE,'utf8'));
const health={ok:false,status:null,events:0,acceptedEvents:0,acceptedMarkets:0,specials:0,errors:[],fetchedAt:new Date().toISOString(),sourceFamily:PINNWIRE_SOURCE_FAMILY};
const norm=v=>String(v||'').toLowerCase();
// Read-only scope audit for already returned PinnWire "(Kills)" market events.
// A numeric period alone is NOT proof of Map 1/2/3, so do not promote these
// new markets until an explicit map identifier and matching settlement exist.
const killScopeAudit={candidateEvents:0,pricedTeamKillContracts:0,explicitMapContracts:0,
  unverifiedPeriodContracts:0,samples:[]};
function namedMap(...values){
 const hits=values.filter(x=>typeof x==='string').map(s=>s.match(/\\bmap\\s*#?([1-5])\\b/i))
  .filter(Boolean).map(m=>Number(m[1]));
 return hits.length&&new Set(hits).size===1?hits[0]:null;
}
function auditKillMarket(event={}){
 if(!/\\(kills\\)/i.test(String(event.home||'')+' '+String(event.away||'')))return;
 killScopeAudit.candidateEvents++;
 for(const [id,p] of Object.entries(event.periods||{})){
  const per=Number(p?.number??String(id).replace(/\\D/g,''));
  for(const side of ['home','away']){
   for(const market of Object.values(p.team_totals?.[side]||{})){
    const over=Number(market.over),under=Number(market.under),line=Number(market.points);
    if(!(over>1&&under>1&&Number.isFinite(line)))continue;
    killScopeAudit.pricedTeamKillContracts++;
    const explicit=namedMap(event.period_name,event.periodName,event.description,
      p.name,p.title,p.label,p.description,p.period_name,p.meta?.description,
      market.name,market.description);
    if(explicit!==null)killScopeAudit.explicitMapContracts++;
    else killScopeAudit.unverifiedPeriodContracts++;
    if(killScopeAudit.samples.length<14)killScopeAudit.samples.push({
     eventId:event.event_id,parentId:event.parent_id??event.parentId??null,
     start:event.starts||event.start_ts||null,
     home:String(event.home||'').slice(0,75),
     away:String(event.away||'').slice(0,75),
     side,period:Number.isFinite(per)?per:null,explicitMap:explicit,
     labels:{eventPeriod:event.period_name||event.periodName||null,
       period:p.name||p.title||p.label||p.description||null,
       market:market.name||market.description||null},
     line
    });
   }
  }
 }
}

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
 for(const e of events){const sport=sportOf(e);if(!sport||!out?.sports?.[sport])continue;if(sport==='lol'||sport==='dota2')auditKillMarket(e);const markets=fixtureMarkets(e);
  for(const sp of e.specials||[]){for(const rows of Object.values(sp.special_markets||{}))for(const m of rows||[]){const o=[];for(const q of m.prices||[])push(o,q.name,q.price,q.points);if(o.length>=2){health.specials++;markets.push({key:'player_prop',name:sp.special||sp.special_category||m.type||'Special',scope:{period:0,map:null,round:null},line:null,last_update:null,outcomes:o});}}}
  if(!markets.length)continue;out.sports[sport].exactV2.push({id:'pinnwire-direct:'+e.event_id,home_team:e.home,away_team:e.away,commence_time:e.starts||e.start_ts,live:false,bookmakers:[{key:'pinnacle-direct',title:'Pinnacle (PinnWire)',sourceFamily:'pinnacle',markets}]});health.acceptedEvents++;health.acceptedMarkets+=markets.length;
 }
 health.ok=true;
}catch(e){health.errors.push(String(e?.message||e));}
out.providerHealth ||= {};out.providerHealth.pinnwire=health;out.generatedAt=new Date().toISOString();await fs.writeFile(FILE,JSON.stringify(out,null,2));health.killScopeAudit=killScopeAudit;
console.log('PINNWIRE_DIRECT_HEALTH',JSON.stringify(health));
console.log('PINNWIRE_KILL_SCOPE_AUDIT',JSON.stringify(killScopeAudit));
