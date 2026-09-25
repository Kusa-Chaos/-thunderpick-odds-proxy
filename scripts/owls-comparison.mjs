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
      // Owls' documented CS2 v1 feed explicitly carries round_totals and
      // round_handicap. Preserve those rows as a fallback inventory instead of
      // throwing them away when Stake is temporarily no-data. They remain
      // SCREENING-only unless exact map identity can be proven.
      const derivativeRows=[];
      const walk=(v,ctx={})=>{
        if(Array.isArray(v)){for(const q of v)walk(q,ctx);return;}
        if(!v||typeof v!=='object')return;
        const key=String(v.key||v.marketKey||v.market||'').toLowerCase();
        if(key==='round_handicap'||key==='round_totals'){
          derivativeRows.push({key,event:ctx.event||null,book:ctx.book||null,name:v.name||null,title:v.title||null,period:v.period||null,scope:v.scope||null,outcomes:v.outcomes||[]});
        }
        const next={...ctx,event:v.home_team&&v.away_team?`${v.home_team} vs ${v.away_team}`:ctx.event,book:v.key&&v.bookmakers?ctx.book:(v.title||v.book||ctx.book)};
        for(const q of Object.values(v))if(q&&typeof q==='object')walk(q,next);
      };
      walk(data);
      sports[sport].normalizedDerivativeInventory=derivativeRows.slice(0,2000);
      sports[sport].derivativeScope={
        exactScopeAvailable:derivativeRows.some(x=>x.scope?.map!=null||/map\s*\d+/i.test(String(x.period||x.name||x.title||''))),
        normalizedRows:derivativeRows.length,
        reason:'Owls normalized derivative inventory retained; exact matching still fails closed when map identity is absent',
        policy:'screen-with-scope-only'
      };
      console.log('NORMALIZED_DERIVATIVE_INVENTORY',sport,derivativeRows.length);
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
   if(/round|handicap|total|kill|assist|headshot|player/i.test(raw)){
    hits.push({eventId:ev.id,eventName:ev.name,marketId:m.id,name:m.name,title:m.title,templateExtId:m.templateExtId,status:m.status,provider:m.provider,outcomes:(m.outcomes||[]).map(o=>({id:o.id,name:o.name,odds:o.odds,active:o.active,extId:o.extId}))});
   }
  }
 }
 sports.cs2.stakeMapDiagnostic={meta:body?.meta??null,count:hits.length,hits:hits.slice(0,250)};
 console.log('STAKE_MAP_DIAGNOSTIC',JSON.stringify({meta:body?.meta??null,count:hits.length,hits:hits.slice(0,120)}));
}catch(e){console.warn('STAKE_MAP_DIAGNOSTIC_ERROR',String(e?.stack||e));}
if(stakeCachedBodies.cs2?.meta?.status==='no-data'){
  console.warn('STAKE_EXACT_SOURCE_NO_DATA','Stake/Oddin returned no-data; derivative parser cannot manufacture exact round markets.');
}

