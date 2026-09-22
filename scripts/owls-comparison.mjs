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

// Cache exact-source v2 responses per run so enrichment never repeats the same request.
const v2ResponseCache=new Map();
let stakeCachedBodies={};
// Stake raw Map Winner diagnostic: capture exact native market names/outcomes.: capture exact native market names/outcomes.
try{
 const r=await fetch('https://api.owlsinsight.com/api/v2/stake/cs2',{headers:{Authorization:`Bearer ${API_KEY}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 const body=await r.json().catch(()=>({})); stakeCachedBodies.cs2=body;
 const hits=[];
 for(const ev of (Array.isArray(body?.data)?body.data:[])){
  for(const m of (Array.isArray(ev?.markets)?ev.markets:[])){
   const raw=`${m?.name||''} ${m?.title||''} ${m?.templateExtId||''}`;
   if(/map/i.test(raw)&&/winner|result|1x2/i.test(raw)){
    hits.push({eventId:ev.id,eventName:ev.name,marketId:m.id,name:m.name,title:m.title,templateExtId:m.templateExtId,status:m.status,provider:m.provider,outcomes:(m.outcomes||[]).map(o=>({id:o.id,name:o.name,odds:o.odds,active:o.active,extId:o.extId}))});
   }
  }
 }
 sports.cs2.stakeMapDiagnostic={meta:body?.meta??null,count:hits.length,hits:hits.slice(0,30)};
 console.log('STAKE_MAP_DIAGNOSTIC',JSON.stringify({meta:body?.meta??null,count:hits.length,hits:hits.slice(0,12)}));
}catch(e){console.warn('STAKE_MAP_DIAGNOSTIC_ERROR',String(e?.stack||e));}

// Owls v2 exact-scope esports enrichment. Preserve native map/round identity.
const v2base='https://api.owlsinsight.com/api/v2';
async function v2get(path){
  if(v2ResponseCache.has(path)) return v2ResponseCache.get(path);
  try{
    const r=await fetch(v2base+path,{headers:{Authorization:`Bearer ${API_KEY}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
    const text=await r.text(); let body; try{body=JSON.parse(text)}catch{body={raw:text.slice(0,500)}}
    const out={ok:r.ok,status:r.status,body}; v2ResponseCache.set(path,out); return out;
  }catch(e){const out={ok:false,status:null,error:String(e?.message||e)};v2ResponseCache.set(path,out);return out}
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
  const title=String(ev?.name||ev?.title||'');
  const pair=teamsFromTitle(title)||title.split(/\s+VS\s+|\s+vs\.?\s+/i).map(x=>x.trim()).filter(Boolean); if(pair.length!==2)continue;
  const exact=[];
  for(const m of (Array.isArray(ev?.markets)?ev.markets:[])){
   const name=String(m?.name||m?.title||'');
   const mm=name.match(/^Map\s+(\d+)\s+Winner\s+-\s+Twoway$/i);
   if(!mm||String(m?.status||'active').toLowerCase()!=='active')continue;
   const map=Number(mm[1]);
   const os=(m.outcomes||[]).filter(o=>o?.active!==false&&String(o?.name||'').toLowerCase()!=='draw').map(o=>({name:String(o.name).trim(),price:Number(o.odds)})).filter(o=>o.name&&o.price>1);
   if(os.length!==2)continue;
   exact.push({key:'map_winner',name:`Map ${map} Winner`,title:`Map ${map} Winner`,period:`Map ${map}`,scope:{map,round:null},outcomes:os,provider:m.provider||null,marketId:m.id||null});
  }
  if(exact.length)out.push({id:`stake:${ev.id||title}`,home_team:pair[0],away_team:pair[1],commence_time:ev?.startTime||ev?.start_time||null,live:Boolean(ev?.isLive||ev?.live),bookmakers:[{key:'stake-v2',title:'Stake v2',markets:exact}]});
 }
 return out;
}
function kalshiExact(body,sport='cs2'){
 const groups=new Map();
 for(const m of Object.values(body?.data||{})){
  const title=String(m.title||''); const rules=String(m.rules_primary||'');
  const map=Number((title.match(/\bmap\s*(\d+)\b/i)||rules.match(/\bmap\s*(\d+)\b/i)||[])[1]); if(!map)continue;
  // Kalshi rules are shaped like "... Tournament: Team A vs. Team B CS2 match ...".
  // Anchor the pair to the final colon before "vs" so tournament names containing
  // punctuation cannot become part of the team name.
  const titlePattern=sport==='lol'?'(?:League\\s+of\\s+Legends|LoL)':sport==='valorant'?'VALORANT':sport==='dota2'?'Dota\\s*2':'CS2';
  const pairRe=new RegExp(':\\s*([^:\\n]+?)\\s+vs\\.?\\s+([^:\\n]+?)\\s+'+titlePattern+'\\s+match','i');
  const pairMatch=rules.match(pairRe)||rules.match(/:\s*([^:\n]+?)\s+vs\.?\s+([^:\n]+?)\s+(?:esports\s+)?match/i); if(!pairMatch)continue;
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
 const exactSpecs=[];
 for(const sport of ['cs2','lol','valorant','dota2']){
  exactSpecs.push({book:'stake',sport},{book:'polymarket',sport},{book:'kalshi',sport},{book:'fanaticsmarkets',sport});
 }
 // Pinnacle is queried once as its esports source is cross-title.
 exactSpecs.push({book:'pinnacle',sport:'esports'});
 for(const spec of exactSpecs){
  if(spec.book==='stake'){
   let body=stakeCachedBodies[spec.sport];
   if(!body){const br=await v2get(`/stake/${spec.sport}`); if(br.ok){body=br.body;stakeCachedBodies[spec.sport]=body;}}
 console.log('STAKE_REUSE',Boolean(body),body?.count,body?.meta?.status); if(body){const parsed=stakeExact(body).map(e=>({...e,_sourceSport:spec.sport})); exact.push(...parsed); console.log('STAKE_EXACT_PARSED',spec.sport,parsed.length,parsed.reduce((n,e)=>n+(e.bookmakers?.[0]?.markets?.length||0),0),body?.meta?.status,body?.meta?.ageSeconds);} continue;}
  let lr=await v2get(`/${spec.book}/${spec.sport}/leagues`); if(!lr.ok&&spec.book==='polymarket'){await sleep(1500);lr=await v2get(`/${spec.book}/${spec.sport}/leagues`);} if(!lr.ok){ if(spec.book==='stake'){const br=await v2get('/stake/cs2'); if(br.ok) exact.push(...stakeExact(br.body));} continue; }
  const leagues=lr.body?.data||lr.body?.leagues||lr.body||[];
  for(const row of (Array.isArray(leagues)?leagues:[])){
   const league=typeof row==='string'?row:(row?.leagueKey||row?.key||row?.slug||row?.id); if(!league)continue;
   let br=await v2get(`/${spec.book}/${spec.sport}?league=${encodeURIComponent(String(league))}`); if(!br.ok&&spec.book==='polymarket'){await sleep(1200);br=await v2get(`/${spec.book}/${spec.sport}?league=${encodeURIComponent(String(league))}`);} if(!br.ok)continue;
   if(spec.book==='polymarket') exact.push(...polyExact(br.body).map(e=>({...e,_sourceSport:spec.sport}))); else if(spec.book==='kalshi') exact.push(...kalshiExact(br.body,spec.sport).map(e=>({...e,_sourceSport:spec.sport}))); else if(spec.book==='fanaticsmarkets') exact.push(...fanaticsExact(br.body).map(e=>({...e,_sourceSport:spec.sport}))); else if(spec.book==='stake') exact.push(...stakeExact(br.body).map(e=>({...e,_sourceSport:spec.sport})));
   await sleep(300);
  }
 }
 // Route exact events back to their matching title instead of putting every
 // esports quote under CS2. This is required for LoL/WSCI, Valorant and Dota2.
 for(const sport of ['cs2','lol','valorant','dota2']){
  sports[sport] ||= {ok:true,status:200,data:{}};
  const needles=sport==='cs2'?[/cs2/i]:sport==='lol'?[/\blol\b/i,/league of legends/i]:sport==='valorant'?[/valorant/i]:[/dota\s*2/i];
  const scoped=exact.filter(e=>e._sourceSport===sport||needles.some(rx=>rx.test(JSON.stringify(e))));
  sports[sport].exactV2=scoped;
  sports[sport].exactV2EventCount=scoped.length;
 }
 // Keep unclassified exact events available to CS2 only when their source explicitly
 // came from the CS2 endpoint; never leak LoL/Valorant/Dota2 events across sports.
 sports.cs2.exactV2=exact.filter(e=>e._sourceSport==='cs2'||(!e._sourceSport&&!/\b(lol|league of legends|valorant|dota\s*2)\b/i.test(JSON.stringify(e))));
 sports.cs2.exactV2EventCount=sports.cs2.exactV2.length;
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
