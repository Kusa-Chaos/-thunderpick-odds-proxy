const POLY_SPORTS = Object.freeze({
  nfl: 'american-football', ncaaf: 'american-football',
  mlb: 'baseball', nba: 'basketball', wnba: 'basketball',
  epl: 'soccer', mls: 'soccer', ucl: 'soccer', uel: 'soccer',
  laliga: 'soccer', seriea: 'soccer', bundesliga: 'soccer',
  ligue1: 'soccer', eredivisie: 'soccer', ligamx: 'soccer',
  atp: 'tennis', wta: 'tennis', 'atp-doubles': 'tennis', 'wta-doubles': 'tennis',
  cs2: 'cs2', dota2: 'dota2', lol: 'lol', val: 'valorant'
});
const DAY = 86400000;

export function selectPolymarketSeries(metadata=[]) {
  const seen=new Set(), selected=[];
  for(const entry of metadata){
    const slug=String(entry?.sport||'').toLowerCase();
    const sport=POLY_SPORTS[slug];
    if(!sport)continue;
    for(const raw of String(entry?.series||'').split(',')){
      const series=raw.trim();
      if(!/^\d+$/.test(series)||seen.has(series))continue;
      seen.add(series);
      selected.push({sport,series,slug});
    }
  }
  return selected;
}
const normalize = value => String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const sameTeam = (a,b) => {
  const x=normalize(a),y=normalize(b);
  return x.length>2&&y.length>2&&(x===y||x.endsWith(y)||y.endsWith(x));
};
const parseJsonArray = value => {
  try {const a=typeof value==='string'?JSON.parse(value):value;return Array.isArray(a)?a:null;}
  catch {return null;}
};
const parseClock = value => {
  const t=Date.parse(String(value||''));
  return Number.isFinite(t)?t:null;
};
export function polymarketMatchRow(event,market,sport,now=Date.now()) {
  if(!event||!market||!sport||event.closed===true||event.active===false||
     market.closed===true||market.active===false||market.acceptingOrders!==true) return null;
  // Other types include child_moneyline (map/game), totals, spreads, and props.
  if(market.sportsMarketType!=='moneyline')return null;
  const start=parseClock(market.gameStartTime||event.startTime||event.eventStartTime);
  if(start===null||start<now||start>now+30*DAY)return null;
  const outcomes=parseJsonArray(market.outcomes);
  if(!outcomes||outcomes.length!==2||outcomes.some(o=>!String(o).trim()||/^(yes|no)$/i.test(String(o))))return null;
  const teams=Array.isArray(event.teams)&&event.teams.length===2?event.teams.map(t=>t?.name):null;
  if(teams&&(!sameTeam(teams[0],outcomes[0])||!sameTeam(teams[1],outcomes[1])))return null;
  const names=teams||outcomes;
  const ask=Number(market.bestAsk),bid=Number(market.bestBid);
  if(market.bestAsk==null||market.bestBid==null||!(ask>0&&ask<1&&bid>0&&bid<=ask))return null;
  const noAsk=1-bid;
  if(!(noAsk>0&&noAsk<1))return null;
  return {
    id:'polymarket-direct:'+String(market.id||market.slug),
    home_team:String(names[0]).trim(),away_team:String(names[1]).trim(),
    commence_time:new Date(start).toISOString(),live:false,
    bookmakers:[{key:'polymarket-direct',title:'Polymarket Direct (ask-side indicative)',markets:[{
      key:'h2h',name:'Match Winner',title:market.question||event.title,
      scope:{map:null,round:null},last_update:market.updatedAt||null,
      outcomes:[{name:String(names[0]).trim(),price:1/ask},{name:String(names[1]).trim(),price:1/noAsk}]
    }]}]
  };
}
export function kalshiSeriesURL(series,cursor=''){
  if(!/^KX[A-Z0-9-]{2,39}$/.test(series))throw new Error('Unsafe Kalshi series identifier');
  const url=new URL('https://api.elections.kalshi.com/trade-api/v2/markets');
  url.searchParams.set('status','open');url.searchParams.set('limit','200');
  url.searchParams.set('mve_filter','exclude');
  url.searchParams.set('series_ticker',series);
  if(cursor)url.searchParams.set('cursor',cursor);
  return url.toString();
}
export const KALSHI_CANDIDATE_SERIES=Object.freeze([
  'KXNFLGAME','KXNCAAFGAME','KXNBAGAME','KXWNBAGAME','KXMLBGAME',
  'KXNFLSPREAD','KXNBASPREAD','KXNFLTOTAL','KXNBATOTAL',
  'KXATPMATCH','KXWTAMATCH','KXLOL','KXCS2','KXDOTA','KXVAL',
  'KXMLSGAME','KXEPLGAME'
]);
