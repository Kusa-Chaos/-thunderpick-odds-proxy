import fs from 'node:fs/promises';

const OUT='data/direct-sources-latest.json';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const now=new Date().toISOString();
const sports=['american-football','baseball','basketball','soccer','tennis','cs2','dota2','lol','valorant'];
const out={generatedAt:now,source:'direct-public',providerHealth:{},sports:Object.fromEntries(sports.map(s=>[s,{exactV2:[]}]))};

function sportOf(text=''){
 const s=String(text).toLowerCase();
 if(/counter[- ]?strike|cs2|cs:go|csgo/.test(s))return 'cs2';
 if(/league of legends|\blol\b/.test(s))return 'lol';
 if(/valorant/.test(s))return 'valorant';
 if(/dota\s*2|\bdota\b/.test(s))return 'dota2';
 if(/nfl|football|super bowl/.test(s)&&!/soccer/.test(s))return 'american-football';
 if(/mlb|baseball/.test(s))return 'baseball';
 if(/nba|wnba|basketball|ncaa.*basket/.test(s))return 'basketball';
 if(/soccer|premier league|champions league|la liga|serie a|bundesliga|mls/.test(s))return 'soccer';
 if(/tennis|atp|wta|us open|wimbledon|roland garros/.test(s))return 'tennis';
 return null;
}
function pairFromText(text=''){
 const t=String(text).replace(/\s+/g,' ').trim();
 for(const rx of [/(.+?)\s+(?:vs\.?|v\.)\s+(.+?)(?:\?|$|\s+-\s+)/i,/(.+?)\s+at\s+(.+?)(?:\?|$|\s+-\s+)/i]){
  const m=t.match(rx); if(m)return [m[1].replace(/^will\s+/i,'').trim(),m[2].replace(/\s+(?:win|winner|moneyline).*$/i,'').trim()];
 }
 return null;
}
function dec(p){const n=Number(p);return n>0&&n<1?1/n:null}
function add(s,event){if(!s||!out.sports[s])return;out.sports[s].exactV2.push(event)}

async function collectPolymarket(){
 let count=0,accepted=0;
 try{
  const u='https://gamma-api.polymarket.com/events?active=true&closed=false&limit=500';
  const r=await fetch(u,{headers:{Accept:'application/json','User-Agent':'thunderpick-comparison/1.0'},signal:AbortSignal.timeout(30000)});
  const body=await r.json(); const events=Array.isArray(body)?body:(body?.data||[]); count=events.length;
  for(const ev of events){
   const text=[ev.title,ev.slug,ev.description,ev.category,ev.subcategory].filter(Boolean).join(' '); const sport=sportOf(text); if(!sport)continue;
   for(const m of (ev.markets||[])){
    if(m.closed===true||m.active===false)continue;
    const mt=[m.question,m.groupItemTitle,m.slug,m.description,text].filter(Boolean).join(' ');
    const pair=pairFromText(mt); if(!pair)continue;
    let names=m.outcomes,prices=m.outcomePrices;
    if(typeof names==='string')try{names=JSON.parse(names)}catch{}; if(typeof prices==='string')try{prices=JSON.parse(prices)}catch{};
    if(!Array.isArray(names)||!Array.isArray(prices)||names.length!==2||prices.length!==2)continue;
    const odds=prices.map(dec); if(odds.some(x=>!(x>1)))continue;
    // Fail closed: only use binary team-winner style markets. Derivative map/round/player
    // contracts require explicit identity and are intentionally not inferred here.
    const winnerLike=/winner|win|moneyline|match result|will .* beat|vs\.?| v\. /i.test(mt);
    if(!winnerLike)continue;
    const outcomes=names.map((n,i)=>({name:String(n).trim(),price:odds[i]}));
    add(sport,{id:`polymarket-direct:${m.id||m.slug}`,home_team:pair[0],away_team:pair[1],commence_time:ev.startDate||ev.eventStartTime||m.endDate||null,live:false,bookmakers:[{key:'polymarket-direct',title:'Polymarket Direct',markets:[{key:'h2h',name:'Match Winner',title:m.question||ev.title,scope:{map:null,round:null},last_update:m.updatedAt||ev.updatedAt||null,outcomes}]}]}); accepted++;
   }
  }
  out.providerHealth.polymarket={ok:r.ok,status:r.status,rawEvents:count,acceptedEvents:accepted,fetchedAt:new Date().toISOString()};
 }catch(e){out.providerHealth.polymarket={ok:false,error:String(e?.message||e),rawEvents:count,acceptedEvents:accepted,fetchedAt:new Date().toISOString()}}
}

async function collectKalshi(){
 let count=0,accepted=0,cursor='';
 try{
  for(let page=0;page<5;page++){
   const u=new URL('https://api.elections.kalshi.com/trade-api/v2/markets');u.searchParams.set('status','open');u.searchParams.set('limit','1000');if(cursor)u.searchParams.set('cursor',cursor);
   const r=await fetch(u,{headers:{Accept:'application/json','User-Agent':'thunderpick-comparison/1.0'},signal:AbortSignal.timeout(30000)});
   if(!r.ok)throw new Error(`HTTP ${r.status}`); const body=await r.json(); const markets=body?.markets||[]; count+=markets.length;
   for(const m of markets){
    const text=[m.title,m.subtitle,m.yes_sub_title,m.no_sub_title,m.event_ticker,m.series_ticker].filter(Boolean).join(' '); const sport=sportOf(text); if(!sport)continue;
    const pair=pairFromText(text); if(!pair)continue;
    const yesAsk=Number(m.yes_ask_dollars??(Number(m.yes_ask)/100)); const noAsk=Number(m.no_ask_dollars??(Number(m.no_ask)/100));
    const a=dec(yesAsk),b=dec(noAsk); if(!(a>1&&b>1))continue;
    // Only binary winner contracts; do not reinterpret totals/spreads/props.
    if(!/win|winner|moneyline|beat|vs\.?| v\. /i.test(text))continue;
    const outcomes=[{name:String(m.yes_sub_title||pair[0]).trim(),price:a},{name:String(m.no_sub_title||pair[1]).trim(),price:b}];
    add(sport,{id:`kalshi-direct:${m.ticker}`,home_team:pair[0],away_team:pair[1],commence_time:m.expected_expiration_time||m.close_time||null,live:false,bookmakers:[{key:'kalshi-direct',title:'Kalshi Direct',markets:[{key:'h2h',name:'Match Winner',title:m.title,scope:{map:null,round:null},last_update:m.updated_time||null,outcomes}]}]}); accepted++;
   }
   cursor=body?.cursor||''; if(!cursor)break; await sleep(150);
  }
  out.providerHealth.kalshi={ok:true,status:200,rawMarkets:count,acceptedEvents:accepted,fetchedAt:new Date().toISOString()};
 }catch(e){out.providerHealth.kalshi={ok:false,error:String(e?.message||e),rawMarkets:count,acceptedEvents:accepted,fetchedAt:new Date().toISOString()}}
}

await Promise.all([collectPolymarket(),collectKalshi()]);
for(const s of sports)out.sports[s].exactV2EventCount=out.sports[s].exactV2.length;
await fs.mkdir('data',{recursive:true}); await fs.writeFile(OUT,JSON.stringify(out,null,2));
console.log('DIRECT_SOURCE_HEALTH',JSON.stringify(out.providerHealth));
console.log('DIRECT_SOURCE_COUNTS',JSON.stringify(Object.fromEntries(sports.map(s=>[s,out.sports[s].exactV2.length]))));
