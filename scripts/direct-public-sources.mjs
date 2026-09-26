import fs from 'node:fs/promises';

const OUT='data/direct-sources-latest.json';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const now=new Date().toISOString();
const sports=['american-football','baseball','basketball','soccer','tennis','cs2','dota2','lol','valorant'];
const out={generatedAt:now,source:'direct-public',providerHealth:{},sports:Object.fromEntries(sports.map(s=>[s,{exactV2:[]}]))};

function sportOf(text=''){
 const s=String(text).toLowerCase();
 if(/counter[- ]?strike|cs2|cs:go|csgo|\bkxcs\b/.test(s))return 'cs2';
 if(/league of legends|\blol\b|\bkxlol\b/.test(s))return 'lol';
 if(/valorant|\bkxval\b/.test(s))return 'valorant';
 if(/dota\s*2|\bdota\b|\bkxdota\b/.test(s))return 'dota2';
 if(/nfl|ncaaf|college football|super bowl|\bkxnfl|\bkxncaaf/.test(s))return 'american-football';
 if(/mlb|baseball|\bkxmlb/.test(s))return 'baseball';
 if(/nba|wnba|ncaab|college basketball|basketball|\bkxnba|\bkxwnba|\bkxncaab/.test(s))return 'basketball';
 if(/soccer|premier league|champions league|la liga|serie a|bundesliga|mls|uefa|fifa|\bepl\b|\bkxmls/.test(s))return 'soccer';
 if(/tennis|atp|wta|us open|wimbledon|roland garros|australian open|\bkxatp|\bkxwta/.test(s))return 'tennis';
 return null;
}
function pairFromText(text=''){
 const t=String(text).replace(/\s+/g,' ').trim();
 for(const rx of [/(.+?)\s+(?:vs\.?|versus|v\.)\s+(.+?)(?:\?|$|\s+-\s+)/i,/(.+?)\s+(?:at|@)\s+(.+?)(?:\?|$|\s+-\s+)/i,/(?:will\s+)?(.+?)\s+beat\s+(.+?)(?:\?|$)/i]){
  const m=t.match(rx); if(m)return [m[1].replace(/^will\s+/i,'').trim(),m[2].replace(/\s+(?:win|winner|moneyline).*$/i,'').trim()];
 }
 return null;
}
function dec(p){const n=Number(p);return n>0&&n<1?1/n:null}
function add(s,event){if(!s||!out.sports[s])return;out.sports[s].exactV2.push(event)}
function tagText(ev){return (ev?.tags||[]).map(t=>typeof t==='string'?t:[t?.label,t?.name,t?.slug].filter(Boolean).join(' ')).join(' ')}

async function collectPolymarket(){
 let count=0,accepted=0,pages=0;
 try{
  for(let offset=0;offset<1000;offset+=100){
   const u=new URL('https://gamma-api.polymarket.com/events');u.searchParams.set('active','true');u.searchParams.set('closed','false');u.searchParams.set('limit','100');u.searchParams.set('offset',String(offset));
   const r=await fetch(u,{headers:{Accept:'application/json','User-Agent':'thunderpick-comparison/1.1'},signal:AbortSignal.timeout(30000)});
   if(!r.ok)throw new Error(`HTTP ${r.status}`); const body=await r.json(); const events=Array.isArray(body)?body:(body?.data||[]); count+=events.length; pages++;
   for(const ev of events){
    for(const m of (ev.markets||[])){
     if(m.closed===true||m.active===false)continue;
     const mt=[ev.title,ev.slug,ev.description,ev.category,ev.subcategory,tagText(ev),m.question,m.groupItemTitle,m.slug,m.description].filter(Boolean).join(' ');
     const sport=sportOf(mt); if(!sport)continue;
     const pair=pairFromText(mt); if(!pair)continue;
     let names=m.outcomes,prices=m.outcomePrices;
     if(typeof names==='string')try{names=JSON.parse(names)}catch{}; if(typeof prices==='string')try{prices=JSON.parse(prices)}catch{};
     if(!Array.isArray(names)||!Array.isArray(prices)||names.length!==2||prices.length!==2)continue;
     const odds=prices.map(dec); if(odds.some(x=>!(x>1)))continue;
     if(!/winner|win|moneyline|match result|beat|vs\.?|versus| v\. | at | @ /i.test(mt))continue;
     const outcomes=names.map((n,i)=>({name:String(n).trim(),price:odds[i]}));
     add(sport,{id:`polymarket-direct:${m.id||m.slug}`,home_team:pair[0],away_team:pair[1],commence_time:ev.startDate||ev.eventStartTime||m.endDate||null,live:false,bookmakers:[{key:'polymarket-direct',title:'Polymarket Direct',markets:[{key:'h2h',name:'Match Winner',title:m.question||ev.title,scope:{map:null,round:null},last_update:m.updatedAt||ev.updatedAt||null,outcomes}]}]}); accepted++;
    }
   }
   if(events.length<100)break; await sleep(100);
  }
  out.providerHealth.polymarket={ok:true,status:200,rawEvents:count,pages,acceptedEvents:accepted,fetchedAt:new Date().toISOString()};
 }catch(e){out.providerHealth.polymarket={ok:false,error:String(e?.message||e),rawEvents:count,pages,acceptedEvents:accepted,fetchedAt:new Date().toISOString()}}
}

