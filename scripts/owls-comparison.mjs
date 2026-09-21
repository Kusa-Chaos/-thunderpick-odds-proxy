import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const API_KEY=(process.env.OWLS_API_KEY||'').replace(/\s+/g,'');
if(!API_KEY) throw new Error('OWLS_API_KEY missing');
// Owls v1 canonical sport keys. Esports stay first priority.
const SPORTS=['cs2','dota2','lol','valorant','nfl','mlb','nba','soccer','tennis'];
const ESPORTS=new Set(['cs2','dota2','lol','valorant']);
const base='https://api.owlsinsight.com/api/v1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
let previous=null; try{previous=JSON.parse(await fs.readFile('data/owls-comparison-latest.json','utf8'));}catch{}
const sports={}; const failures=[];
for(const sport of SPORTS){
  console.log(`Fetching outside ${sport} board...`);
  try{
    const r=await fetch(`${base}/${sport}/odds`,{headers:{Authorization:`Bearer ${API_KEY}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
    const text=await r.text(); let body; try{body=JSON.parse(text)}catch{body={raw:text}};
    const h=hash(body);
    const data=body?.data??null;
    const eventCount=Array.isArray(data)?data.length:(data&&typeof data==='object'?Object.keys(data).length:0);
    sports[sport]={ok:r.ok,status:r.status,fetchedAt:new Date().toISOString(),hash:h,changedSincePrevious:previous?.sports?.[sport]?.hash!==h,eventCount,meta:body?.meta??null,data};
    // Bench-safe esports derivative diagnostics come from the existing /{sport}/odds
    // response itself (Owls serves 1xBet esports there). No extra API request needed.
    if(r.ok&&ESPORTS.has(sport)){
      const samples=[];
      const stack=[data];
      while(stack.length&&samples.length<40){
        const v=stack.pop();
        if(Array.isArray(v)){ for(const q of v) stack.push(q); continue; }
        if(!v||typeof v!=='object') continue;
        const raw=JSON.stringify(v);
        if(/map_winner|round_handicap|round_totals/i.test(raw)){
          samples.push(v);
          continue;
        }
        for(const q of Object.values(v)) if(q&&typeof q==='object') stack.push(q);
      }
      sports[sport].oneXBetDerivativeSamples=samples;
      console.log('1XBET_DERIVATIVE_SAMPLES',sport,'count='+samples.length);

      // Exact derivative scope cannot be inferred from Owls' normalized map_winner /
      // round_totals rows because they currently omit map/round identity. Direct 1xBet
      // GameZip requests are geo/block-page responses on GitHub runners, so do not
      // spend requests on them or persist HTML as if it were market data.
      //
      // Production rule: keep normalized derivatives as diagnostics only. The EV
      // screener must require explicit scope metadata before matching a derivative.
      sports[sport].derivativeScope={
        exactScopeAvailable:false,
        reason:'Owls normalized derivative rows omit map/round identity; direct 1xBet detail feed blocked on runner',
        policy:'fail-closed'
      };
    }
    if(!r.ok) { failures.push({sport,status:r.status,body}); console.error('OWLS_FAIL',sport,r.status,JSON.stringify(body).slice(0,500)); }
  }catch(e){sports[sport]={ok:false,status:null,fetchedAt:new Date().toISOString(),error:String(e?.message||e),eventCount:0,data:null};failures.push({sport,error:String(e?.message||e)});console.error('OWLS_ERROR',sport,String(e?.message||e));}
  await sleep(3300);
}

// Probe Pinnacle v1 realtime against league names discoverable from the current
// Thunderpick CS2 board. This is diagnostic until the wire format proves exact map scope.
try{
  const tp=JSON.parse(await fs.readFile('data/owls-latest.json','utf8'));
  const leagueNames=new Set();
  const stack=[tp?.sports?.cs2?.data?.data??tp?.sports?.cs2?.data??tp?.sports?.cs2??tp];
  while(stack.length){
    const v=stack.pop();
    if(Array.isArray(v)){for(const q of v)stack.push(q);continue;}
    if(!v||typeof v!=='object')continue;
    for(const [k,val] of Object.entries(v)){
      if(/league|tournament|competition/i.test(k)&&typeof val==='string'&&val.trim().length>2&&val.length<100)leagueNames.add(val.trim()); if(['league','tournament','competition'].includes(k)&&val&&typeof val==='object'&&typeof val.name==='string')leagueNames.add(val.name.trim());
      if(val&&typeof val==='object')stack.push(val);
    }
  }
  const probes=[]; const candidates=[...leagueNames].slice(0,12);
  for(const league of candidates){
    try{
      const r=await fetch(`${base}/cs2/realtime?league=${encodeURIComponent(league)}`,{headers:{Authorization:`Bearer ${API_KEY}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
      const body=await r.json().catch(()=>({}));
      const data=Array.isArray(body?.data)?body.data:[];
      probes.push({league,status:r.status,available:body?.meta?.available??null,events:data.length,freshness:body?.meta?.freshness??null,sample:data.slice(0,2)});
      if(data.length) break;
    }catch(e){probes.push({league,error:String(e?.message||e),events:0});}
    await sleep(250);
  }
  sports.cs2.pinnacleRealtimeProbe={candidateLeagues:candidates,probes};
  console.log('PINNACLE_REALTIME_PROBE',JSON.stringify(probes.map(x=>({league:x.league,status:x.status,available:x.available,events:x.events,freshness:x.freshness}))));
}catch(e){console.warn('PINNACLE_REALTIME_PROBE_ERROR',String(e?.message||e));}

// Discover which current-plan v2 sources actually expose esports/CS2 boards.
// This avoids guessing books one-by-one and records only compact access/shape metadata.
try{
 const sourceSpecs=[
  ['fanaticsmarkets','cs2'],['bet105','esports'],['betus','esports'],['bookmaker','esports'],
  ['bookmaker','e-gaming'],['4casters','cs2'],['novig','cs2'],['thescore','cs2'],
  ['versus','cs2'],['stake','cs2']
 ];
 const discovery=[];
 for(const [book,sport] of sourceSpecs){
  let lr=await v2get(`/${book}/${sport}/leagues`);
  const rows=lr.body?.data||lr.body?.leagues||lr.body||[];
  const leagues=Array.isArray(rows)?rows:[];
  let league=leagues.length?(typeof leagues[0]==='string'?leagues[0]:(leagues[0]?.leagueKey||leagues[0]?.key||leagues[0]?.slug||leagues[0]?.id||leagues[0]?.name)):null;
  let br=null;
  if(lr.ok&&league) br=await v2get(`/${book}/${sport}?league=${encodeURIComponent(String(league))}`);
  else if(!lr.ok||!league) br=await v2get(`/${book}/${sport}`);
  const raw=br?.ok?JSON.stringify(br.body):'';
  discovery.push({book,sport,leagueStatus:lr.status,leagueCount:leagues.length,league:league||null,boardStatus:br?.status??null,boardOk:Boolean(br?.ok),hasMap:/\bmap\s*[12345]\b/i.test(raw),hasRound:/\bround\b/i.test(raw),bytes:raw.length});
  await sleep(250);
 }
 sports.cs2.v2SourceDiscovery=discovery;
 console.log('V2_CS2_SOURCE_DISCOVERY',JSON.stringify(discovery));
}catch(e){console.warn('V2_CS2_SOURCE_DISCOVERY_ERROR',String(e?.message||e));}

// Targeted Fanatics Markets diagnostic: capture route status/error and native shape.
try{
 const paths=['/fanaticsmarkets/cs2/leagues','/fanaticsmarkets/cs2'];
 const d=[];
 for(const path of paths){
  const started=Date.now();
  try{
   const r=await fetch('https://api.owlsinsight.com/api/v2'+path,{headers:{Authorization:`Bearer ${API_KEY}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
   const txt=await r.text(); let body; try{body=JSON.parse(txt)}catch{body={raw:txt.slice(0,1000)}}
   const data=body?.data;
   d.push({path,status:r.status,ok:r.ok,ms:Date.now()-started,contentType:r.headers.get('content-type'),topKeys:body&&typeof body==='object'?Object.keys(body).slice(0,20):[],dataType:Array.isArray(data)?'array':typeof data,dataCount:Array.isArray(data)?data.length:(data&&typeof data==='object'?Object.keys(data).length:0),meta:body?.meta??null,sample:data&&typeof data==='object'?JSON.stringify(Array.isArray(data)?data.slice(0,2):Object.fromEntries(Object.entries(data).slice(0,2))).slice(0,12000):null});
  }catch(e){d.push({path,status:null,ok:false,ms:Date.now()-started,error:String(e?.stack||e?.message||e),cause:String(e?.cause?.code||e?.cause||'')});}
 }
 sports.cs2.fanaticsDiagnostic=d;
 console.log('FANATICS_TARGETED_DIAGNOSTIC',JSON.stringify(d));
}catch(e){console.warn('FANATICS_TARGETED_DIAGNOSTIC_ERROR',String(e?.stack||e));}

// Owls v2 exact-scope esports enrichment. Preserve native map/round identity.
const v2base='https://api.owlsinsight.com/api/v2';
async function v2get(path){
  try{
    const r=await fetch(v2base+path,{headers:{Authorization:`Bearer ${API_KEY}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
    const text=await r.text(); let body; try{body=JSON.parse(text)}catch{body={raw:text.slice(0,500)}}
    return {ok:r.ok,status:r.status,body};
  }catch(e){return {ok:false,status:null,error:String(e?.message||e)}}
}
function arr(v){if(Array.isArray(v))return v;try{return JSON.parse(v)}catch{return []}}
function decOdds(p){const x=Number(p);return x>0&&x<1?1/x:null}
function teamsFromTitle(s=''){
  const m=String(s).match(/:\s*(.+?)\s+vs\.?\s+(.+?)(?:\s+\(BO\d+\)|\s+-|$)/i)||String(s).match(/(.+?)\s+vs\.?\s+(.+?)(?:\s+\(BO\d+\)|\s+-|$)/i);
  return m?[m[1].trim(),m[2].trim()]:null;
}
function scopedKey(text=''){
  const t=String(text);
  const map=(t.match(/\bmap\s*(\d+)\b/i)||[])[1];
  const round=(t.match(/\bround\s*(\d+)\b/i)||[])[1];
  if(/\bmap\b/i.test(t)&&/\b(winner|moneyline)\b/i.test(t))return {key:'map_winner',map:map?Number(map):null,round:null};
  if(/\bround\b/i.test(t)&&/\b(handicap|spread)\b/i.test(t))return {key:'round_handicap',map:map?Number(map):null,round:round?Number(round):null};
  if(/\bround\b/i.test(t)&&/\btotal/i.test(t))return {key:'round_totals',map:map?Number(map):null,round:round?Number(round):null};
  return null;
}
function polyExact(body){
 const out=[];
 for(const ev of Object.values(body?.data||{})){
  const pair=teamsFromTitle(ev?.title||''); if(!pair)continue;
  const markets=[];
  for(const m of ev?.markets||[]){
   const sc=scopedKey(`${m.groupItemTitle||''} ${m.question||''} ${m.description||''}`); if(!sc||sc.map==null)continue;
   const names=arr(m.outcomes), prices=arr(m.outcomePrices).map(Number); if(names.length!==2||prices.length!==2)continue;
   const outcomes=names.map((name,i)=>({name,price:decOdds(prices[i])})); if(outcomes.some(x=>!(x.price>1)))continue;
   markets.push({key:sc.key,name:m.groupItemTitle||m.question,title:m.question,description:m.description,period:`Map ${sc.map}`,scope:{map:sc.map,round:sc.round},last_update:m.updatedAt||ev.updatedAt||null,outcomes});
  }
  if(markets.length)out.push({id:`polymarket:${ev.id||ev.slug}`,home_team:pair[0],away_team:pair[1],commence_time:ev.eventStartTime||ev.endDate||null,live:false,bookmakers:[{key:'polymarket-v2',title:'Polymarket v2',markets}]});
 }
 return out;
}
function fanaticsExact(body){
 const out=[];
 for(const [id,ev] of Object.entries(body?.data||{})){
  const rawText=`${ev?.title||''} ${ev?.name||''} ${ev?.question||''} ${ev?.market_name||''}`;
  const sc=scopedKey(rawText); if(!sc||sc.key!=='map_winner'||sc.map==null)continue;
  const os=Array.isArray(ev?.outcomes)?ev.outcomes:[];
  const outcomes=os.map(o=>{
    const p=Number(o?.probability??o?.price??o?.yes_price??o?.yesPrice);
    const name=String(o?.name??o?.title??o?.label??'').trim();
    return {name,price:decOdds(p)};
  }).filter(o=>o.name&&o.price>1);
  if(outcomes.length!==2)continue;
  const pair=teamsFromTitle(rawText); if(!pair)continue;
  out.push({id:'fanaticsmarkets:'+id,home_team:pair[0],away_team:pair[1],commence_time:ev?.startTime||ev?.start_time||ev?.eventStartTime||null,live:Boolean(ev?.live||ev?.isLive),bookmakers:[{key:'fanaticsmarkets-v2',title:'Fanatics Markets v2',markets:[{key:'map_winner',name:`Map ${sc.map} Winner`,title:`Map ${sc.map} Winner`,period:`Map ${sc.map}`,scope:{map:sc.map,round:null},outcomes}]}]});
 }
 return out;
}
function stakeExact(body){
 const out=[]; const events=Array.isArray(body?.data)?body.data:Object.values(body?.data||{});
 for(const ev of events){
  const home=ev?.event?.teams?.home?.name||ev?.teams?.home?.name||ev?.homeName;
  const away=ev?.event?.teams?.away?.name||ev?.teams?.away?.name||ev?.awayName;
  if(!home||!away)continue;
  const markets=[...(ev?.markets||[]),...(ev?.event?.markets||[])];
  const exact=[];
  for(const m of markets){
   const text=`${m.name||''} ${m.title||''} ${m.marketName||''}`; const sc=scopedKey(text);
   if(!sc||sc.map==null||sc.key!=='map_winner')continue;
   const os=(m.outcomes||[]).map(o=>({name:o.name,price:Number(o.odds)})).filter(o=>o.name&&o.price>1);
   if(os.length===2)exact.push({key:'map_winner',name:m.name||m.title,title:m.title||m.name,period:`Map ${sc.map}`,scope:{map:sc.map,round:null},outcomes:os});
  }
  if(exact.length)out.push({id:`stake:${ev.id||ev?.event?.id||home+'-'+away}`,home_team:home,away_team:away,commence_time:ev?.event?.startTime||ev?.startTime||null,live:Boolean(ev?.event?.isLive||ev?.isLive),bookmakers:[{key:'stake-v2',title:'Stake v2',markets:exact}]});
 }
 return out;
}
function kalshiExact(body){
 const groups=new Map();
 for(const m of Object.values(body?.data||{})){
  const title=String(m.title||''); const rules=String(m.rules_primary||'');
  const map=Number((title.match(/\bmap\s*(\d+)\b/i)||rules.match(/\bmap\s*(\d+)\b/i)||[])[1]); if(!map)continue;
  // Kalshi rules are shaped like "... Tournament: Team A vs. Team B CS2 match ...".
  // Anchor the pair to the final colon before "vs" so tournament names containing
  // punctuation cannot become part of the team name.
  const pairMatch=rules.match(/:\s*([^:\n]+?)\s+vs\.?\s+([^:\n]+?)\s+CS2\s+match/i); if(!pairMatch)continue;
  const pair=[pairMatch[1].trim(),pairMatch[2].trim()];
  const eventTicker=String(m.event_ticker||'').toUpperCase();
  const k=eventTicker||`${pair[0]}|${pair[1]}|map${map}`;
  if(!groups.has(k))groups.set(k,{pair,map,rows:[],eventTicker,occurrence:m.occurrence_datetime||null});
  const name=String(m.yes_sub_title||title.replace(/\s+wins map.*$/i,'')).trim();
  const ask=Number(m.yes_ask_dollars), bid=Number(m.yes_bid_dollars);
  // Use executable YES ask when present. Preserve bid/ask metadata so wide or
  // illiquid prediction-market quotes remain auditable.
  if(ask>0&&ask<1)groups.get(k).rows.push({name,price:decOdds(ask),ask,bid:Number.isFinite(bid)?bid:null,ticker:m.ticker||null,updatedAt:m.updated_time||null});
 }
 const out=[];
 for(const [k,g] of groups){
  const byTeam=new Map(); for(const r of g.rows)byTeam.set(r.name.toLowerCase(),r);
  const rows=[...byTeam.values()]; if(rows.length!==2)continue;
  out.push({id:'kalshi:'+k,home_team:g.pair[0],away_team:g.pair[1],commence_time:g.occurrence,live:false,bookmakers:[{key:'kalshi-v2',title:'Kalshi v2',markets:[{key:'map_winner',name:`Map ${g.map} Winner`,title:`Map ${g.map} Winner`,period:`Map ${g.map}`,scope:{map:g.map,round:null},last_update:rows.map(x=>x.updatedAt).filter(Boolean).sort().at(-1)||null,outcomes:rows.map(({name,price})=>({name,price}))}]}]});
 }
 return out;
}
try{
 const exact=[];
 for(const spec of [{book:'pinnacle',sport:'esports'},{book:'kalshi',sport:'cs2'},{book:'polymarket',sport:'cs2'},{book:'fanaticsmarkets',sport:'cs2'},{book:'stake',sport:'cs2'}]){
  let lr=await v2get(`/${spec.book}/${spec.sport}/leagues`); if(!lr.ok&&spec.book==='polymarket'){await sleep(1500);lr=await v2get(`/${spec.book}/${spec.sport}/leagues`);} if(!lr.ok){ if(spec.book==='stake'){const br=await v2get('/stake/cs2'); if(br.ok) exact.push(...stakeExact(br.body));} continue; }
  const leagues=lr.body?.data||lr.body?.leagues||lr.body||[];
  for(const row of (Array.isArray(leagues)?leagues:[])){
   const league=typeof row==='string'?row:(row?.leagueKey||row?.key||row?.slug||row?.id); if(!league)continue;
   let br=await v2get(`/${spec.book}/${spec.sport}?league=${encodeURIComponent(String(league))}`); if(!br.ok&&spec.book==='polymarket'){await sleep(1200);br=await v2get(`/${spec.book}/${spec.sport}?league=${encodeURIComponent(String(league))}`);} if(!br.ok)continue;
   if(spec.book==='polymarket') exact.push(...polyExact(br.body)); else if(spec.book==='kalshi') exact.push(...kalshiExact(br.body)); else if(spec.book==='fanaticsmarkets') exact.push(...fanaticsExact(br.body)); else if(spec.book==='stake') exact.push(...stakeExact(br.body));
   await sleep(300);
  }
 }
 sports.cs2 ||= {ok:true,status:200,data:{}};
 sports.cs2.exactV2=exact;
 sports.cs2.exactV2EventCount=exact.length;
 console.log('OWLS_V2_EXACT_EVENTS',exact.length,'KALSHI',exact.filter(x=>String(x.id).startsWith('kalshi:')).length,'POLYMARKET',exact.filter(x=>String(x.id).startsWith('polymarket:')).length,'FANATICS',exact.filter(x=>String(x.id).startsWith('fanaticsmarkets:')).length,'STAKE',exact.filter(x=>String(x.id).startsWith('stake:')).length,'PINNACLE_LEAGUES',JSON.stringify((await v2get('/pinnacle/esports/leagues')).body?.data||[]).slice(0,1000));
}catch(e){console.warn('OWLS_V2_EXACT_ERROR',String(e?.message||e));}

await fs.mkdir('data',{recursive:true});
// Persist only a compact diagnostic view of raw Pinnacle realtime esports data.
// The full comparison board can be too large for repository publication.
const derivativeDiagnostic={generatedAt:new Date().toISOString(),sports:{}};
for(const sport of [...ESPORTS]){
  const z=sports[sport]||{};
  const rows=(z.oneXBetDerivativeSamples||[]).slice(0,40);
  derivativeDiagnostic.sports[sport]={
    source:'owls-v1-odds-1xbet',
    sampleCount:rows.length,
    samples:rows,
    derivativeScope:z.derivativeScope||null
  };
}
await fs.writeFile('data/pinnacle-esports-derivative-debug.json',JSON.stringify(derivativeDiagnostic,null,2));
await fs.writeFile('data/owls-comparison-latest.json',JSON.stringify({generatedAt:new Date().toISOString(),source:'Owls v1 normalized esports + sports odds',requestCountThisRun:SPORTS.length,failedSports:failures,sports},null,2));
if(failures.length) console.warn('OWLS_PARTIAL_FAILURES',JSON.stringify(failures.map(f=>({sport:f.sport,status:f.status,error:f.error}))));
