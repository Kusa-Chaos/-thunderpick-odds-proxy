const PREMATCH=new Set(['TRADING','TRADING_PREMATCH','OPEN']);
const MARKET_MAP=new Map([
 ['basketball.moneyline','h2h'],['baseball.moneyline','h2h'],['american_football.moneyline','h2h'],
 ['tennis.moneyline','h2h'],['soccer.matchOdds','h2h'],['soccer.match_odds','h2h']
]);
function enabled(s){return !s?.status || /ENABLED|ACTIVE|TRADING/i.test(String(s.status));}
export function normalizeCloudbetEvent(event={}){
 if(!PREMATCH.has(String(event.status||'TRADING').toUpperCase())) return [];
 const sport=event?.sport?.key; const home=event?.home?.name; const away=event?.away?.name;
 if(!sport||!home||!away) return [];
 const markets=[];
 for(const [raw,m] of Object.entries(event.markets||{})){
   const key=MARKET_MAP.get(raw); if(!key) continue;
   for(const [params,sub] of Object.entries(m?.submarkets||{})){
     if(params && !/(^|&)period=(ft|full|match)($|&)/i.test(params)) continue;
     const sels=(sub?.selections||[]).filter(enabled);
     const outcomes=sels.map(s=>({name:s.outcome==='home'?home:s.outcome==='away'?away:String(s.outcome||''),price:Number(s.price)})).filter(o=>o.name&&o.price>1);
     if(outcomes.length<2) continue;
     markets.push({key,name:'Match Winner',title:raw,scope:{map:null,round:null,half:null,period:'full',settlement:'match'},last_update:sub?.sequence||null,outcomes});
   }
 }
 if(!markets.length)return [];
 return [{id:`cloudbet-direct:${event.id}`,home_team:home,away_team:away,commence_time:event.cutoffTime||event.startTime||null,live:false,bookmakers:[{key:'cloudbet-direct',title:'Cloudbet Direct',markets}]}];
}
