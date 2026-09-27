import fs from 'node:fs/promises';

const FILE='data/direct-sources-latest.json';
const out=JSON.parse(await fs.readFile(FILE,'utf8'));
const ROOT='https://eu-offering-api.kambicdn.com/offering/v2018/ub';
const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const NOW=Date.now(), MAX=NOW+30*24*3600e3;
const REAL_ESPORTS=new Set(['COUNTER_STRIKE','DOTA','LEAGUE_OF_LEGENDS','VALORANT']);
const SPORT_MAP={AMERICAN_FOOTBALL:'american-football',BASEBALL:'baseball',BASKETBALL:'basketball',FOOTBALL:'soccer',TENNIS:'tennis',COUNTER_STRIKE:'cs2',DOTA:'dota2',LEAGUE_OF_LEGENDS:'lol',VALORANT:'valorant'};
const dec=v=>{const n=Number(v);return Number.isFinite(n)&&n>1000?n/1000:null};
const point=v=>{const n=Number(v);return Number.isFinite(n)?n/1000:null};
const isoOk=v=>{const t=Date.parse(v||'');return Number.isFinite(t)&&t>=NOW-5*60e3&&t<=MAX};
const latestDate=xs=>xs.map(x=>x?.changedDate).filter(Boolean).sort().at(-1)||null;
const synthetic=e=>{const t=`${e?.name||''} ${e?.group||''}`.toLowerCase();return /esports battle|cyber live|efootball|e-basketball|ebasketball|virtual|simulat|\([^)]+\)\s*-\s*.+\([^)]+\)/i.test(t)};
async function getJson(url){const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':UA},redirect:'follow',signal:AbortSignal.timeout(30000)});const text=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status} ${text.slice(0,140)}`);return JSON.parse(text)}
async function mapLimit(items,limit,fn){const res=[];let i=0;async function w(){while(true){const n=i++;if(n>=items.length)return;try{res[n]=await fn(items[n])}catch(e){res[n]={__error:String(e?.message||e)}}}}await Promise.all(Array.from({length:Math.min(limit,items.length||1)},w));return res}
function eventTeams(e={}){return e.homeName&&e.awayName?[String(e.homeName),String(e.awayName)]:null}
function twoTeamOutcomes(offer,teams){const os=(offer?.outcomes||[]).filter(o=>dec(o.odds)>1);if(os.length!==2)return null;const names=os.map(o=>String(o.participant||o.label||''));const a=os.find(o=>String(o.participant||o.label||'').toLowerCase()===teams[0].toLowerCase());const b=os.find(o=>String(o.participant||o.label||'').toLowerCase()===teams[1].toLowerCase());if(!a||!b)return null;return[{name:teams[0],price:dec(a.odds)},{name:teams[1],price:dec(b.odds)}]}
function overUnder(offer,player=null){const os=(offer?.outcomes||[]).filter(o=>dec(o.odds)>1);const over=os.find(o=>/^over$/i.test(String(o.label||''))),under=os.find(o=>/^under$/i.test(String(o.label||'')));if(!over||!under)return null;const p=point(over.line??under.line);if(p==null)return null;return{line:p,outcomes:[{name:`Over ${p}`,price:dec(over.odds),point:p,description:player||undefined,player:player||undefined},{name:`Under ${p}`,price:dec(under.odds),point:p,description:player||undefined,player:player||undefined}]}}
function teamHandicap(offer,teams){const os=(offer?.outcomes||[]).filter(o=>dec(o.odds)>1);if(os.length!==2)return null;const a=os.find(o=>String(o.participant||o.label||'').toLowerCase()===teams[0].toLowerCase());const b=os.find(o=>String(o.participant||o.label||'').toLowerCase()===teams[1].toLowerCase());if(!a||!b)return null;const pa=point(a.line),pb=point(b.line);if(pa==null||pb==null||Math.abs(pa+pb)>.001)return null;return[{name:teams[0],price:dec(a.odds),point:pa},{name:teams[1],price:dec(b.odds),point:pb}]}
function normalizeOffer(offer,e){const label=String(offer?.criterion?.englishLabel||offer?.criterion?.label||'').trim(),teams=eventTeams(e);if(!teams)return null;let m;
 if(/^(Match Odds|Match Winner)$/i.test(label)){const outcomes=twoTeamOutcomes(offer,teams);if(!outcomes)return null;return{key:'h2h',name:'Match Winner',title:label,scope:{map:null,round:null},line:null,last_update:latestDate(offer.outcomes||[]),outcomes};}
 if((m=label.match(/^Map\s*(\d+)$/i))){const outcomes=twoTeamOutcomes(offer,teams);if(!outcomes)return null;const map=Number(m[1]);return{key:'map_winner',name:`Map ${map} Winner`,title:label,scope:{map,round:null},line:null,last_update:latestDate(offer.outcomes||[]),outcomes};}
 if((m=label.match(/^Map\s*(\d+)\s*-\s*Round Handicap$/i))){const outcomes=teamHandicap(offer,teams);if(!outcomes)return null;const map=Number(m[1]);return{key:'round_handicap',name:`Map ${map} Round Handicap`,title:label,scope:{map,round:null},line:Math.abs(outcomes[0].point),last_update:latestDate(offer.outcomes||[]),outcomes};}
 if((m=label.match(/^Map\s*(\d+)\s*-\s*Total Rounds$/i))){const q=overUnder(offer);if(!q)return null;const map=Number(m[1]);return{key:'round_totals',name:`Map ${map} Total Rounds`,title:label,scope:{map,round:null},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
 if(/^Total Maps$/i.test(label)){const q=overUnder(offer);if(!q)return null;return{key:'totals',name:'Total Maps',title:label,scope:{map:null,round:null},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
 if((m=label.match(/^Map\s*(\d+)\s*-\s*Total\s+(Kills|Deaths)\s+by\s+the\s+Player$/i))){const map=Number(m[1]),stat=m[2].toLowerCase();const player=String((offer.outcomes||[]).map(o=>o.participant).find(Boolean)||'').trim();if(!player)return null;const q=overUnder(offer,player);if(!q)return null;const singular=stat==='kills'?'kill':'death';return{key:`player_${stat}_map_${map}`,name:`Player Total ${m[2]}`,title:label,description:player,player,specifiers:`player=${encodeURIComponent(player)}|stat=${stat}|map=${map}|threshold=${q.line}`,scope:{map,round:null},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes.map(o=>({...o,stat:singular}))};}
 return null;
}

let health={ok:false,status:null,rawEvents:0,acceptedEvents:0,marketCount:0,deepEventRequests:0,playerPropMarkets:0,playerKillMarkets:0,playerDeathMarkets:0,mapWinnerMarkets:0,roundHandicapMarkets:0,roundTotalMarkets:0,errors:[],fetchedAt:new Date().toISOString()};
try{
 const board=await getJson(`${ROOT}/listView.json?lang=en_GB&market=GB`),events=board?.events||[];health.rawEvents=events.length;
 const eligible=[];
 for(const row of events){const e=row?.event||{},sport=SPORT_MAP[e.sport];if(!sport||!out?.sports?.[sport]||!isoOk(e.start)||e.state==='FINISHED')continue;if(!REAL_ESPORTS.has(e.sport)&&synthetic(e))continue;eligible.push({e,row,sport});}
 const realEsports=eligible.filter(x=>REAL_ESPORTS.has(x.e.sport));
 const deep=await mapLimit(realEsports,8,async x=>{health.deepEventRequests++;return{...x,offers:(await getJson(`${ROOT}/betoffer/event/${x.e.id}.json?lang=en_GB&market=GB&includeParticipants=true`))?.betOffers||[]}});
 const deepById=new Map();for(const x of deep){if(x?.__error){health.errors.push(x.__error);continue}deepById.set(String(x.e.id),x.offers||[])}
 for(const x of eligible){const {e,row,sport}=x,teams=eventTeams(e);if(!teams)continue;const offers=deepById.get(String(e.id))||(row.betOffers||[]),markets=[];for(const offer of offers){const m=normalizeOffer(offer,e);if(!m)continue;markets.push(m);health.marketCount++;if(m.key==='map_winner')health.mapWinnerMarkets++;if(m.key==='round_handicap')health.roundHandicapMarkets++;if(m.key==='round_totals')health.roundTotalMarkets++;if(/^player_/.test(m.key)){health.playerPropMarkets++;if(/player_kills/.test(m.key))health.playerKillMarkets++;if(/player_deaths/.test(m.key))health.playerDeathMarkets++;}}
   if(!markets.length)continue;out.sports[sport].exactV2.push({id:`unibet-kambi-direct:${e.id}`,home_team:teams[0],away_team:teams[1],commence_time:e.start,live:false,bookmakers:[{key:'unibet-kambi-direct',title:'Unibet/Kambi Direct',markets}]});health.acceptedEvents++;}
 health.ok=true;health.status=200;
}catch(e){health.errors.push(String(e?.message||e));health.status=500}
for(const s of Object.keys(out.sports||{}))out.sports[s].exactV2EventCount=(out.sports[s].exactV2||[]).length;
health.errors=[...new Set(health.errors)].slice(0,20);health.fetchedAt=new Date().toISOString();out.providerHealth ||= {};out.providerHealth.kambi=health;out.generatedAt=new Date().toISOString();await fs.writeFile(FILE,JSON.stringify(out,null,2));
console.log('KAMBI_DIRECT_HEALTH',JSON.stringify(health));
console.log('KAMBI_DIRECT_COUNTS',JSON.stringify(Object.fromEntries(Object.entries(out.sports).map(([s,v])=>[s,(v.exactV2||[]).filter(e=>String(e.id).startsWith('unibet-kambi-direct:')).length]))));
