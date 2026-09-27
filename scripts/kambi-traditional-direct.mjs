import fs from 'node:fs/promises';

const FILE='data/direct-sources-latest.json';
const out=JSON.parse(await fs.readFile(FILE,'utf8'));
const ROOT='https://eu-offering-api.kambicdn.com/offering/v2018/ub';
const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const NOW=Date.now(), HORIZON=NOW+72*3600e3;
const SPORT_MAP={BASEBALL:'baseball',BASKETBALL:'basketball',FOOTBALL:'soccer',TENNIS:'tennis'};
const CAPS={BASEBALL:20,BASKETBALL:24,FOOTBALL:24,TENNIS:24};
const dec=v=>{const n=Number(v);return Number.isFinite(n)&&n>1000?n/1000:null};
const point=v=>{const n=Number(v);return Number.isFinite(n)?n/1000:null};
const latestDate=xs=>xs.map(x=>x?.changedDate).filter(Boolean).sort().at(-1)||null;
const clean=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const inWindow=v=>{const t=Date.parse(v||'');return Number.isFinite(t)&&t>=NOW-5*60e3&&t<=HORIZON};
const synthetic=e=>/virtual|simulat|efootball|e-basketball|ebasketball|esoccer|cyber/i.test(`${e?.name||''} ${e?.group||''}`);
function stripScopeSuffix(v=''){
 return String(v).trim()
  .replace(/\s*-\s*Including Overtime.*$/i,'')
  .replace(/\s*-\s*Including Extra Innings.*$/i,'')
  .replace(/\s*-\s*(?:1st|First) Half.*$/i,'')
  .replace(/\s*-\s*(?:2nd|Second) Half.*$/i,'')
  .replace(/\s*-\s*Quarter\s*\d+.*$/i,'')
  .replace(/\s*\([^)]*(?:listed player|must start|overtime|extra innings)[^)]*\)\s*$/i,'')
  .trim();
}
function eventTeams(e={}){return e.homeName&&e.awayName?[String(e.homeName),String(e.awayName)]:null}
function isTeamTarget(v,teams=[]){const n=clean(stripScopeSuffix(v));return !!n&&teams.some(t=>clean(t)===n)}
async function getJson(url){const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':UA},redirect:'follow',signal:AbortSignal.timeout(30000)});const text=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status} ${text.slice(0,160)}`);return JSON.parse(text)}
async function mapLimit(items,limit,fn){const res=[];let i=0;async function w(){while(true){const n=i++;if(n>=items.length)return;try{res[n]=await fn(items[n])}catch(e){res[n]={__error:String(e?.message||e),__item:items[n]}}}}await Promise.all(Array.from({length:Math.min(limit,items.length||1)},w));return res}
function twoTeams(offer,teams){const os=(offer?.outcomes||[]).filter(o=>dec(o.odds)>1);if(os.length!==2)return null;const a=os.find(o=>clean(o.participant||o.label)===clean(teams[0]));const b=os.find(o=>clean(o.participant||o.label)===clean(teams[1]));if(!a||!b)return null;return[{name:teams[0],price:dec(a.odds)},{name:teams[1],price:dec(b.odds)}]}
function threeWay(offer,teams){const os=(offer?.outcomes||[]).filter(o=>dec(o.odds)>1);if(os.length!==3)return null;const a=os.find(o=>clean(o.participant||o.label)===clean(teams[0])||String(o.label)==='1');const b=os.find(o=>clean(o.participant||o.label)===clean(teams[1])||String(o.label)==='2');const d=os.find(o=>/^x$|draw/i.test(String(o.label||o.participant||'')));if(!a||!b||!d)return null;return[{name:teams[0],price:dec(a.odds)},{name:'Draw',price:dec(d.odds)},{name:teams[1],price:dec(b.odds)}]}
function handicap(offer,teams){const os=(offer?.outcomes||[]).filter(o=>dec(o.odds)>1);if(os.length!==2)return null;const a=os.find(o=>clean(o.participant||o.label)===clean(teams[0]));const b=os.find(o=>clean(o.participant||o.label)===clean(teams[1]));if(!a||!b)return null;const pa=point(a.line),pb=point(b.line);if(pa==null||pb==null||Math.abs(pa+pb)>.001)return null;return[{name:teams[0],price:dec(a.odds),point:pa},{name:teams[1],price:dec(b.odds),point:pb}]}
function overUnder(offer,player=null){const os=(offer?.outcomes||[]).filter(o=>dec(o.odds)>1);const over=os.find(o=>/^over$/i.test(String(o.label||o.englishLabel||''))),under=os.find(o=>/^under$/i.test(String(o.label||o.englishLabel||'')));if(!over||!under)return null;const p=point(over.line??under.line);if(p==null)return null;const x=player?{description:player,player}:{};return{line:p,outcomes:[{name:`Over ${p}`,price:dec(over.odds),point:p,...x},{name:`Under ${p}`,price:dec(under.odds),point:p,...x}]}}
function participantPlayer(offer,teams){const vals=[...new Set((offer?.outcomes||[]).map(o=>String(o.participant||'').trim()).filter(Boolean).filter(v=>!isTeamTarget(v,teams)))];return vals.length===1?vals[0]:null}
function namedPlayer(raw,teams){const v=stripScopeSuffix(raw);if(!v||/^the\s+player\b/i.test(v)||isTeamTarget(v,teams))return null;return v}
function marketBase(key,name,title,scope,line,outcomes,extra={}){return{key,name,title,scope,line,last_update:latestDate(outcomes?.map?outcomes:[]),outcomes,...extra}}
function prop(offer,player,stat,label,scope={map:null,round:null,set:null,period:'full'}){player=String(player||'').trim();if(!player)return null;const q=overUnder(offer,player);if(!q)return null;return{key:`player_${stat}`,name:`Player ${player} ${label}`,title:label,description:player,player,specifiers:`player=${encodeURIComponent(player)}|stat=${stat}|threshold=${q.line}`,scope,line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes}}
function teamTotal(offer,target,title,period='full'){const q=overUnder(offer);if(!q)return null;return{key:'totals',name:title,title,team:target,scope:{map:null,round:null,set:null,period},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes}}
function genericOrNamedProp(offer,label,teams,word,stat,scope={map:null,round:null,set:null,period:'full'}){
 const generic=new RegExp(`^(?:Total )?${word} by the Player\\b`,'i');
 if(generic.test(label)){const player=participantPlayer(offer,teams);return player?prop(offer,player,stat,word,scope):null;}
 const named=new RegExp(`^(?:Total )?${word} by (.+)$`,'i');const m=label.match(named);if(!m)return null;const player=namedPlayer(m[1],teams);return player?prop(offer,player,stat,word,scope):null;
}
function normalize(offer,e){
 const label=String(offer?.criterion?.englishLabel||offer?.criterion?.label||'').trim();const teams=eventTeams(e);if(!teams)return null;const sport=e.sport;
 if(sport==='BASKETBALL'){
  if(/^Moneyline - Including Overtime$/i.test(label)){const outcomes=twoTeams(offer,teams);if(outcomes)return{key:'h2h',name:'Match Winner',title:label,scope:{map:null,round:null,set:null,period:'full'},line:null,last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Point Spread - Including Overtime$/i.test(label)){const outcomes=handicap(offer,teams);if(outcomes)return{key:'spreads',name:'Point Spread (Incl. Overtime)',title:label,scope:{map:null,round:null,set:null,period:'full'},line:Math.abs(outcomes[0].point),last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Total Points - Including Overtime$/i.test(label)){const q=overUnder(offer);if(q)return{key:'totals',name:'Total Points (Incl. Overtime)',title:label,scope:{map:null,round:null,set:null,period:'full'},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
  let m=label.match(/^Total Points by (.+?) - Including Overtime$/i);if(m&&isTeamTarget(m[1],teams))return teamTotal(offer,stripScopeSuffix(m[1]),label,'full');
  m=label.match(/^Total Points by (.+?) - 1st Half$/i);if(m&&isTeamTarget(m[1],teams))return teamTotal(offer,stripScopeSuffix(m[1]),label,'first_half');
  const stats=[['Points','points'],['Rebounds','rebounds'],['Assists','assists'],['Three Pointers','three_pointers'],['3 Pointers','three_pointers'],['Steals','steals'],['Blocks','blocks'],['Turnovers','turnovers']];
  for(const [word,stat] of stats){const p=genericOrNamedProp(offer,label,teams,word,stat);if(p)return p;}
 }
 if(sport==='BASEBALL'){
  if(/^Match Odds$/i.test(label)){const outcomes=twoTeams(offer,teams);if(outcomes)return{key:'h2h',name:'Match Winner',title:label,scope:{map:null,round:null,set:null,period:'full'},line:null,last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Run Line$/i.test(label)){const outcomes=handicap(offer,teams);if(outcomes)return{key:'spreads',name:'Run Line',title:label,scope:{map:null,round:null,set:null,period:'full'},line:Math.abs(outcomes[0].point),last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Total Runs$/i.test(label)){const q=overUnder(offer);if(q)return{key:'totals',name:'Total Runs',title:label,scope:{map:null,round:null,set:null,period:'full'},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
  let m=label.match(/^Total Runs by (.+)$/i);if(m&&isTeamTarget(m[1],teams))return teamTotal(offer,stripScopeSuffix(m[1]),label,'full');
  const stats=[['Strikeouts','strikeouts'],['Hits','hits'],['Home Runs','home_runs'],['Total Bases','total_bases'],['RBIs','rbi'],['Walks','walks']];
  for(const [word,stat] of stats){const p=genericOrNamedProp(offer,label,teams,word,stat);if(p)return p;}
 }
 if(sport==='TENNIS'){
  if(/^Match Odds$/i.test(label)){const outcomes=twoTeams(offer,teams);if(outcomes)return{key:'h2h',name:'Match Winner',title:label,scope:{map:null,round:null,set:null,period:'full'},line:null,last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Game Handicap$/i.test(label)){const outcomes=handicap(offer,teams);if(outcomes)return{key:'spreads',name:'Game Handicap',title:label,handicapUnit:'games',scope:{map:null,round:null,set:null,period:'full'},line:Math.abs(outcomes[0].point),last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Set Handicap$/i.test(label)){const outcomes=handicap(offer,teams);if(outcomes)return{key:'set_handicap',name:'Set Handicap',title:label,handicapUnit:'sets',scope:{map:null,round:null,set:null,period:'full'},line:Math.abs(outcomes[0].point),last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Total Games$/i.test(label)){const q=overUnder(offer);if(q)return{key:'totals',name:'Total Games',title:label,totalUnit:'games',scope:{map:null,round:null,set:null,period:'full'},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
  let m=label.match(/^Total Games - Set (\d+)$/i);if(m){const q=overUnder(offer);if(q){const set=Number(m[1]);return{key:'set_totals',name:`Set ${set} Total Games`,title:label,totalUnit:'games',scope:{map:null,round:null,set,period:`set_${set}`},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}}
  m=label.match(/^Total games won by (.+)$/i);if(m){const player=stripScopeSuffix(m[1]);if(teams.some(t=>clean(t)===clean(player))){const p=prop(offer,player,'games_won','Games Won');if(p)return p;}}
  for(const [word,stat] of [['Aces','aces'],['Double Faults','double_faults']]){const p=genericOrNamedProp(offer,label,teams,word,stat);if(p)return p;}
 }
 if(sport==='FOOTBALL'){
  if(/^Full Time$/i.test(label)){const outcomes=threeWay(offer,teams);if(outcomes)return{key:'h2h_3way',name:'Full Time 1X2',title:label,scope:{map:null,round:null,set:null,period:'full'},line:null,last_update:latestDate(offer.outcomes||[]),outcomes};}
  if(/^Total Goals$/i.test(label)){const q=overUnder(offer);if(q)return{key:'totals',name:'Total Goals',title:label,scope:{map:null,round:null,set:null,period:'full'},line:q.line,last_update:latestDate(offer.outcomes||[]),outcomes:q.outcomes};}
  for(const [word,stat] of [['Shots on Target','shots_on_target'],['Shots','shots'],['Goals','goals'],['Assists','assists'],['Cards','cards']]){const p=genericOrNamedProp(offer,label,teams,word,stat);if(p)return p;}
 }
 return null;
}

let health={ok:false,status:null,rawEvents:0,eligibleEvents:0,deepRequests:0,acceptedEvents:0,marketCount:0,playerPropMarkets:0,bySport:{},unknownPropLikeLabels:[],errors:[],fetchedAt:new Date().toISOString()};
try{
 const board=await getJson(`${ROOT}/listView.json?lang=en_GB&market=GB`),rows=board?.events||[];health.rawEvents=rows.length;
 const selected=[];
 for(const [code,sport] of Object.entries(SPORT_MAP)){
  const xs=rows.map(row=>({row,e:row?.event||{}})).filter(x=>x.e.sport===code&&inWindow(x.e.start)&&x.e.state!=='FINISHED'&&!synthetic(x.e)).sort((a,b)=>Date.parse(a.e.start)-Date.parse(b.e.start)).slice(0,CAPS[code]||20).map(x=>({...x,sport}));
  selected.push(...xs);health.bySport[sport]={eligible:xs.length,deepEvents:0,events:0,markets:0,playerProps:0};
 }
 health.eligibleEvents=selected.length;
 const deep=await mapLimit(selected,8,async x=>{health.deepRequests++;return{...x,offers:(await getJson(`${ROOT}/betoffer/event/${x.e.id}.json?lang=en_GB&market=GB&includeParticipants=true`))?.betOffers||[]}});
 const unknown=new Set();
 for(const x of deep){if(x?.__error){health.errors.push(x.__error);continue}const {e,sport}=x,teams=eventTeams(e);if(!teams)continue;health.bySport[sport].deepEvents++;const markets=[];
  for(const offer of x.offers||[]){const m=normalize(offer,e);if(m){markets.push(m);health.marketCount++;health.bySport[sport].markets++;if(String(m.key).startsWith('player_')){health.playerPropMarkets++;health.bySport[sport].playerProps++;}}else{const label=String(offer?.criterion?.englishLabel||offer?.criterion?.label||'');if(/player|strikeout|hits|home run|total bases|rebounds|assists|three pointers|aces|double faults|shots on target/i.test(label))unknown.add(`${sport}: ${label}`);}}
  if(!markets.length)continue;
  const event={id:`unibet-kambi-direct:${e.id}`,home_team:teams[0],away_team:teams[1],commence_time:e.start,live:false,bookmakers:[{key:'unibet-kambi-direct',title:'Unibet/Kambi Direct',markets}]};
  const arr=out.sports[sport].exactV2||=[];const idx=arr.findIndex(v=>String(v.id)===event.id);if(idx>=0)arr[idx]=event;else arr.push(event);health.acceptedEvents++;health.bySport[sport].events++;
 }
 health.unknownPropLikeLabels=[...unknown].slice(0,60);health.ok=true;health.status=200;
}catch(e){health.errors.push(String(e?.message||e));health.status=500;}
for(const s of Object.keys(out.sports||{}))out.sports[s].exactV2EventCount=(out.sports[s].exactV2||[]).length;
health.errors=[...new Set(health.errors)].slice(0,20);health.fetchedAt=new Date().toISOString();out.providerHealth ||= {};out.providerHealth.kambiTraditional=health;out.generatedAt=new Date().toISOString();await fs.writeFile(FILE,JSON.stringify(out,null,2));
console.log('KAMBI_TRADITIONAL_HEALTH',JSON.stringify(health));
