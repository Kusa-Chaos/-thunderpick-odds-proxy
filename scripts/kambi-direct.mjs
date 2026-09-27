import fs from 'node:fs/promises';

const FILE='data/direct-sources-latest.json';
const out=JSON.parse(await fs.readFile(FILE,'utf8'));
const ROOT='https://eu-offering-api.kambicdn.com/offering/v2018/ub';
const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const NOW=Date.now(), MAX=NOW+30*24*3600e3, DEEP_MAX=NOW+72*3600e3;
const REAL_ESPORTS=new Set(['COUNTER_STRIKE','DOTA','LEAGUE_OF_LEGENDS','VALORANT']);
const TRAD_DEEP=new Set(['BASEBALL','BASKETBALL','FOOTBALL','TENNIS']);
const SPORT_MAP={AMERICAN_FOOTBALL:'american-football',BASEBALL:'baseball',BASKETBALL:'basketball',FOOTBALL:'soccer',TENNIS:'tennis',COUNTER_STRIKE:'cs2',DOTA:'dota2',LEAGUE_OF_LEGENDS:'lol',VALORANT:'valorant'};
const TRAD_CAPS={BASEBALL:20,BASKETBALL:20,FOOTBALL:20,TENNIS:20};
const dec=v=>{const n=Number(v);return Number.isFinite(n)&&n>1000?n/1000:null};
const point=v=>{const n=Number(v);return Number.isFinite(n)?n/1000:null};
const isoOk=v=>{const t=Date.parse(v||'');return Number.isFinite(t)&&t>=NOW-5*60e3&&t<=MAX};
const deepOk=v=>{const t=Date.parse(v||'');return Number.isFinite(t)&&t>=NOW-5*60e3&&t<=DEEP_MAX};
const latestDate=xs=>xs.map(x=>x?.changedDate).filter(Boolean).sort().at(-1)||null;
const synthetic=e=>{const t=`${e?.name||''} ${e?.group||''}`.toLowerCase();return /esports battle|cyber live|efootball|e-basketball|ebasketball|virtual|simulat|\([^)]+\)\s*-\s*.+\([^)]+\)/i.test(t)};
const clean=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
async function getJson(url){const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':UA},redirect:'follow',signal:AbortSignal.timeout(30000)});const text=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status} ${text.slice(0,140)}`);return JSON.parse(text)}
async function mapLimit(items,limit,fn){const res=[];let i=0;async function w(){while(true){const n=i++;if(n>=items.length)return;try{res[n]=await fn(items[n])}catch(e){res[n]={__error:String(e?.message||e),__item:items[n]}}}}await Promise.all(Array.from({length:Math.min(limit,items.length||1)},w));return res}
function eventTeams(e={}){return e.homeName&&e.awayName?[String(e.homeName),String(e.awayName)]:null}
function isTeamName(v,teams=[]){const n=clean(v);return teams.some(t=>clean(t)===n)}
function twoTeamOutcomes(offer,teams){const os=(offer?.outcomes||[]).filter(o=>dec(o.odds)>1);if(os.length!==2)return null;const a=os.find(o=>clean(o.participant||o.label)===clean(teams[0]));const b=os.find(o=>clean(o.participant||o.label)===clean(teams[1]));if(!a||!b)return null;return[{name:teams[0],price:dec(a.odds)},{name:teams[1],price:dec(b.odds)}]}
function threeWayOutcomes(offer,teams){const os=(offer?.outcomes||[]).filter(o=>dec(o.odds)>1);if(os.length!==3)return null;const home=os.find(o=>clean(o.participant||o.label)===clean(teams[0])||/^1$/i.test(String(o.label||'')));const away=os.find(o=>clean(o.participant||o.label)===clean(teams[1])||/^2$/i.test(String(o.label||'')));const draw=os.find(o=>/^x$|draw/i.test(String(o.label||o.participant||'')));if(!home||!away||!draw)return null;return[{name:teams[0],price:dec(home.odds)},{name:'Draw',price:dec(draw.odds)},{name:teams[1],price:dec(away.odds)}]}
function overUnder(offer,player=null){const os=(offer?.outcomes||[]).filter(o=>dec(o.odds)>1);const over=os.find(o=>/^over$/i.test(String(o.label||''))),under=os.find(o=>/^under$/i.test(String(o.label||'')));if(!over||!under)return null;const p=point(over.line??under.line);if(p==null)return null;const extra=player?{description:player,player}:{};return{line:p,outcomes:[{name:`Over ${p}`,price:dec(over.odds),point:p,...extra},{name:`Under ${p}`,price:dec(under.odds),point:p,...extra}]}}
function teamHandicap(offer,teams){const os=(offer?.outcomes||[]).filter(o=>dec(o.odds)>1);if(os.length!==2)return null;const a=os.find(o=>clean(o.participant||o.label)===clean(teams[0]));const b=os.find(o=>clean(o.participant||o.label)===clean(teams[1]));if(!a||!b)return null;const pa=point(a.line),pb=point(b.line);if(pa==null||pb==null||Math.abs(pa+pb)>.001)return null;return[{name:teams[0],price:dec(a.odds),point:pa},{name:teams[1],price:dec(b.odds),point:pb}]}
function propMarket(offer,{player,stat,key,label,scope={map:null,round:null,set:null,period:'full'}}){player=String(player||'').trim();if(!player)return null;const q=overUnder(offer,player);if(!q)return null;return{key,name:`Player ${player} ${label}`,title:label,description:player,player,specifiers:`player=${encodeURIComponent(player)}|stat=${stat}|threshold=${q.line}`,scope,line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
function embeddedPlayer(label,rx,teams){const m=String(label).match(rx);if(!m)return null;const player=String(m[1]||'').trim();return player&&!isTeamName(player,teams)?player:null}
function participantPlayer(offer,teams){const p=(offer?.outcomes||[]).map(o=>o.participant).find(v=>v&&!isTeamName(v,teams));return p?String(p).trim():null}
function normalizeTraditional(offer,e,label,teams){
 const sport=e.sport;
 if(sport==='BASKETBALL'){
  if(/^Moneyline - Including Overtime$/i.test(label)){const outcomes=twoTeamOutcomes(offer,teams);if(outcomes)return{key:'h2h',name:'Match Winner',title:label,scope:{map:null,round:null,set:null,period:'full'},line:null,last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Point Spread - Including Overtime$/i.test(label)){const outcomes=teamHandicap(offer,teams);if(outcomes)return{key:'spreads',name:'Point Spread (Incl. Overtime)',title:label,scope:{map:null,round:null,set:null,period:'full'},line:Math.abs(outcomes[0].point),last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Total Points - Including Overtime$/i.test(label)){const q=overUnder(offer);if(q)return{key:'totals',name:'Total Points (Incl. Overtime)',title:label,scope:{map:null,round:null,set:null,period:'full'},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
  let m=label.match(/^Total Points by (.+?) - Including Overtime$/i);if(m){const target=m[1].trim(),q=overUnder(offer);if(q&&isTeamName(target,teams))return{key:'totals',name:`${target} Total Points (Incl. Overtime)`,title:label,team:target,scope:{map:null,round:null,set:null,period:'full'},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};if(q&&!isTeamName(target,teams))return propMarket(offer,{player:target,stat:'points',key:'player_points',label:'Points',scope:{map:null,round:null,set:null,period:'full'}});}
  const stats=[['Points','points'],['Rebounds','rebounds'],['Assists','assists'],['Three Pointers','three_pointers'],['3 Pointers','three_pointers'],['Steals','steals'],['Blocks','blocks'],['Turnovers','turnovers']];
  for(const [word,stat] of stats){
   const generic=new RegExp(`^Total ${word} by the Player(?: - Including Overtime)?$`,'i');
   if(generic.test(label)){const player=participantPlayer(offer,teams);if(player)return propMarket(offer,{player,stat,key:`player_${stat}`,label:word,scope:{map:null,round:null,set:null,period:'full'}});}
   const rx=new RegExp(`^Total ${word} by (.+?)(?: - Including Overtime)?$`,'i');const player=embeddedPlayer(label,rx,teams);if(player)return propMarket(offer,{player,stat,key:`player_${stat}`,label:word,scope:{map:null,round:null,set:null,period:'full'}});
  }
 }
 if(sport==='BASEBALL'){
  if(/^Match Odds$/i.test(label)){const outcomes=twoTeamOutcomes(offer,teams);if(outcomes)return{key:'h2h',name:'Match Winner',title:label,scope:{map:null,round:null,set:null,period:'full'},line:null,last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Run Line$/i.test(label)){const outcomes=teamHandicap(offer,teams);if(outcomes)return{key:'spreads',name:'Run Line',title:label,scope:{map:null,round:null,set:null,period:'full'},line:Math.abs(outcomes[0].point),last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Total Runs$/i.test(label)){const q=overUnder(offer);if(q)return{key:'totals',name:'Total Runs',title:label,scope:{map:null,round:null,set:null,period:'full'},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
  let m=label.match(/^Total Runs by (.+)$/i);if(m){const target=m[1].trim(),q=overUnder(offer);if(q&&isTeamName(target,teams))return{key:'totals',name:`${target} Total Runs`,title:label,team:target,scope:{map:null,round:null,set:null,period:'full'},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
  const stats=[['Strikeouts','strikeouts'],['Hits','hits'],['Home Runs','home_runs'],['Total Bases','total_bases'],['RBIs','rbi'],['Walks','walks']];
  for(const [word,stat] of stats){
   const generic=new RegExp(`^(?:Total )?${word} by the Player$`,'i');if(generic.test(label)){const player=participantPlayer(offer,teams);if(player)return propMarket(offer,{player,stat,key:`player_${stat}`,label:word,scope:{map:null,round:null,set:null,period:'full'}});}
   const rx=new RegExp(`^(?:Total )?${word} by (.+)$`,'i');const player=embeddedPlayer(label,rx,teams);if(player)return propMarket(offer,{player,stat,key:`player_${stat}`,label:word,scope:{map:null,round:null,set:null,period:'full'}});
  }
 }
 if(sport==='TENNIS'){
  if(/^Match Odds$/i.test(label)){const outcomes=twoTeamOutcomes(offer,teams);if(outcomes)return{key:'h2h',name:'Match Winner',title:label,scope:{map:null,round:null,set:null,period:'full'},line:null,last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Game Handicap$/i.test(label)){const outcomes=teamHandicap(offer,teams);if(outcomes)return{key:'spreads',name:'Game Handicap',title:label,handicapUnit:'games',scope:{map:null,round:null,set:null,period:'full'},line:Math.abs(outcomes[0].point),last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Set Handicap$/i.test(label)){const outcomes=teamHandicap(offer,teams);if(outcomes)return{key:'set_handicap',name:'Set Handicap',title:label,handicapUnit:'sets',scope:{map:null,round:null,set:null,period:'full'},line:Math.abs(outcomes[0].point),last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Total Games$/i.test(label)){const q=overUnder(offer);if(q)return{key:'totals',name:'Total Games',title:label,totalUnit:'games',scope:{map:null,round:null,set:null,period:'full'},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
  let m=label.match(/^Total Games - Set (\d+)$/i);if(m){const q=overUnder(offer);if(q){const set=Number(m[1]);return{key:'set_totals',name:`Set ${set} Total Games`,title:label,totalUnit:'games',scope:{map:null,round:null,set,period:`set_${set}`},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}}
  m=label.match(/^Total games won by (.+)$/i);if(m){const player=m[1].trim();if(!isTeamName(player,[])&&teams.some(t=>clean(t)===clean(player))){const q=overUnder(offer,player);if(q)return propMarket(offer,{player,stat:'games_won',key:'player_games_won',label:'Games Won',scope:{map:null,round:null,set:null,period:'full'}});}}
  const genericAce=/^Total Aces by the Player$/i;if(genericAce.test(label)){const player=participantPlayer(offer,teams);if(player)return propMarket(offer,{player,stat:'aces',key:'player_aces',label:'Aces',scope:{map:null,round:null,set:null,period:'full'}});}
  const acePlayer=embeddedPlayer(label,/^Total Aces by (.+)$/i,[]);if(acePlayer)return propMarket(offer,{player:acePlayer,stat:'aces',key:'player_aces',label:'Aces',scope:{map:null,round:null,set:null,period:'full'}});
  const genericDf=/^Total Double Faults by the Player$/i;if(genericDf.test(label)){const player=participantPlayer(offer,teams);if(player)return propMarket(offer,{player,stat:'double_faults',key:'player_double_faults',label:'Double Faults',scope:{map:null,round:null,set:null,period:'full'}});}
  const dfPlayer=embeddedPlayer(label,/^Total Double Faults by (.+)$/i,[]);if(dfPlayer)return propMarket(offer,{player:dfPlayer,stat:'double_faults',key:'player_double_faults',label:'Double Faults',scope:{map:null,round:null,set:null,period:'full'}});
 }
 if(sport==='FOOTBALL'){
  if(/^Full Time$/i.test(label)){const outcomes=threeWayOutcomes(offer,teams);if(outcomes)return{key:'h2h_3way',name:'Full Time 1X2',title:label,scope:{map:null,round:null,set:null,period:'full'},line:null,last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Total Goals$/i.test(label)){const q=overUnder(offer);if(q)return{key:'totals',name:'Total Goals',title:label,scope:{map:null,round:null,set:null,period:'full'},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
  const stats=[['Shots on Target','shots_on_target'],['Shots','shots'],['Goals','goals'],['Assists','assists'],['Cards','cards']];
  for(const [word,stat] of stats){
   const generic=new RegExp(`^(?:Total )?${word} by the Player$`,'i');if(generic.test(label)){const player=participantPlayer(offer,teams);if(player)return propMarket(offer,{player,stat,key:`player_${stat}`,label:word,scope:{map:null,round:null,set:null,period:'full'}});}
   const rx=new RegExp(`^(?:Total )?${word} by (.+)$`,'i');const player=embeddedPlayer(label,rx,teams);if(player)return propMarket(offer,{player,stat,key:`player_${stat}`,label:word,scope:{map:null,round:null,set:null,period:'full'}});
  }
 }
 return null;
}
function normalizeOffer(offer,e){const label=String(offer?.criterion?.englishLabel||offer?.criterion?.label||'').trim(),teams=eventTeams(e);if(!teams)return null;let m;
 const trad=normalizeTraditional(offer,e,label,teams);if(trad)return trad;
 if(/^(Match Odds|Match Winner)$/i.test(label)){const outcomes=twoTeamOutcomes(offer,teams);if(!outcomes)return null;return{key:'h2h',name:'Match Winner',title:label,scope:{map:null,round:null,set:null,period:'full'},line:null,last_update:latestDate(offer.outcomes||[]),outcomes};}
 if((m=label.match(/^Map\s*(\d+)$/i))){const outcomes=twoTeamOutcomes(offer,teams);if(!outcomes)return null;const map=Number(m[1]);return{key:'map_winner',name:`Map ${map} Winner`,title:label,scope:{map,round:null,set:null,period:`map_${map}`},line:null,last_update:latestDate(offer.outcomes||[]),outcomes};}
 if((m=label.match(/^Map\s*(\d+)\s*-\s*Round Handicap$/i))){const outcomes=teamHandicap(offer,teams);if(!outcomes)return null;const map=Number(m[1]);return{key:'round_handicap',name:`Map ${map} Round Handicap`,title:label,scope:{map,round:null,set:null,period:`map_${map}`},line:Math.abs(outcomes[0].point),last_update:latestDate(offer.outcomes||[]),outcomes};}
 if((m=label.match(/^Map\s*(\d+)\s*-\s*Total Rounds$/i))){const q=overUnder(offer);if(!q)return null;const map=Number(m[1]);return{key:'round_totals',name:`Map ${map} Total Rounds`,title:label,scope:{map,round:null,set:null,period:`map_${map}`},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
 if(/^Total Maps$/i.test(label)){const q=overUnder(offer);if(!q)return null;return{key:'totals',name:'Total Maps',title:label,scope:{map:null,round:null,set:null,period:'full'},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
 if((m=label.match(/^Map\s*(\d+)\s*-\s*Total\s+(Kills|Deaths)\s+by\s+the\s+Player$/i))){const map=Number(m[1]),stat=m[2].toLowerCase();const player=participantPlayer(offer,teams);if(!player)return null;const q=overUnder(offer,player);if(!q)return null;const singular=stat==='kills'?'kill':'death';return{key:`player_${stat}_map_${map}`,name:`Player Total ${m[2]}`,title:label,description:player,player,specifiers:`player=${encodeURIComponent(player)}|stat=${stat}|map=${map}|threshold=${q.line}`,scope:{map,round:null,set:null,period:`map_${map}`},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes.map(o=>({...o,stat:singular}))};}
 return null;
}

let health={ok:false,status:null,rawEvents:0,acceptedEvents:0,marketCount:0,deepEventRequests:0,traditionalDeepRequests:0,playerPropMarkets:0,playerKillMarkets:0,playerDeathMarkets:0,mapWinnerMarkets:0,roundHandicapMarkets:0,roundTotalMarkets:0,bySport:{},errors:[],fetchedAt:new Date().toISOString()};
try{
 const board=await getJson(`${ROOT}/listView.json?lang=en_GB&market=GB`),events=board?.events||[];health.rawEvents=events.length;
 const eligible=[];
 for(const row of events){const e=row?.event||{},sport=SPORT_MAP[e.sport];if(!sport||!out?.sports?.[sport]||!isoOk(e.start)||e.state==='FINISHED')continue;if(!REAL_ESPORTS.has(e.sport)&&synthetic(e))continue;eligible.push({e,row,sport});}
 const realEsports=eligible.filter(x=>REAL_ESPORTS.has(x.e.sport));
 const trad=[];for(const code of TRAD_DEEP){const rows=eligible.filter(x=>x.e.sport===code&&deepOk(x.e.start)).sort((a,b)=>Date.parse(a.e.start)-Date.parse(b.e.start)).slice(0,TRAD_CAPS[code]||20);trad.push(...rows);}
 const deepTargets=[...realEsports,...trad];
 const tradIds=new Set(trad.map(x=>String(x.e.id)));
 const deep=await mapLimit(deepTargets,8,async x=>{health.deepEventRequests++;if(tradIds.has(String(x.e.id)))health.traditionalDeepRequests++;return{...x,offers:(await getJson(`${ROOT}/betoffer/event/${x.e.id}.json?lang=en_GB&market=GB&includeParticipants=true`))?.betOffers||[]}});
 const deepById=new Map();for(const x of deep){if(x?.__error){health.errors.push(x.__error);continue}deepById.set(String(x.e.id),x.offers||[])}
 for(const x of eligible){const {e,row,sport}=x,teams=eventTeams(e);if(!teams)continue;const offers=deepById.get(String(e.id))||(row.betOffers||[]),markets=[];for(const offer of offers){const m=normalizeOffer(offer,e);if(!m)continue;markets.push(m);health.marketCount++;health.bySport[sport]||={events:0,markets:0,playerProps:0,deepEvents:0};health.bySport[sport].markets++;if(m.key==='map_winner')health.mapWinnerMarkets++;if(m.key==='round_handicap')health.roundHandicapMarkets++;if(m.key==='round_totals')health.roundTotalMarkets++;if(/^player_/.test(m.key)){health.playerPropMarkets++;health.bySport[sport].playerProps++;if(/player_kills/.test(m.key))health.playerKillMarkets++;if(/player_deaths/.test(m.key))health.playerDeathMarkets++;}}
   if(!markets.length)continue;out.sports[sport].exactV2.push({id:`unibet-kambi-direct:${e.id}`,home_team:teams[0],away_team:teams[1],commence_time:e.start,live:false,bookmakers:[{key:'unibet-kambi-direct',title:'Unibet/Kambi Direct',markets}]});health.acceptedEvents++;health.bySport[sport]||={events:0,markets:0,playerProps:0,deepEvents:0};health.bySport[sport].events++;if(deepById.has(String(e.id)))health.bySport[sport].deepEvents++;}
 health.ok=true;health.status=200;
}catch(e){health.errors.push(String(e?.message||e));health.status=500}
for(const s of Object.keys(out.sports||{}))out.sports[s].exactV2EventCount=(out.sports[s].exactV2||[]).length;
health.errors=[...new Set(health.errors)].slice(0,20);health.fetchedAt=new Date().toISOString();out.providerHealth ||= {};out.providerHealth.kambi=health;out.generatedAt=new Date().toISOString();await fs.writeFile(FILE,JSON.stringify(out,null,2));
console.log('KAMBI_DIRECT_HEALTH',JSON.stringify(health));
console.log('KAMBI_DIRECT_COUNTS',JSON.stringify(Object.fromEntries(Object.entries(out.sports).map(([s,v])=>[s,(v.exactV2||[]).filter(e=>String(e.id).startsWith('unibet-kambi-direct:')).length]))));