// Owls v2 exact-scope esports enrichment. Preserve native map/round identity.
const v2base='https://api.owlsinsight.com/api/v2';
// Optional direct esports derivative source. Odds-API.io documents explicit
// Map 1/2/3 Winner, Round Handicap and Total Rounds markets. Keep this optional:
// the scan remains operational without a key and fails closed on identity.
const ODDS_API_IO_KEY=''; // paid source deliberately disabled
const ODDSPAPI_API_KEY=(process.env.ODDSPAPI_API_KEY||'').trim();
const ODDSPAPI_BASE='https://api.oddspapi.io/v4'; // structured derivative source
const ODDS_API_IO_BASE='https://api.odds-api.io/v3';
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
function stakeExact(body,source='stake'){
 const out=[]; const events=Array.isArray(body?.data)?body.data:Object.values(body?.data||{});
 for(const ev of events){
  const title=String(ev?.name||ev?.title||'');
  const pair=teamsFromTitle(title)||title.split(/\s+VS\s+|\s+vs\.?\s+/i).map(x=>x.trim()).filter(Boolean); if(pair.length!==2)continue;
  const exact=[];
  for(const m of (Array.isArray(ev?.markets)?ev.markets:[])){
   const name=String(m?.name||m?.title||'').trim();
   // Stake/Oddin sometimes puts map identity in title/templateExtId rather than
   // the display name. Parse all native identity fields before rejecting scope.
   const identityText=[m?.name,m?.title,m?.templateExtId,m?.templateId,m?.marketType,m?.period].filter(Boolean).join(' ');
   if(String(m?.status||'active').toLowerCase()!=='active')continue;
   const mapWord=(identityText.match(/\b(first|second|third|fourth|fifth)\s+map\b/i)||[])[1];
   const map=Number((identityText.match(/\bMap[\s_:-]*(\d+)\b/i)||[])[1])||({first:1,second:2,third:3,fourth:4,fifth:5}[String(mapWord||'').toLowerCase()]||0);
   if(!map)continue;
   const active=(m.outcomes||[]).filter(o=>o?.active!==false&&String(o?.name||'').toLowerCase()!=='draw');
   const price=o=>Number(o?.odds??o?.price);
   // Oddin/Stake has used several native shapes for derivative lines. Search
   // outcome fields first, then market-level line fields, then native text.
   const point=o=>{
    const candidates=[o?.handicap,o?.point,o?.line,o?.total,o?.value,o?.spread,
      m?.handicap,m?.point,m?.line,m?.total,m?.value,m?.spread];
    for(const v of candidates){const n=Number(v);if(Number.isFinite(n))return n;}
    const txt=[o?.name,o?.title,o?.extId,m?.name,m?.title,m?.templateExtId,m?.templateId].filter(Boolean).join(' ');
    const par=(txt.match(/\(([+-]?\d+(?:\.\d+)?)\)/)||[])[1];
    if(par!=null)return Number(par);
    const signed=(txt.match(/(?:handicap|spread|line)\D*([+-]\d+(?:\.\d+)?)/i)||[])[1];
    if(signed!=null)return Number(signed);
    const ou=(txt.match(/\b(?:over|under|total)\D*([+-]?\d+(?:\.\d+)?)\b/i)||[])[1];
    return ou!=null?Number(ou):NaN;
   };
   if(/\b(winner|moneyline|result)\b/i.test(identityText)){
    const os=active.map(o=>({name:String(o.name).trim(),price:price(o)})).filter(o=>o.name&&o.price>1);
    if(os.length===2)exact.push({key:'map_winner',name:`Map ${map} Winner`,title:name,period:`Map ${map}`,scope:{map,round:null},outcomes:os,provider:m.provider||null,marketId:m.id||null});
    continue;
   }
   if((/\b(round|rounds)\b/i.test(identityText)||/\bMap[\s_:-]*\d+\s+(?:Round\s+)?Handicap\b/i.test(identityText))&&/\b(handicap|spread)\b/i.test(identityText)){
    const os=active.map(o=>({name:String(o.name).replace(/\s*\([+-]?\d+(?:\.\d+)?\)\s*$/,'').trim(),price:price(o),point:point(o)})).filter(o=>o.name&&o.price>1&&Number.isFinite(o.point));
    if(os.length===2)exact.push({key:'round_handicap',name:`Map ${map} Round Handicap`,title:name,period:`Map ${map}`,scope:{map,round:null},outcomes:os,provider:m.provider||null,marketId:m.id||null});
    continue;
   }
   if((/\b(round|rounds)\b/i.test(identityText)||/\bMap[\s_:-]*\d+\s+Total\b/i.test(identityText))&&/\b(total|over\/under|o\/u)\b/i.test(identityText)){
    const os=active.map(o=>({name:/under/i.test(String(o.name))?'Under':/over/i.test(String(o.name))?'Over':String(o.name).trim(),price:price(o),point:point(o)})).filter(o=>/^(Over|Under)$/i.test(o.name)&&o.price>1&&Number.isFinite(o.point));
    if(os.length===2)exact.push({key:'round_totals',name:`Map ${map} Round Total`,title:name,period:`Map ${map}`,scope:{map,round:null},outcomes:os,provider:m.provider||null,marketId:m.id||null});
   }
  }
  if(exact.length)out.push({id:`${source}:${ev.id||title}`,home_team:pair[0],away_team:pair[1],commence_time:ev?.startTime||ev?.start_time||null,live:Boolean(ev?.isLive||ev?.live),bookmakers:[{key:`${source}-v2`,title:`${source} v2`,markets:exact}]});
 }
 return out;
}

