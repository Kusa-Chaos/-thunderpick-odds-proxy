const clean=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
const num=v=>v===null||v===undefined||v===''?'':Number.isFinite(Number(v))?String(Number(v)):clean(v);

export const SPORT_ALIASES={nfl:'american-football',american_football:'american-football','american football':'american-football',mlb:'baseball',nba:'basketball','league of legends':'lol','dota 2':'dota2','counter-strike 2':'cs2','counter strike 2':'cs2'};
export const canonSport=v=>SPORT_ALIASES[clean(v)]||clean(v);

export function statType(v=''){
  const x=clean(v);
  const defs=[['passing_yards',/passing yards?/],['rushing_yards',/rushing yards?/],['receiving_yards',/receiving yards?/],['receptions',/receptions?/],['passing_tds',/passing (?:touchdowns?|tds?)/],['completions',/completions?/],['passing_attempts',/passing attempts?|pass attempts?/],['interceptions',/interceptions?/],['rushing_attempts',/rushing attempts?|rush attempts?/],['points',/\bpoints?\b/],['rebounds',/rebounds?/],['assists',/assists?/],['threes',/three[- ]?pointers?|3[- ]?pointers?|3pt/],['steals',/steals?/],['blocks',/blocks?/],['turnovers',/turnovers?/],['pra',/points.*rebounds.*assists|\bpra\b/],['strikeouts',/strikeouts?|\bks\b/],['hits',/\bhits?\b/],['total_bases',/total bases?/],['runs',/\bruns?\b/],['rbi',/\brbis?\b/],['home_runs',/home runs?/],['walks',/\bwalks?\b/],['aces',/\baces?\b/],['double_faults',/double faults?/],['shots_on_target',/shots? on target/],['shots',/\bshots?\b/],['goals',/\bgoals?\b/],['cards',/\bcards?\b/],['kills',/\bkills?\b/],['deaths',/\bdeaths?\b/],['headshots',/headshots?/]];
  return defs.find(([,re])=>re.test(x))?.[0]||null;
}

export function marketFamily(v=''){
  const x=clean(v);
  if(/round.*handicap|handicap.*round/.test(x))return'round_handicap';
  if(/round.*total|total.*round/.test(x))return'round_total';
  if(/map.*handicap|handicap.*map/.test(x))return'map_handicap';
  if(/map.*winner|winner.*map/.test(x))return'map_winner';
  if(/player|passing|rushing|receiving|receptions?|touchdowns?|attempts?|completions?|interceptions?|points?|rebounds?|assists?|three[- ]?pointers?|3[- ]?pointers?|steals?|blocks?|turnovers?|strikeouts?|total bases|home runs?|\brbi\b|\bwalks?\b|\baces?\b|double faults?|shots? on target|\bshots?\b|\bcards?\b|\bkills?\b|\bdeaths?\b|headshots?/.test(x))return'player_prop';
  if(/moneyline|money line|match winner|h2h|\bwinner\b/.test(x))return'ml';
  if(/spread|handicap/.test(x))return'spread';
  if(/total|over\/under|over under/.test(x))return'total';
  return x.replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')||'unknown';
}

function inferredScope(marketText=''){
  const x=clean(marketText);
  const map=x.match(/\bmap\s*(\d+)\b/i)?.[1]||'';
  const set=x.match(/\bset\s*(\d+)\b/i)?.[1]||'';
  const numberedRound=x.match(/\bround\s*(\d+)\b/i)?.[1]||'';
  let period='';
  if(/\b(?:1st|first)\s+half\b/.test(x))period='1h';
  else if(/\b(?:2nd|second)\s+half\b/.test(x))period='2h';
  else if(/\b(?:1st|first)\s+(?:quarter|qtr)\b/.test(x))period='q1';
  else if(/\b(?:2nd|second)\s+(?:quarter|qtr)\b/.test(x))period='q2';
  else if(/\b(?:3rd|third)\s+(?:quarter|qtr)\b/.test(x))period='q3';
  else if(/\b(?:4th|fourth)\s+(?:quarter|qtr)\b/.test(x))period='q4';
  return {map,set,round:numberedRound,period};
}

