import fs from 'node:fs/promises';

const tp=JSON.parse(await fs.readFile('data/owls-latest.json','utf8'));
const cmp=JSON.parse(await fs.readFile('data/owls-comparison-latest.json','utf8'));
let meta=null; try{meta=JSON.parse(await fs.readFile('data/owls-meta.json','utf8'));}catch{}
const SPORTS=['cs2','dota2','lol','valorant','american-football','baseball','basketball','soccer','tennis'];
const now=Date.now(), horizon=now+15*24*3600e3;

const aliases=new Map([
 ['natusvincere','navi'],['navi','navi'],['jd','jd'],['jdg','jd'],['jdgaming','jd'],
 ['invictus','invictus'],['invictusgaming','invictus'],['teamvitality','vitality'],['vitality','vitality'],
 ['furiaesports','furia'],['furia','furia'],['mibr','mibr'],['m80','m80'],['gamerlegion','gamerlegion'],
 ['shopifyrebelliongold','shopifyrebelliongold'],['flyquestred','flyquestred'],
 ['ctbcflyingoysteracademy','ctbcacademy'],['ctbcacademy','ctbcacademy'],['cfoacademy','ctbcacademy'],
 ['ktrolsterchallengers','ktchallengers'],['ktchallengers','ktchallengers'],['ktrolstercl','ktchallengers'],
 ['t1academy','t1academy'],['t1esportsacademy','t1academy'],['t1ea','t1academy'],
 ['fuego','fuego'],['mkoifenix','mkoifenix'],['mkoifenix','mkoifenix'],['bilibiligamingjunior','blgjunior'],['blgjunior','blgjunior'],['blgj','blgjunior'],
 ['sooperschallengers','sooperschallengers'],['soopers','sooperschallengers'],['edgyouth','edgyouth'],['edgy','edgyouth']
]);
function norm(s=''){
 let x=String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'and').replace(/\b(team|esports|gaming|club)\b/g,'').replace(/[^a-z0-9]/g,'');
 return aliases.get(x)||x;
}
function stripLine(s=''){return String(s).replace(/\s*\([+-]?\d+(?:\.\d+)?\)\s*$/,'').replace(/\s+[+-]\d+(?:\.\d+)?\s*$/,'').trim();}
function pairKey(a,b){return [norm(a),norm(b)].sort().join('|');}
function orientationKey(a,b){return norm(a)+'>'+norm(b);}
function median(xs=[]){const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function robustProbConsensus(fair=[],minSources=3){
 const pa=fair.map(x=>x.a).filter(Number.isFinite); if(pa.length<minSources)return null;
 const med=median(pa), mad=median(pa.map(x=>Math.abs(x-med)))||0;
 const tol=Math.max(0.04,3*mad);
 const kept=fair.filter(x=>Math.abs(x.a-med)<=tol);
 if(kept.length<minSources)return null;
 return {kept,pA:kept.reduce((s,x)=>s+x.a,0)/kept.length,pB:kept.reduce((s,x)=>s+x.b,0)/kept.length,medianA:med,madA:mad};
}
function tpEvents(sport){return tp?.sports?.[sport]?.data?.data||[];}
function outsideEvents(sport){const data=cmp?.sports?.[sport]?.data;const exactV2=cmp?.sports?.[sport]?.exactV2;const out=[];const seen=new Set();function walk(v,bookHint='owls'){if(!v)return;if(Array.isArray(v)){for(const x of v)walk(x,bookHint);return;}if(typeof v!=='object')return;if(v.home_team&&v.away_team&&Array.isArray(v.bookmakers)){const id=String(v.id||v.eventId||`${v.home_team}|${v.away_team}|${v.commence_time||''}`);for(const bm of (v.bookmakers.length?v.bookmakers:[{key:bookHint}])){const k=`${id}|${bm.key||bm.title||bookHint}`;if(seen.has(k))continue;seen.add(k);out.push({book:bm.key||bm.title||bookHint,event:{...v,bookmakers:[bm]}});}return;}for(const [k,x] of Object.entries(v))walk(x,k||bookHint);}walk(data);walk(exactV2,'owls-v2-exact');return out;}
function n(v){if(v===null||v===undefined||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null;}
function close(a,b,tol=.001){if(a==null||b==null)return false;return Math.abs(Number(a)-Number(b))<=tol;}
function specNumber(spec='',key){const m=String(spec).match(new RegExp(`${key}=([+-]?\\d+(?:\\.\\d+)?)`,'i'));return m?Number(m[1]):null;}
function parsedNamePoint(name=''){
 let m=String(name).match(/\(([+-]?\d+(?:\.\d+)?)\)\s*$/);if(m)return Number(m[1]);
 m=String(name).match(/\b(?:over|under)\s*([+-]?\d+(?:\.\d+)?)/i);if(m)return Number(m[1]);
 m=String(name).match(/\s([+-]\d+(?:\.\d+)?)\s*$/);return m?Number(m[1]):null;
}
function extractPoint(sel={},market={},key,role){
 const fromName=parsedNamePoint(sel.name);if(fromName!=null)return fromName;
 if(key==='totals'||key==='round_totals'){
  for(const v of [sel.total,market.baseLine,specNumber(market.specifiers,'threshold'),sel.point,sel.line]){const x=n(v);if(x!=null)return x;}
  return null;
 }
 if(key==='spreads'||key==='round_handicap'){
  const direct=n(sel.handicap);if(direct!=null)return direct;
  const base=n(market.baseLine)??specNumber(market.specifiers,'handicap');
  if(base!=null)return(role==='away'||role==='side2')?-base:base;
  for(const v of [sel.point,sel.line]){const x=n(v);if(x!=null)return x;}
  return null;
 }
 return null;
}
function scopeFromText(text=''){
 const t=String(text);
 const map=t.match(/(?:\bmap|mapnr|map_number|mapnumber|game)\s*(?:=|:|#|-)?\s*(\d+)\b/i);
 const round=t.match(/(?:\bround|roundnr|round_number|roundnumber)\s*(?:=|:|#|-)?\s*(\d+)\b/i);
 return{map:map?Number(map[1]):null,round:round?Number(round[1]):null};
}
function playerPropIdentity(m={}){
 const text=[m.nickName,m.name,m.category,m.subCategory,m.specifiers].filter(Boolean).join(' ');
 if(!/\bplayer\b/i.test(text))return null;
 const statRaw=(text.match(/\b(passing yards|rushing yards|receiving yards|receptions|passing touchdowns?|rushing touchdowns?|receiving touchdowns?|strikeouts?|hits?|home runs?|total bases|points|rebounds|assists|three pointers?|3 pointers?|kills?|headshots?|aces?|double faults?)\b/i)||[])[1];
 if(!statRaw)return null;
 const stat=canonicalPropStat(statRaw.toLowerCase().replace(/\s+/g,'_'));
 let player=specText(m.specifiers,'player')||specText(m.specifiers,'player_name')||specText(m.specifiers,'competitor')||null;
 if(!player){
  const raw=String(m.nickName||m.name||'').replace(/\bplayer\b/ig,'').replace(new RegExp(statRaw,'ig'),'')
   .replace(/\([^)]*\)/g,' ').replace(/\bmap\s*\d+\b/ig,' ').replace(/\bround\s*\d+\b/ig,' ')
   .replace(/\b(over|under|total|props?)\b/ig,' ').replace(/[|:–—-]+/g,' ').replace(/\s+/g,' ').trim();
  player=raw||null;
 }
 return player?{player:String(player).trim(),stat}:null;
}
function specText(spec='',key){
 const m=String(spec).match(new RegExp('(?:^|[;&,|])\\s*'+key+'=([^;&,|]+)','i'));
 return m?decodeURIComponent(String(m[1]).trim()):null;
}
function propPoint(sel={},market={}){
 for(const v of [sel.total,sel.point,sel.line,market.baseLine,specNumber(market.specifiers,'threshold'),specNumber(market.specifiers,'line')]){const x=n(v);if(x!=null)return x;}
 return parsedNamePoint(sel.name);
}
function classifyMarket(m={}){
 const text=`${m.nickName||''} ${m.name||''}`.toLowerCase();
 const prop=playerPropIdentity(m); if(prop)return 'player_prop';
 // Compound/correlated props are not interchangeable with a plain total/spread.
 // Fail closed until an outside source exposes the same compound contract.
 if(/\b(to win and|win and total|winner and total|and total games|and total points)\b/i.test(text))return null;
 if(/round/.test(text)&&/(handicap|spread)/.test(text))return 'round_handicap';
 if(/round/.test(text)&&/total/.test(text))return 'round_totals';
 if(!/round/.test(text)&&/(handicap|spread)/.test(text))return 'spreads';
 if(!/round/.test(text)&&/total/.test(text))return 'totals';
 if(/map/.test(text)&&/\bwinner\b/.test(text)&&!/round/.test(text))return 'map_winner';
 if(/\b(winner|moneyline)\b/.test(text)&&!(/map|round/.test(text)))return 'h2h';
 return null;
}
function makeSelections(m,key,e){
 const raw=(m.selections||[]).filter(s=>n(s.odds)>1);if(raw.length<2)return null;
 if(key==='player_prop'){
  const over=raw.find(s=>/^over\b/i.test(String(s.name||''))||String(s.type||'').toLowerCase()==='over');
  const under=raw.find(s=>/^under\b/i.test(String(s.name||''))||String(s.type||'').toLowerCase()==='under');
  if(!over||!under)return null; const point=propPoint(over,m)??propPoint(under,m); if(point==null)return null;
  return [{name:over.name,role:'over',odds:n(over.odds),point},{name:under.name,role:'under',odds:n(under.odds),point}];
 }
 if(key==='totals'||key==='round_totals'){
  const over=raw.find(s=>/^over\b/i.test(String(s.name||''))||String(s.type||'').toLowerCase()==='over');
  const under=raw.find(s=>/^under\b/i.test(String(s.name||''))||String(s.type||'').toLowerCase()==='under');
  if(!over||!under)return null;
  const result=[over,under].map((s,i)=>({name:s.name,role:i===0?'over':'under',odds:n(s.odds),point:extractPoint(s,m,key,i===0?'over':'under')}));
  if(result.some(s=>s.point==null)||!close(result[0].point,result[1].point))return null;
  return result;
 }
 const homeName=e?.teams?.home?.name||e?.market?.home?.name;const awayName=e?.teams?.away?.name||e?.market?.away?.name;
 const home=raw.find(s=>norm(stripLine(s.name))===norm(homeName)||String(s.type||'').toLowerCase()==='home');
 const away=raw.find(s=>norm(stripLine(s.name))===norm(awayName)||String(s.type||'').toLowerCase()==='away');
 if(home&&away){
  const result=[home,away].map((s,i)=>({name:s.name,role:i===0?'home':'away',odds:n(s.odds),point:key==='h2h'||key==='map_winner'?null:extractPoint(s,m,key,i===0?'home':'away')}));
  if((key==='spreads'||key==='round_handicap')&&(result.some(s=>s.point==null)||!close(result[0].point,-result[1].point)))return null;
  return result;
 }
 if((key==='map_winner'||key==='h2h')&&raw.length===2)return raw.slice(0,2).map((s,i)=>({name:s.name,role:i===0?'side1':'side2',odds:n(s.odds),point:null}));
 return null;
}
function tpMarkets(e){
 const out=[];
 if(n(e?.market?.home?.odds)>1&&n(e?.market?.away?.odds)>1)out.push({key:'h2h',label:'Match Winner',scope:{map:null,round:null},selections:[{name:e.market.home.name,role:'home',odds:n(e.market.home.odds),point:null},{name:e.market.away.name,role:'away',odds:n(e.market.away.odds),point:null}]});
 for(const m of e?.preferredMarkets||[]){const key=classifyMarket(m);if(!key)continue;if(key==='totals'&&totalTarget(m,e)==='__unknown_team_total__')continue;const selections=makeSelections(m,key,e);if(!selections)continue;const label=m.nickName||m.name||key;const scope=scopeFromText(`${m.nickName||''} ${m.name||''} ${m.specifiers||''}`);const prop=key==='player_prop'?playerPropIdentity(m):null;if((key==='map_winner'||key==='round_totals'||key==='round_handicap')&&scope.map==null&&scope.round==null)continue;out.push({key,label,scope,selections,prop});}
 const seen=new Set();return out.filter(m=>{const k=`${m.key}|${m.prop?.player??''}|${m.prop?.stat??''}|${m.scope.map??''}|${m.scope.round??''}|${m.selections.map(s=>`${norm(stripLine(s.name))}:${s.odds}:${s.point}`).join('|')}`;if(seen.has(k))return false;seen.add(k);return true;});
}
function outsideMarkets(event,key){const found=[];for(const bm of event?.bookmakers||[]){for(const m of bm.markets||[]){{
 const mk=String(m.key||'').toLowerCase().replace(/[- ]/g,'_');
 const wanted=key==='map_winner'?['map_winner','map_moneyline','map_h2h','map_match_winner']:
  key==='round_handicap'?['round_handicap','round_spread','rounds_handicap','rounds_spread']:
  key==='round_totals'?['round_totals','round_total','total_rounds','rounds_total']:
  [key];
 const isProp=key==='player_prop'&&(/^(player_|batter_|pitcher_)/.test(mk)||/(kills?|headshots?|aces?|double_faults?|strikeouts?|passing|rushing|receiving|receptions|points|rebounds|assists|home_runs?|total_bases|hits?)/.test(mk));
 if((key==='player_prop'&&isProp)||(key!=='player_prop'&&wanted.includes(mk)))found.push({bookmaker:bm.key||bm.title,market:m});
}}}return found;}
function canonicalPropStat(v=''){
 let x=String(v).toLowerCase().replace(/[- ]+/g,'_').replace(/^(player|batter|pitcher)_/,'').replace(/_(over_under|totals?|props?)$/,'');
 // Provider prop keys often append contract scope (e.g. kills_maps_1_2).
 // Remove scope before canonicalizing the stat; scope is verified separately.
 x=x.replace(/_(?:maps?|games?)_\d+(?:_\d+)*$/,'').replace(/_(?:first|second)_half$/,'');
 const map={pass_yds:'passing_yards',passing_yds:'passing_yards',rush_yds:'rushing_yards',rushing_yds:'rushing_yards',rec_yds:'receiving_yards',receiving_yds:'receiving_yards',receptions:'receptions',pass_tds:'passing_touchdown',passing_tds:'passing_touchdown',rush_tds:'rushing_touchdown',receiving_tds:'receiving_touchdown',strikeouts:'strikeout',hits:'hit',home_runs:'home_run',total_bases:'total_base',points:'point',rebounds:'rebound',assists:'assist',threes:'three_pointer',three_pointers:'three_pointer',kills:'kill',headshots:'headshot',aces:'ace',double_faults:'double_fault'};
 return map[x]||x.replace(/s$/,'');
}
function cleanPlayerName(v=''){
 return String(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/\s*\([^)]*\)\s*$/,'').replace(/\b(over|under)\b/ig,' ')
  .replace(/[^a-zA-Z0-9.' -]/g,' ').replace(/\s+/g,' ').trim();
}
function outsidePropIdentity(m={}){
 const mk=String(m.key||'').toLowerCase().replace(/[- ]/g,'_');
 const stat=canonicalPropStat(mk);
 const outs=m.outcomes||[];
 const desc=outs.map(o=>o.description).find(Boolean)||m.player||m.player_name||m.playerName||
   String(m.description||'').replace(/^total\s+[^-]+-\s*/i,'');
 const player=cleanPlayerName(desc);
 return player&&stat?{player,stat}:null;
}
function periodScope(text=''){
 const t=String(text).toLowerCase();
 const innings=(t.match(/(?:first|1st)\s*(\d+)\s*innings?/)||t.match(/\b(\d+)\s*innings?\b/))?.[1];
 const set=(t.match(/(?:first|1st|set)\s*(?:set\s*)?(\d+)/)||t.match(/\bset\s*(\d+)\b/))?.[1];
 const quarter=(t.match(/(?:quarter|q)\s*(\d+)/))?.[1];
 const half=(t.match(/(?:half|h)\s*(\d+)/))?.[1];
 if(innings)return 'innings:'+Number(innings);
 if(set)return 'set:'+Number(set);
 if(quarter)return 'quarter:'+Number(quarter);
 if(half)return 'half:'+Number(half);
 if(/first\s*half|1st\s*half/.test(t))return 'half:1';
 if(/second\s*half|2nd\s*half/.test(t))return 'half:2';
 return 'full';
}
function marketIdentityText(m={}){return [m.nickName,m.name,m.title,m.description,m.specifiers,m.market_name,m.marketName,m.period,m.period_name,m.periodName,m.scope,m.group,m.group_name,m.team,m.team_name,m.teamName].filter(v=>v!=null).map(v=>typeof v==='object'?JSON.stringify(v):String(v)).join(' ');}
function totalTarget(m={},event=null){
 const text=marketIdentityText(m);
 const explicit=m.team||m.team_name||m.teamName||specText(m.specifiers,'team')||specText(m.specifiers,'competitor')||null;
 const home=event?.teams?.home?.name||event?.market?.home?.name||event?.home_team;
 const away=event?.teams?.away?.name||event?.market?.away?.name||event?.away_team;
 if(explicit){
  if(home&&norm(explicit)===norm(home))return norm(home);
  if(away&&norm(explicit)===norm(away))return norm(away);
  return norm(explicit);
 }
 if(/team\s*total/i.test(text)){
  if(home&&norm(text).includes(norm(home)))return norm(home);
  if(away&&norm(text).includes(norm(away)))return norm(away);
  return '__unknown_team_total__';
 }
 return null;
}
function outsideScope(m={}){
 const raw=marketIdentityText(m);
 return scopeFromText(raw);
}
function findOutcome(outcomes,sel,key){
 if(key==='player_prop'){if(sel.point==null)return null;return outcomes.find(o=>String(o.name||'').toLowerCase()===sel.role&&n(o.point)!=null&&close(n(o.point),sel.point));}
 if(key==='totals'||key==='round_totals'){if(sel.point==null)return null;return outcomes.find(o=>String(o.name||'').toLowerCase()===sel.role&&n(o.point)!=null&&close(n(o.point),sel.point));}
 if(key==='spreads'||key==='round_handicap'){if(sel.point==null)return null;return outcomes.find(o=>norm(stripLine(o.name))===norm(stripLine(sel.name))&&n(o.point)!=null&&close(n(o.point),sel.point));}
 return outcomes.find(o=>norm(stripLine(o.name))===norm(stripLine(sel.name)));
}
function exactContractKey(sport,event,d){
 const teams=pairKey(event?.home_team||event?.teams?.home?.name||'',event?.away_team||event?.teams?.away?.name||'');
 const map=d.scope?.map??''; const round=d.scope?.round??'';
 const pts=(d.selections||[]).map(x=>x.point==null?'':Number(x.point)).join('/');
 return [sport,teams,d.key,'player='+(d.prop?.player??''),'stat='+(d.prop?.stat??''),'map='+map,'round='+round,'points='+pts,'pregame'].join('|');
}
function quoteFor(row,d){
 const found=[];
 const eventHome=row.event?.home_team,eventAway=row.event?.away_team;
 const tpHome=d.selections.find(x=>x.role==='home')?.name||d.selections[0]?.name;
 const tpAway=d.selections.find(x=>x.role==='away')?.name||d.selections[1]?.name;
 const pairAligned=pairKey(eventHome,eventAway)===pairKey(tpHome,tpAway);
 if(!pairAligned && !['totals','round_totals','player_prop'].includes(d.key)) return found;
 const orientationAligned=orientationKey(eventHome,eventAway)===orientationKey(tpHome,tpAway);
 // Never allow a reversed provider event to be treated as the same named-side
 // contract. This is the main fail-closed guard against giant false EV.
 if(!orientationAligned && !['totals','round_totals','player_prop'].includes(d.key)) return found;
 for(const c of outsideMarkets(row.event,d.key)){
  if(d.key==='player_prop'){
   const raw=marketIdentityText(c.market); const op=outsidePropIdentity(c.market)||playerPropIdentity(c.market);
   const outPlayer=op?.player||specText(c.market?.specifiers,'player')||specText(c.market?.specifiers,'player_name');
   const outStat=canonicalPropStat(op?.stat||c.market?.key||'');
   if(!outPlayer||norm(cleanPlayerName(outPlayer))!==norm(cleanPlayerName(d.prop?.player||'')))continue;
   if(!outStat||norm(outStat)!==norm(canonicalPropStat(d.prop?.stat||'')))continue;
   // PropLine's per-event props endpoint is full-game by contract. Only reject
   // a scope mismatch when the outside market explicitly identifies a period.
   const outsidePeriod=periodScope(raw),tpPeriod=periodScope(d.label||'');
   if(outsidePeriod!=='full'&&tpPeriod!==outsidePeriod)continue;
   if(outsidePeriod==='full'&&tpPeriod!=='full')continue;
   const tpMap=d.scope?.map??null;
   const mk=String(c.market?.key||'').toLowerCase().replace(/[- ]/g,'_');
   const range=mk.match(/_(?:maps?|games?)_(\d+)_(\d+)$/), single=mk.match(/_(?:map|game)_(\d+)$/);
   const outMap=single?Number(single[1]):null;
   // A combined Maps 1+2 contract is not the same as a single-map prop.
   if(range){if(tpMap!=null)continue;}
   else if(tpMap!=null&&outMap!==tpMap)continue;
   else if(tpMap==null&&outMap!=null)continue;
  }
  // Team totals are distinct contracts from game totals and from the other
  // team's total. Never compare them using line alone.
  if(d.key==='totals'){
   const tpTarget=totalTarget({name:d.label,specifiers:d.specifiers||''},{teams:{home:{name:tpHome},away:{name:tpAway}}});
   const outTarget=totalTarget(c.market,row.event);
   if(tpTarget==='__unknown_team_total__')continue;
   if((tpTarget||null)!==(outTarget||null))continue;
  }
  // Period identity is mandatory for totals/spreads. A 1st-7-innings total,
  // set total, quarter line, etc. can never fall back to a full-game market.
  if(['totals','spreads'].includes(d.key)){
   const tpPeriod=periodScope(d.label||'');
   const outPeriod=periodScope(marketIdentityText(c.market));
   if(tpPeriod!==outPeriod)continue;
  }
  const outs=c.market?.outcomes||[];if(outs.length<2)continue;
  const a=findOutcome(outs,d.selections[0],d.key),b=findOutcome(outs,d.selections[1],d.key);if(!a||!b)continue;
  if(!['totals','round_totals','player_prop'].includes(d.key)){
   const aName=norm(stripLine(a.name)),bName=norm(stripLine(b.name));
   const ta=norm(stripLine(d.selections[0].name)),tb=norm(stripLine(d.selections[1].name));
   if(aName!==ta||bName!==tb||aName===bName)continue;
  }
  const pa=n(a.price),pb=n(b.price);if(!(pa>1&&pb>1))continue;
  const os=outsideScope(c.market);let identityVerified=true,identityReason=null;
  if((d.key==='map_winner'||d.key==='round_totals'||d.key==='round_handicap')&&(d.scope.map!=null||d.scope.round!=null)){
   if((d.scope.map!=null&&os.map==null)||(d.scope.round!=null&&os.round==null)){identityVerified=false;identityReason='normalized market lacks exact map/round scope; raw-source verification required';}
   else if((d.scope.map!=null&&!close(d.scope.map,os.map,0))||(d.scope.round!=null&&!close(d.scope.round,os.round,0)))continue;
  }
  found.push({book:row.book||c.bookmaker,a:pa,b:pb,identityVerified,identityReason,lastUpdate:c.market?.last_update||null});
 }
 return found;
}
function oneWayPlayerPropScreens(row,d){
 if(d.key!=='player_prop')return [];
 const tpPlayer=norm(cleanPlayerName(d.prop?.player||'')),tpStat=canonicalPropStat(d.prop?.stat||'');
 const over=d.selections.find(x=>x.role==='over'); if(!tpPlayer||!over)return [];
 const out=[];
 for(const c of outsideMarkets(row.event,'player_prop')){
  const mk=String(c.market?.key||'').toLowerCase().replace(/[- ]/g,'_');
  let stat=null,requiredPoint=null;
  if(/(?:player|batter)_to_record_a_hit|to_record_a_hit/.test(mk)){stat='hit';requiredPoint=0.5;}
  else if(/(?:player|batter)_to_hit_a_home_run|home_run/.test(mk)&&/to_/.test(mk)){stat='home_run';requiredPoint=0.5;}
  if(!stat||norm(stat)!==norm(tpStat)||!close(over.point,requiredPoint))continue;
  for(const o of c.market?.outcomes||[]){
   if(norm(cleanPlayerName(o.name||o.description||''))!==tpPlayer)continue;
   const raw=Number(o.price);let price=null;
   if(raw>1&&raw<100)price=raw;else if(raw>=100)price=1+raw/100;else if(raw<=-100)price=1+100/Math.abs(raw);
   if(!(price>1))continue;
   out.push({sport:row.sport||null,book:row.book||c.bookmaker,player:d.prop.player,stat:tpStat,line:over.point,side:'Over',thunderpick:over.odds,outsidePrice:price,marketKey:mk,marketLabel:d.label,startTime:row.event?.commence_time||row.event?.start_time||null,blocker:'one-way outside price only; exact semantic contract but no two-sided de-vig, SCREENING ONLY'});
  }
 }
 return out;
}
function arbDetector(d,outside){
 const combos=[];const[a,b]=d.selections;
 for(const q of outside){
  if(q.b>1&&a.odds>1){const sum=1/a.odds+1/q.b;combos.push({thunderpickSide:a.name,thunderpickOdds:a.odds,outsideSide:b.name,outsideOdds:q.b,outsideBook:q.book,arbSum:sum,grossRoi:1/sum-1,identityVerified:q.identityVerified,identityReason:q.identityReason});}
  if(q.a>1&&b.odds>1){const sum=1/b.odds+1/q.a;combos.push({thunderpickSide:b.name,thunderpickOdds:b.odds,outsideSide:a.name,outsideOdds:q.a,outsideBook:q.book,arbSum:sum,grossRoi:1/sum-1,identityVerified:q.identityVerified,identityReason:q.identityReason});}
 }
 combos.sort((x,y)=>x.arbSum-y.arbSum);const best=combos[0]||null;return best?{...best,trueArb:best.arbSum<1,nearArb:best.arbSum>=1&&best.arbSum<=1.005}:null;
}


// Diagnostic: capture real outside esports derivative market schemas when exact matcher still returns zero.
const derivativeSchemaSamples={};
for(const sport of SPORTS){
 const samples=[];
 for(const row of outsideEvents(sport)){
  for(const bm of row.event?.bookmakers||[]){
   for(const m of bm.markets||[]){
    const raw=[m.key,m.name,m.title,m.description,m.specifiers,m.market_name,m.marketName,m.period,m.period_name,m.scope,m.group].filter(v=>v!=null).map(v=>typeof v==='object'?JSON.stringify(v):String(v)).join(' ');
    if(/map|round/i.test(raw)){
     samples.push({book:row.book||bm.key||bm.title,event:`${row.event?.home_team||''} vs ${row.event?.away_team||''}`,key:m.key||null,name:m.name||null,title:m.title||null,description:m.description||null,specifiers:m.specifiers||null,period:m.period||m.period_name||null,scope:m.scope||null,outcomes:(m.outcomes||[]).slice(0,3)});
     if(samples.length>=40)break;
    }
   }
   if(samples.length>=40)break;
  }
  if(samples.length>=40)break;
 }
 derivativeSchemaSamples[sport]=samples;
}
await fs.writeFile('data/esports-derivative-schema.json',JSON.stringify({generatedAt:new Date().toISOString(),derivativeSchemaSamples},null,2));
const playerPropSchemaSamples={thunderpick:[],outside:[]};
for(const sport of SPORTS){
 let tpN=0,outN=0;
 for(const e of tpEvents(sport)){
  for(const m of e?.preferredMarkets||[]){
   if(classifyMarket(m)!=='player_prop')continue;
   playerPropSchemaSamples.thunderpick.push({sport,event:`${e?.teams?.home?.name||e?.market?.home?.name||''} vs ${e?.teams?.away?.name||e?.market?.away?.name||''}`,key:m.key||null,name:m.name||null,nickName:m.nickName||null,category:m.category||null,subCategory:m.subCategory||null,specifiers:m.specifiers||null,selections:(m.selections||[]).slice(0,2)});
   if(++tpN>=8)break;
  }
  if(tpN>=8)break;
 }
 for(const row of outsideEvents(sport)){
  for(const bm of row.event?.bookmakers||[])for(const m of bm.markets||[]){
   const mk=String(m.key||'').toLowerCase();
   if(!(/^(player_|batter_|pitcher_)/.test(mk)||/(kills?|headshots?|aces?|strikeouts?|passing|rushing|receiving|receptions|points|rebounds|assists)/.test(mk)))continue;
   playerPropSchemaSamples.outside.push({sport,book:row.book||bm.key||bm.title,event:`${row.event?.home_team||''} vs ${row.event?.away_team||''}`,key:m.key||null,name:m.name||null,description:m.description||null,specifiers:m.specifiers||null,outcomes:(m.outcomes||[]).slice(0,2)});
   if(++outN>=12)break;
  }
  if(outN>=12)break;
 }
}
await fs.writeFile('data/player-prop-schema.json',JSON.stringify({generatedAt:new Date().toISOString(),playerPropSchemaSamples},null,2));
console.log('PLAYER_PROP_SCHEMA_SAMPLES','tp='+playerPropSchemaSamples.thunderpick.length,'outside='+playerPropSchemaSamples.outside.length);


const all=[];let eligibleEvents=0,eligibleMarkets=0,matchedMarkets=0;const matchedEventIds=new Set();const rawExactQuoteMatchesByType={};const limitedExactComparisons=[];
const eligibleBySport={},matchedBySport={},marketTypeCounts={};
const oneWayPlayerPropScreensOut=[];
for(const sport of SPORTS){
 eligibleBySport[sport]=0;matchedBySport[sport]=0;
 const idx=new Map();for(const row of outsideEvents(sport)){const e=row.event;if(e.live===true||String(e.status||'').toLowerCase()==='live')continue;const k=pairKey(e.home_team,e.away_team);if(!idx.has(k))idx.set(k,[]);idx.get(k).push(row);}
 for(const e of tpEvents(sport)){
  const t=Date.parse(e.startTime);if(!Number.isFinite(t)||t<now||t>horizon||e.isLive)continue;
  const markets=tpMarkets(e);if(!markets.length)continue;eligibleEvents++;eligibleBySport[sport]++;
  const rows=idx.get(pairKey(e.teams?.home?.name||e.market?.home?.name,e.teams?.away?.name||e.market?.away?.name))||[];let eventMatched=false;
  for(const d of markets){
   eligibleMarkets++;marketTypeCounts[d.key]??={eligible:0,matched:0,candidates:0};marketTypeCounts[d.key].eligible++;
   const outside=[];for(const row of rows)outside.push(...quoteFor(row,d));
   if(d.key==='player_prop')for(const row of rows)oneWayPlayerPropScreensOut.push(...oneWayPlayerPropScreens(row,d));
   if(!outside.length)continue;
   rawExactQuoteMatchesByType[d.key]=(rawExactQuoteMatchesByType[d.key]||0)+1;
   let saneOutside=outside.filter(q=>{const sum=1/q.a+1/q.b;return q.identityVerified!==false&&q.a>1.01&&q.b>1.01&&q.a<20&&q.b<20&&sum>=0.90&&sum<=1.15;});
   // Provider orientation guard: when 3+ books disagree on which named team is
   // favorite, discard the minority orientation before EV/arb calculations.
   if(!['totals','round_totals'].includes(d.key)&&saneOutside.length>=3){
    const votes=saneOutside.map(q=>Math.sign(q.b-q.a)).filter(Boolean);
    const pos=votes.filter(v=>v>0).length,neg=votes.filter(v=>v<0).length;
    const direction=pos>neg?1:neg>pos?-1:0;
    // A tied/ambiguous favorite orientation is unsafe: do not calculate EV/arb.
    if(!direction) continue;
    saneOutside=saneOutside.filter(q=>Math.sign(q.b-q.a)===direction);
   }
   // Require >=3 independent books for ACTION/WATCH math. A two-book screen
   // remains diagnostic only and cannot create a candidate or arbitrage.
   const uniqueBooks=new Set(saneOutside.map(q=>String(q.book||'').toLowerCase()).filter(Boolean));
   if(saneOutside.length<3||uniqueBooks.size<3){if(['map_winner','round_handicap','round_totals','player_prop'].includes(d.key)&&saneOutside.length){limitedExactComparisons.push({sport,eventId:e.id,name:e.name,startTime:e.startTime,marketKey:d.key,marketLabel:d.label,scope:d.scope,thunderpick:d.selections,outside:saneOutside,independentSources:uniqueBooks.size,blocker:'fewer than 3 independent exact-scope sources; SCREENING ONLY'});}continue;}
   matchedMarkets++;marketTypeCounts[d.key].matched++;eventMatched=true;
   const fair=saneOutside.map(q=>{const ia=1/q.a,ib=1/q.b,z=ia+ib;return{book:q.book,a:ia/z,b:ib/z,identityVerified:q.identityVerified};});
   const verified=fair.filter(x=>x.identityVerified),base=verified.length?verified:fair;
   const consensus=robustProbConsensus(base,3); if(!consensus)continue;
   saneOutside=saneOutside.filter(q=>consensus.kept.some(k=>String(k.book).toLowerCase()===String(q.book).toLowerCase()));
   const pA=consensus.pA,pB=consensus.pB;
   const evA=d.selections[0].odds*pA-1,evB=d.selections[1].odds*pB-1,arbScreen=arbDetector(d,saneOutside);
   // Hard anomaly quarantine: an apparent >=50% edge at 3+ books is much more
   // likely to be a contract/orientation mismatch. Keep it out of ACTION math.
   if(Math.max(evA,evB)>=0.50)continue;
   const independentSources=new Set(saneOutside.map(q=>String(q.book).toLowerCase())).size;
   const verifiedIndependentSources=new Set(saneOutside.filter(q=>q.identityVerified).map(q=>String(q.book).toLowerCase())).size;
   const verificationTier=verifiedIndependentSources>=5?'ACTION_ELIGIBLE':verifiedIndependentSources>=3?'WATCH_ONLY':verifiedIndependentSources===2?'SCREENING_ONLY':'INFORMATIONAL_ONLY';
   const row={sport,eventId:e.id,name:e.name,startTime:e.startTime,prop:d.prop||null,exactContractKey:exactContractKey(sport,e,d),marketKey:d.key,marketLabel:d.label,scope:d.scope,thunderpick:{a:d.selections[0],b:d.selections[1]},sourceDepth:saneOutside.length,verifiedIdentityDepth:saneOutside.filter(q=>q.identityVerified).length,independentSources,verifiedIndependentSources,verificationTier,actionEligible:verifiedIndependentSources>=5,watchEligible:verifiedIndependentSources>=3,outside:saneOutside,fair:{aProbability:pA,bProbability:pB,aOdds:1/pA,bOdds:1/pB},ev:{a:evA,b:evB},arbScreen,identityVerified:saneOutside.some(q=>q.identityVerified),plausible:Math.max(evA,evB)>=-0.01||Boolean(arbScreen?.trueArb||arbScreen?.nearArb)};
   if(row.plausible)marketTypeCounts[d.key].candidates++;all.push(row);
  }
  if(eventMatched){matchedEventIds.add(`${sport}:${e.id}`);matchedBySport[sport]++;}
 }
}
all.sort((x,y)=>Math.max(y.ev.a,y.ev.b)-Math.max(x.ev.a,x.ev.b));
const maxEv=x=>Math.max(Number(x?.ev?.a??-Infinity),Number(x?.ev?.b??-Infinity));
const actionCandidates=all.filter(x=>x.actionEligible&&maxEv(x)>=0.02);
const watchCandidates=all.filter(x=>x.watchEligible&&((!x.actionEligible&&maxEv(x)>=0.01)||(x.actionEligible&&maxEv(x)>=0.01&&maxEv(x)<0.02)||x.arbScreen?.trueArb||x.arbScreen?.nearArb));
const potentialCandidates=all.filter(x=>maxEv(x)>=0.0025&&maxEv(x)<0.01);
const arbScreens=all.filter(x=>x.identityVerified&&(x.arbScreen?.trueArb||x.arbScreen?.nearArb)).sort((a,b)=>a.arbScreen.arbSum-b.arbScreen.arbSum);
const snapshotHealth={manifestPresent:Boolean(meta),generatedAt:meta?.generatedAt||tp.generatedAt||null,snapshotBytes:meta?.snapshotBytes??null,successfulSports:meta?.successfulSports||tp.successfulSports||[],failedSports:meta?.failedSports||tp.failedSports||[],totalEvents:meta?.totalEvents??null,totalRetainedMarkets:meta?.totalRetainedMarkets??null,sportEventCounts:Object.fromEntries(Object.entries(meta?.sports||{}).map(([sport,row])=>[sport,row?.eventCount??null])),healthy:Boolean((meta?.generatedAt||tp.generatedAt)&&!(meta?.failedSports||tp.failedSports||[]).length)};
const oneWayUnique=[...new Map(oneWayPlayerPropScreensOut.map(r=>[[r.sport,r.book,r.player,r.stat,r.line,r.side].join('|'),r])).values()].slice(0,100);
const output={generatedAt:new Date().toISOString(),thunderpickGeneratedAt:tp.generatedAt,comparisonGeneratedAt:cmp.generatedAt,horizonDays:15,snapshotHealth,eligibleThunderpickEvents:eligibleEvents,matchedEvents:matchedEventIds.size,unmatchedEvents:eligibleEvents-matchedEventIds.size,eligibleMarkets,matchedMarkets,unmatchedMarkets:eligibleMarkets-matchedMarkets,eligibleBySport,matchedBySport,marketTypeCounts,rawExactQuoteMatchesByType,limitedExactComparisons:limitedExactComparisons.slice(0,100),oneWayPlayerPropScreens:oneWayUnique,arbitrageMarketsTested:matchedMarkets,arbScreenCount:arbScreens.length,arbScreens,actionCandidates,watchCandidates,potentialCandidates,candidates:all.filter(x=>x.plausible),topScreens:all.slice(0,100)};
await fs.writeFile('data/screen-latest.json',JSON.stringify(output,null,2));
console.log(`Eligible events=${eligibleEvents}, matched events=${matchedEventIds.size}, eligible markets=${eligibleMarkets}, matched markets=${matchedMarkets}, candidates=${output.candidates.length}, arbScreens=${arbScreens.length}, snapshotHealthy=${snapshotHealth.healthy}`);