function oddsApiIoSport(raw=''){
 const s=String(raw).toLowerCase();
 if(/counter|cs2|cs:go|csgo/.test(s))return 'cs2';
 if(/valorant/.test(s))return 'valorant';
 if(/league of legends|\\blol\\b/.test(s))return 'lol';
 if(/dota/.test(s))return 'dota2';
 return null;
}
function oddsApiIoScope(text=''){
 const t=String(text);
 const map=Number((t.match(/\\bmap\\s*(\\d+)\\b/i)||t.match(/\\b(first|second|third|fourth|fifth)\\s+map\\b/i)||[])[1]);
 const word=(t.match(/\\b(first|second|third|fourth|fifth)\\s+map\\b/i)||[])[1];
 const mapNum=Number.isFinite(map)&&map>0?map:({first:1,second:2,third:3,fourth:4,fifth:5}[String(word||'').toLowerCase()]||null);
 if(!mapNum)return null;
 if(/winner|moneyline|result/i.test(t))return {key:'map_winner',map:mapNum};
 if(/round.*(handicap|spread)|(handicap|spread).*round/i.test(t))return {key:'round_handicap',map:mapNum};
 if(/(total.*round|round.*total|rounds.*over|rounds.*under)/i.test(t))return {key:'round_totals',map:mapNum};
 return null;
}
function oddsApiIoExact(body,sourceSport){
 const out=[];
 const events=Array.isArray(body?.data)?body.data:Array.isArray(body)?body:Object.values(body?.data||body?.events||{});
 for(const ev of events){
  const title=String(ev?.name||ev?.title||ev?.eventName||'');
  const pair=[ev?.home,ev?.away].every(Boolean)?[String(ev.home),String(ev.away)]:teamsFromTitle(title);
  if(!pair)continue;
  const markets=Array.isArray(ev?.markets)?ev.markets:Array.isArray(ev?.odds)?ev.odds:[];
  const books=new Map();
  for(const m of markets){
   const book=String(m?.bookmaker||m?.book||m?.sportsbook||m?.source||'odds-api-io').trim();
   const label=String(m?.name||m?.market||m?.marketName||m?.label||'');
   const sc=oddsApiIoScope(label); if(!sc)continue;
   const os=Array.isArray(m?.outcomes)?m.outcomes:Array.isArray(m?.prices)?m.prices:[];
   const outcomes=os.map(o=>{
    const name=String(o?.name||o?.label||o?.outcome||'').trim();
    const price=Number(o?.price??o?.odds);
    const point=Number(o?.point??o?.handicap??o?.line??o?.total);
    return {name,price,point:Number.isFinite(point)?point:null};
   }).filter(o=>o.name&&o.price>1);
   if(outcomes.length<2)continue;
   const bm={key:'odds-api-io:'+book.toLowerCase().replace(/[^a-z0-9]+/g,'-'),title:book,markets:[]};
   const key=bm.key; if(!books.has(key))books.set(key,bm);
   books.get(key).markets.push({key:sc.key,name:label,title:label,period:`Map ${sc.map}`,scope:{map:sc.map,round:null},last_update:m?.updatedAt||m?.lastUpdate||ev?.updatedAt||null,outcomes});
  }
  if(books.size)out.push({id:'odds-api-io:'+(ev?.id||title),home_team:pair[0],away_team:pair[1],commence_time:ev?.startTime||ev?.start_time||ev?.commence_time||null,live:Boolean(ev?.live||ev?.isLive),bookmakers:[...books.values()],_sourceSport:sourceSport});
 }
 return out;
}
async function fetchOddsApiIoExact(){
 if(!ODDS_API_IO_KEY){console.log('ODDS_API_IO_SKIP missing ODDS_API_IO_KEY');return []}
 const all=[];
 try{
  const er=await fetch(`${ODDS_API_IO_BASE}/events?apiKey=${encodeURIComponent(ODDS_API_IO_KEY)}&sport=esports`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)});
  const eb=await er.json().catch(()=>({})); if(!er.ok){console.warn('ODDS_API_IO_EVENTS_FAIL',er.status);return []}
  const events=Array.isArray(eb?.data)?eb.data:Array.isArray(eb)?eb:Object.values(eb?.data||eb?.events||{});
  // Spend requests only on supported target titles and upcoming/live events.
  for(const ev of events.slice(0,250)){
   const sport=oddsApiIoSport(ev?.sport||ev?.league||ev?.category||ev?.name||ev?.title); if(!sport)continue;
   const id=ev?.id||ev?.eventId; if(!id)continue;
   try{
    const r=await fetch(`${ODDS_API_IO_BASE}/odds?apiKey=${encodeURIComponent(ODDS_API_IO_KEY)}&eventId=${encodeURIComponent(id)}`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
    const b=await r.json().catch(()=>({})); if(!r.ok)continue;
    // Some responses omit event metadata, so merge it back before normalization.
    const payload=Array.isArray(b?.data)?{data:b.data.map(x=>({...ev,...x}))}:{data:[{...ev,...(b?.data||b)}]};
    all.push(...oddsApiIoExact(payload,sport));
   }catch{}
   if(all.length>=250)break;
  }
 }catch(e){console.warn('ODDS_API_IO_ERROR',String(e?.message||e))}
 console.log('ODDS_API_IO_EXACT_EVENTS',all.length);
 return all;
}