function playerNameFrom(r={},marketText=''){
  const explicit=clean(r.player||'');
  if(explicit&&explicit!=='over'&&explicit!=='under')return explicit;
  const text=String(marketText||'').trim();
  let m=text.match(/^player\s+(.+?)\s*-\s*(?:total\s+)?/i);
  if(m?.[1])return clean(m[1]);
  m=text.match(/^(.+?)\s*[—–-]\s*(?:passing|rushing|receiving|receptions?|touchdowns?|attempts?|completions?|interceptions?|points?|rebounds?|assists?|three[- ]?pointers?|3[- ]?pointers?|steals?|blocks?|turnovers?|strikeouts?|total bases|home runs?|rbi|walks?|aces?|double faults?|shots?|cards?|kills?|deaths?|headshots?)/i);
  if(m?.[1])return clean(m[1]);
  const rawTarget=String(r.target||r.selection||'').trim();
  m=rawTarget.match(/^(.+?)\s+(?:over|under)\s+[+-]?\d+(?:\.\d+)?\s*$/i);
  if(m?.[1])return clean(m[1]);
  const c=clean(rawTarget);
  if(c&&c!=='over'&&c!=='under'&&!/^over\b|^under\b/.test(c))return c;
  return '';
}

function playerSideFrom(r={},marketText=''){
  const candidates=[r.selectionSide,r.side,r.target,r.selection,marketText].map(v=>String(v??''));
  for(const c of candidates){const m=c.match(/\b(over|under)\b/i);if(m)return clean(m[1]);}
  return '';
}

export function exactIdentity(r={}){
  const scope=r.scope||{};
  const marketText=r.marketLabel||r.market||r.marketKey||'';
  const family=marketFamily(marketText);
  const inferred=inferredScope(marketText);
  const target=family==='player_prop'?playerNameFrom(r,marketText):(r.target||r.player||r.selection||r.side||'');
  const line=r.line??r.point??r.handicap??r.total??'';
  const period=scope.period??r.period??scope.half??r.half??inferred.period??'';
  const map=scope.map??r.map??r.mapNumber??inferred.map??'';
  const round=scope.round??r.round??inferred.round??'';
  const set=scope.set??r.set??inferred.set??'';
  const live=r.isLive===true||clean(r.state)==='live'?'live':'prematch';
  const settlement=scope.settlement??r.settlementScope??r.settlement??'standard';
  const stat=family==='player_prop'?(r.statType||statType(marketText)||'unknown'):'';
  const side=family==='player_prop'?playerSideFrom(r,marketText):clean(r.side||r.selectionSide||'');
  return {sport:canonSport(r.sport),event:clean(r.eventId||r.match||r.name),family,target:clean(target),stat,line:num(line),period:clean(period),map:num(map),round:num(round),set:num(set),side,state:live,settlement:clean(settlement)};
}

export function exactKey(r={}){
  const i=exactIdentity(r);
  return [i.sport,i.event,i.family,i.target,i.stat,i.line,i.period,i.map,i.round,i.set,i.side,i.state,i.settlement].join('|');
}

export function identityComplete(r={}){
  const i=exactIdentity(r);
  const marketText=clean(r.marketLabel||r.market||r.marketKey||'');
  if(!i.sport||!i.event||!i.family)return false;
  if(i.family==='player_prop'&&(!i.target||i.target==='over'||i.target==='under'||!i.stat||i.stat==='unknown'||i.line===''||!['over','under'].includes(i.side)))return false;
  if(['spread','total','map_handicap','round_handicap','round_total'].includes(i.family)&&i.line==='')return false;
  if(/\bmap\s*\d+\b/.test(marketText)&&i.map==='')return false;
  if(/\bset\s*\d+\b/.test(marketText)&&i.set==='')return false;
  if(/\b(?:1st|first|2nd|second)\s+half\b/.test(marketText)&&i.period==='')return false;
  if(i.family==='map_winner'&&i.map==='')return false;
  return true;
}
