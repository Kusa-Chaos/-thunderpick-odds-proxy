import fs from 'node:fs/promises';

const OUT='data/direct-sources-latest.json';
const API='https://api.elections.kalshi.com/trade-api/v2/markets';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const families=[['american-football',/KX(?:NFL|NCAAF)/i],['baseball',/KXMLB/i],['basketball',/KX(?:NBA|WNBA|NCAAB)/i],['soccer',/KX(?:MLS|EPL|UCL|SOCCER|LALIGA|SERIEA|BUNDESLIGA)/i],['tennis',/KX(?:ATP|WTA|TENNIS)/i],['cs2',/KX(?:CS2|CSGO|CS)/i],['dota2',/KXDOTA/i],['lol',/KX(?:LOL|LCS|LEC|LCK|LPL)/i],['valorant',/KXVAL/i]];

function sportOf(m){const s=[m.series_ticker,m.event_ticker,m.ticker,m.title,m.subtitle].filter(Boolean).join(' ');for(const [sport,rx] of families)if(rx.test(s))return sport;return null}
function kindOf(m){const s=[m.series_ticker,m.event_ticker,m.ticker,m.title,m.subtitle].filter(Boolean).join(' ').toUpperCase();if(/MVECROSS|MULTI|PARLAY/.test(s))return null;if(/SPREAD|HANDICAP/.test(s))return'spreads';if(/TOTAL|OVER\/UNDER|O\/U/.test(s))return'totals';if(/GAME|MATCH|WINNER|MONEYLINE/.test(s))return'h2h';return null}
function pair(text=''){for(const rx of [/(.+?)\s+(?:vs\.?|versus|v\.)\s+(.+?)(?:\?|$|\s+-\s+)/i,/(.+?)\s+(?:at|@)\s+(.+?)(?:\?|$|\s+-\s+)/i,/(?:will\s+)?(.+?)\s+beat\s+(.+?)(?:\?|$)/i]){const m=String(text).replace(/\s+/g,' ').trim().match(rx);if(m)return[m[1].replace(/^will\s+/i,'').trim(),m[2].replace(/\s+(?:win|winner|moneyline).*$/i,'').trim()]}return null}
function prob(m,side){const d=Number(m[`${side}_ask_dollars`]);if(d>0&&d<1)return d;const c=Number(m[`${side}_ask`]);return c>0&&c<100?c/100:null}
function dec(p){return p>0&&p<1?1/p:null}
function retryAfterMs(r,attempt){const raw=r.headers.get('retry-after');if(raw){const sec=Number(raw);if(Number.isFinite(sec))return Math.min(60000,Math.max(1000,sec*1000));const t=Date.parse(raw);if(Number.isFinite(t))return Math.min(60000,Math.max(1000,t-Date.now()))}return Math.min(60000,5000*(2**attempt))+Math.floor(Math.random()*1000)}
async function getPage(url){let last='';for(let attempt=0;attempt<5;attempt++){const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'thunderpick-comparison/1.5'},signal:AbortSignal.timeout(30000)});if(r.ok)return{body:await r.json(),retries:attempt};last=`HTTP ${r.status}`;if(r.status!==429&&r.status<500)throw new Error(last);const wait=retryAfterMs(r,attempt);console.log('KALSHI_BACKOFF',{status:r.status,attempt:attempt+1,waitMs:wait});await sleep(wait)}throw new Error(`${last} after retries`)}

const data=JSON.parse(await fs.readFile(OUT,'utf8'));
const prior=data.providerHealth?.kalshi||{};
// Do not add traffic when the primary collector already succeeded.
if(prior.ok===true){console.log('KALSHI_RECOVERY_SKIP',{reason:'primary collector healthy',health:prior});process.exit(0)}

let cursor='',pages=0,rawMarkets=0,accepted=0,rejectedMulti=0,rejectedNonSports=0,rejectedShape=0,retries=0;
const rows=Object.fromEntries(Object.keys(data.sports||{}).map(s=>[s,[]]));
try{
  for(let page=0;page<30;page++){
    const u=new URL(API);u.searchParams.set('status','open');u.searchParams.set('limit','1000');if(cursor)u.searchParams.set('cursor',cursor);
    const got=await getPage(u);retries+=got.retries;const body=got.body;const markets=body?.markets||[];rawMarkets+=markets.length;pages++;
    for(const m of markets){const ids=[m.series_ticker,m.event_ticker,m.ticker].filter(Boolean).join(' ');if(/MVECROSS|MULTI|PARLAY/i.test(ids)){rejectedMulti++;continue}const sport=sportOf(m);if(!sport||!rows[sport]){rejectedNonSports++;continue}const kind=kindOf(m);if(!kind){rejectedShape++;continue}const text=[m.title,m.subtitle,m.yes_sub_title,m.no_sub_title].filter(Boolean).join(' ');let teams=pair(text);if(!teams&&m.yes_sub_title&&m.no_sub_title&&!/^(yes|no)$/i.test(String(m.yes_sub_title))&&!/^(yes|no)$/i.test(String(m.no_sub_title)))teams=[m.yes_sub_title,m.no_sub_title];if(!teams){rejectedShape++;continue}const a=dec(prob(m,'yes')),b=dec(prob(m,'no'));if(!(a>1&&b>1)){rejectedShape++;continue}let line=null;const lm=text.match(/(?:spread|handicap|total|over\/under|o\/u)\s*[:+-]?\s*(-?\d+(?:\.\d+)?)/i);if(lm)line=Number(lm[1]);rows[sport].push({id:`kalshi-direct:${m.ticker}`,home_team:teams[0],away_team:teams[1],commence_time:m.expected_expiration_time||m.close_time||null,live:false,bookmakers:[{key:'kalshi-direct',title:'Kalshi Direct',markets:[{key:kind,name:kind==='h2h'?'Match Winner':kind==='spreads'?'Handicap':'Total',title:m.title,scope:{map:null,round:null},line,last_update:m.updated_time||null,outcomes:[{name:String(m.yes_sub_title||teams[0]).trim(),price:a},{name:String(m.no_sub_title||teams[1]).trim(),price:b}]}]}]});accepted++}
    cursor=body?.cursor||'';if(!cursor)break;
    // Deliberately slow pagination to stay below Kalshi's unauthenticated burst limit.
    await sleep(2500+Math.floor(Math.random()*500));
  }
  for(const [sport,list] of Object.entries(rows)){const bucket=data.sports?.[sport]?.exactV2;if(!Array.isArray(bucket))continue;data.sports[sport].exactV2=bucket.filter(e=>!String(e?.id||'').startsWith('kalshi-direct:')).concat(list)}
  data.providerHealth=data.providerHealth||{};data.providerHealth.kalshi={ok:true,status:200,recovered:true,rawMarkets,pages,acceptedEvents:accepted,retries,rejectedMulti,rejectedNonSports,rejectedShape,fetchedAt:new Date().toISOString()};
  await fs.writeFile(OUT,JSON.stringify(data));console.log('KALSHI_RECOVERED',data.providerHealth.kalshi);
}catch(e){data.providerHealth=data.providerHealth||{};data.providerHealth.kalshi={...prior,ok:false,recoveryAttempted:true,recoveryError:String(e?.message||e),rawMarkets,pages,acceptedEvents:accepted,retries,rejectedMulti,rejectedNonSports,rejectedShape,fetchedAt:new Date().toISOString()};await fs.writeFile(OUT,JSON.stringify(data));console.log('KALSHI_RECOVERY_DEGRADED',data.providerHealth.kalshi);process.exit(0)}