async function fetchOddsPapiExact(){
 if(!ODDSPAPI_API_KEY){console.log('ODDSPAPI_SKIP missing ODDSPAPI_API_KEY');return []}
 const get=async(path,params={})=>{
  const u=new URL(ODDSPAPI_BASE+'/'+path); for(const [k,v] of Object.entries({...params,apiKey:ODDSPAPI_API_KEY})) if(v!=null)u.searchParams.set(k,String(v));
  const r=await fetch(u,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(60000)});
  const text=await r.text(); let body; try{body=JSON.parse(text)}catch{body={raw:text.slice(0,500)}}
  if(!r.ok)console.warn('ODDSPAPI_FAIL',path,r.status,JSON.stringify(body).slice(0,300));
  await sleep(1050); return {ok:r.ok,status:r.status,body};
 };
 const sr=await get('sports'); if(!sr.ok)return [];
 const sports=Array.isArray(sr.body)?sr.body:(sr.body?.data||[]);
 const wanted=[];
 for(const s of sports){
  const n=String(s.sportName||s.name||s.slug||'').toLowerCase();
  const dst=/counter|cs2|cs:go|csgo/.test(n)?'cs2':/league of legends|\\blol\\b/.test(n)?'lol':/valorant/.test(n)?'valorant':/dota/.test(n)?'dota2':null;
  if(dst)wanted.push({id:Number(s.sportId??s.id),dst});
 }
 console.log('ODDSPAPI_SPORTS',JSON.stringify(wanted));
 const mr=await get('markets',{language:'en'}); if(!mr.ok)return [];
 const allMarkets=Array.isArray(mr.body)?mr.body:(mr.body?.data||[]);
 const marketMeta=new Map(allMarkets.map(m=>[String(m.marketId??m.id),m]));
 const relevant=allMarkets.filter(m=>wanted.some(s=>s.id===Number(m.sportId)) && (
   /map.*winner|maps handicap|total maps/i.test(String(m.marketName||'')) || m.playerProp===true
 ));
 console.log('ODDSPAPI_MARKET_CATALOG',relevant.length,JSON.stringify(relevant.slice(0,60).map(m=>({id:m.marketId,name:m.marketName,sportId:m.sportId,line:m.handicap,period:m.period,type:m.marketType,playerProp:m.playerProp}))));
 console.log('ODDSPAPI_DERIVATIVE_CATALOG',JSON.stringify(allMarkets.filter(m=>wanted.some(s=>s.id===Number(m.sportId))&&/round|kill|assist|headshot|player|handicap|total/i.test(String(m.marketName||''))).map(m=>({id:m.marketId,name:m.marketName,sportId:m.sportId,line:m.handicap,period:m.period,type:m.marketType,playerProp:m.playerProp})).slice(0,500)));
 const out=[]; const now=new Date(), to=new Date(Date.now()+9*864e5); let oddsShapeLogged=false;
 const wordMap={first:1,second:2,third:3,fourth:4,fifth:5};
 const mapNo=(meta)=>{
  const z=(String(meta.marketName||'')+' '+String(meta.period||'')).toLowerCase();
  const d=z.match(/(?:map|p)\\s*(\\d+)/); if(d)return Number(d[1]);
  const w=z.match(/(first|second|third|fourth|fifth)\\s+map/); return w?wordMap[w[1]]:null;
 };
 for(const s of wanted){
  const fr=await get('fixtures',{sportId:s.id,from:now.toISOString(),to:to.toISOString(),statusId:0,hasOdds:true}); if(!fr.ok)continue;
  const fixtures=Array.isArray(fr.body)?fr.body:(fr.body?.data||[]);
  console.log('ODDSPAPI_FIXTURES',s.dst,fixtures.length);
  for(const ev of fixtures.slice(0,80)){
   const id=ev.fixtureId??ev.id;if(!id)continue;
   const or=await get('odds',{fixtureId:id,oddsFormat:'decimal',language:'en',verbosity:3}); if(!or.ok)continue;
   const bdy=or.body?.data??or.body;
   if(!oddsShapeLogged){console.log('ODDSPAPI_ODDS_SHAPE',JSON.stringify(bdy).slice(0,5000));oddsShapeLogged=true}
   let books=bdy?.bookmakerOdds||bdy?.bookmakers||{};
   // v4 can return flat odds rows instead of nested bookmaker objects.
   if(Array.isArray(bdy)){
    books={};
    for(const row of bdy){
     const bk=String(row.bookmakerSlug||row.bookmakerName||row.bookmaker||row.bookmakerId||'unknown');
     const mid=String(row.marketId??row.market?.marketId??'');
     if(!mid)continue;
     books[bk]??={markets:{}}; books[bk].markets[mid]??={outcomes:[],changedAt:row.changedAt||row.updatedAt};
     const vals=Array.isArray(row.outcomes)?row.outcomes:[row];
     for(const v of vals)books[bk].markets[mid].outcomes.push(v);
    }
   }
   const bookmakers=[];
   for(const [book,bd] of Object.entries(books)){
    const markets=[];
    for(const [mid,md] of Object.entries(bd?.markets||{})){
     const meta=marketMeta.get(String(mid))||{}; const label=String(meta.marketName||md?.marketName||md?.name||'');
     const period=String(meta.period||md?.period||''); const line=Number(meta.handicap);
     let key=null,map=mapNo(meta);
     if(/map.*winner/i.test(label))key='map_winner';
     // OddsPapi CS2 "Maps Handicap" and "Total Maps" are SERIES map-count markets,
     // not Thunderpick per-map round handicaps/totals. Keep them exact instead of
     // falsely relabelling them as round markets.
     else if(/maps handicap/i.test(label))key='spreads';
     else if(/total maps/i.test(label))key='totals';
     else if(meta.playerProp===true)key='player_prop';
     else continue;
     const outcomes=[];
     // OddsPapi v4 nests executable prices as market.outcomes[outcomeId].players[playerId].
     // The semantic side/line lives in market metadata + outcome metadata, not on the price leaf.
     const rawOut=md?.outcomes||{};
     for(const [oid,od] of Object.entries(rawOut)){
      const om=(Array.isArray(meta.outcomes)?meta.outcomes.find(x=>String(x.outcomeId??x.id)===String(oid)):null)||{};
      const semantic=String(om.outcomeName||om.name||om.label||od?.outcomeName||od?.name||'').trim();
      const pts=Number(om.handicap??om.line??om.total??line);
      const players=od?.players&&typeof od.players==='object'?Object.values(od.players):[od];
      for(const pv of players){
       const price=Number(pv?.price??pv?.odds);
       const pname=String(pv?.playerName||'').trim();
       const name=(meta.playerProp&&pname)?(semantic?semantic+' '+pname:pname):semantic;
       if(name&&price>1)outcomes.push({name,price,point:Number.isFinite(pts)?pts:null,player:pname||null});
      }
     }
     // Fallback for providers that return already flattened outcomes.
     if(!outcomes.length){
      const walk=(v)=>{if(Array.isArray(v)){for(const x of v)walk(x);return}if(!v||typeof v!=='object')return;
       const price=Number(v.price??v.odds),name=String(v.outcomeName||v.name||v.label||'').trim();
       if(name&&price>1){const p=Number(v.handicap??v.line??v.total??line);outcomes.push({name,price,point:Number.isFinite(p)?p:null});return}
       for(const x of Object.values(v))if(x&&typeof x==='object')walk(x);
      };walk(md?.outcomes||md);
     }
     const uniq=[];const seen=new Set();for(const o of outcomes){const k=o.name+'|'+o.point+'|'+o.price;if(!seen.has(k)){seen.add(k);uniq.push(o)}}
     if(uniq.length>=2)markets.push({key,name:label,title:label,period,scope:{map,round:null},line:Number.isFinite(line)?line:null,last_update:md?.changedAt||bdy?.updatedAt||null,outcomes:uniq});
    }
    if(markets.length)bookmakers.push({key:'oddspapi:'+book,title:book,markets});
   }
   if(bookmakers.length){
    const p1=String(bdy?.participant1Name||ev?.participant1Name||ev?.homeName||ev?.participants?.[0]?.name||'').trim();
    const p2=String(bdy?.participant2Name||ev?.participant2Name||ev?.awayName||ev?.participants?.[1]?.name||'').trim();
    if(p1&&p2)out.push({id:'oddspapi:'+id,home_team:p1,away_team:p2,commence_time:bdy?.startTime||ev?.startTime||null,live:false,bookmakers,_sourceSport:s.dst});
   }
  }
 }
 const counts={};for(const e of out)for(const b of e.bookmakers)for(const m of b.markets)counts[m.key]=(counts[m.key]||0)+1;
 console.log('ODDSPAPI_EXACT_EVENTS',out.length,'BOOK_ROWS',out.reduce((n,e)=>n+e.bookmakers.length,0),'MARKETS',JSON.stringify(counts));
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
 // Direct derivative feed first. Every bookmaker remains a separate independent
 // source; screen-thunderpick-ev still enforces exact event/side/line/map identity.
 exact.push(...await fetchOddsApiIoExact());
 exact.push(...await fetchOddsPapiExact());
 const exactSpecs=[];
 for(const sport of ['cs2','lol','valorant','dota2']){
  exactSpecs.push({book:'stake',sport},{book:'rainbet',sport},{book:'polymarket',sport},{book:'kalshi',sport},{book:'fanaticsmarkets',sport});
 }
 // Pinnacle is queried once as its esports source is cross-title.
 exactSpecs.push({book:'pinnacle',sport:'esports'});
 for(const spec of exactSpecs){
  if(spec.book==='stake'){
   let body=stakeCachedBodies[spec.sport];
   if(!body){const br=await v2get(`/stake/${spec.sport}`); if(br.ok){body=br.body;stakeCachedBodies[spec.sport]=body;}}
   console.log('STAKE_REUSE',Boolean(body),body?.count,body?.meta?.status); if(body){const parsed=stakeExact(body,'stake').map(e=>({...e,_sourceSport:spec.sport})); exact.push(...parsed); console.log('STAKE_EXACT_PARSED',spec.sport,parsed.length,parsed.reduce((n,e)=>n+(e.bookmakers?.[0]?.markets?.length||0),0),body?.meta?.status,body?.meta?.ageSeconds);} continue;
  }
  if(spec.book==='rainbet'){
   const br=await v2get(`/rainbet/${spec.sport}`);
   if(br.ok){const parsed=stakeExact(br.body,'rainbet').map(e=>({...e,_sourceSport:spec.sport})); exact.push(...parsed); console.log('RAINBET_EXACT_PARSED',spec.sport,parsed.length,parsed.reduce((n,e)=>n+(e.bookmakers?.[0]?.markets?.length||0),0),br.body?.meta?.status,br.body?.meta?.ageSeconds);}
   continue;
  }
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


// PLAYER_PROPS_ENRICHMENT: use Owls' dedicated merged props endpoint as an
// independent normalized prop board. This is separate from /odds and keeps
// exact player + category + line + side + book identity for fail-closed matching.
const PROP_SPORT_MAP={cs2:'cs2',mlb:'mlb',nba:'nba',ncaaf:'ncaaf',nfl:'nfl',tennis:'tennis',wnba:'wnba'};
function normalizePropRows(body,sourceSport){
 const out=[]; const data=body?.data??body;
 const stack=[data];
 while(stack.length){
  const v=stack.pop();
  if(Array.isArray(v)){for(const q of v)stack.push(q);continue;}
  if(!v||typeof v!=='object')continue;
  const player=String(v.player??v.player_name??v.playerName??v.description??'').trim();
  const market=String(v.market??v.market_key??v.category??v.stat??v.stat_type??'').trim();
  const line=Number(v.line??v.point??v.threshold);
  const over=Number(v.over_price??v.overPrice??v.over_odds??v.overOdds);
  const under=Number(v.under_price??v.underPrice??v.under_odds??v.underOdds);
  const book=String(v.bookmaker??v.book??v.sportsbook??v.source??'').trim();
  if(player&&market&&Number.isFinite(line)&&book&&(over>1||under>1)){
   out.push({player,market,line,book,over:over>1?over:null,under:under>1?under:null,eventId:v.event_id??v.eventId??null,eventName:v.event_name??v.eventName??v.match??null,lastUpdate:v.last_update??v.lastUpdate??v.updated_at??null,sourceSport});
   continue;
  }
  for(const q of Object.values(v))if(q&&typeof q==='object')stack.push(q);
 }
 return out;
}
const playerProps={generatedAt:new Date().toISOString(),source:'Owls Insight dedicated props API',sports:{},requestCount:0};
for(const [dst,apiSport] of Object.entries(PROP_SPORT_MAP)){
 try{
  const r=await fetch(`${base}/${apiSport}/props`,{headers:{Authorization:`Bearer ${API_KEY}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
  playerProps.requestCount++;
  const text=await r.text();let body;try{body=JSON.parse(text)}catch{body={raw:text.slice(0,500)}}
  const rows=r.ok?normalizePropRows(body,apiSport):[];
  playerProps.sports[dst]={ok:r.ok,status:r.status,fetchedAt:new Date().toISOString(),rowCount:rows.length,rows};
  console.log('OWLS_PLAYER_PROPS',dst,'status='+r.status,'rows='+rows.length);
 }catch(e){
  playerProps.sports[dst]={ok:false,status:null,fetchedAt:new Date().toISOString(),rowCount:0,rows:[],error:String(e?.message||e)};
  console.warn('OWLS_PLAYER_PROPS_ERROR',dst,String(e?.message||e));
 }
 await sleep(900);
}
await fs.writeFile('data/player-props-latest.json',JSON.stringify(playerProps,null,2));

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