async function collectKalshi(){
 let count=0,accepted=0,cursor='',pages=0;
 try{
  for(let page=0;page<20;page++){
   const u=new URL('https://api.elections.kalshi.com/trade-api/v2/markets');u.searchParams.set('status','open');u.searchParams.set('limit','1000');if(cursor)u.searchParams.set('cursor',cursor);
   const r=await fetch(u,{headers:{Accept:'application/json','User-Agent':'thunderpick-comparison/1.1'},signal:AbortSignal.timeout(30000)});
   if(!r.ok)throw new Error(`HTTP ${r.status}`); const body=await r.json(); const markets=body?.markets||[]; count+=markets.length; pages++;
   for(const m of markets){
    const text=[m.title,m.subtitle,m.yes_sub_title,m.no_sub_title,m.event_ticker,m.series_ticker,m.ticker].filter(Boolean).join(' '); const sport=sportOf(text); if(!sport)continue;
    const pair=pairFromText(text); if(!pair)continue;
    const yesAsk=Number(m.yes_ask_dollars??(Number(m.yes_ask)/100)); const noAsk=Number(m.no_ask_dollars??(Number(m.no_ask)/100));
    const a=dec(yesAsk),b=dec(noAsk); if(!(a>1&&b>1))continue;
    if(!/win|winner|moneyline|beat|vs\.?|versus| v\. | at | @ /i.test(text))continue;
    const outcomes=[{name:String(m.yes_sub_title||pair[0]).trim(),price:a},{name:String(m.no_sub_title||pair[1]).trim(),price:b}];
    add(sport,{id:`kalshi-direct:${m.ticker}`,home_team:pair[0],away_team:pair[1],commence_time:m.expected_expiration_time||m.close_time||null,live:false,bookmakers:[{key:'kalshi-direct',title:'Kalshi Direct',markets:[{key:'h2h',name:'Match Winner',title:m.title,scope:{map:null,round:null},last_update:m.updated_time||null,outcomes}]}]}); accepted++;
   }
   cursor=body?.cursor||''; if(!cursor)break; await sleep(100);
  }
  out.providerHealth.kalshi={ok:true,status:200,rawMarkets:count,pages,acceptedEvents:accepted,fetchedAt:new Date().toISOString()};
 }catch(e){out.providerHealth.kalshi={ok:false,error:String(e?.message||e),rawMarkets:count,pages,acceptedEvents:accepted,fetchedAt:new Date().toISOString()}}
}

await Promise.all([collectPolymarket(),collectKalshi()]);
for(const s of sports)out.sports[s].exactV2EventCount=out.sports[s].exactV2.length;
await fs.mkdir('data',{recursive:true}); await fs.writeFile(OUT,JSON.stringify(out,null,2));
console.log('DIRECT_SOURCE_HEALTH',JSON.stringify(out.providerHealth));
console.log('DIRECT_SOURCE_COUNTS',JSON.stringify(Object.fromEntries(sports.map(s=>[s,out.sports[s].exactV2.length]))));
