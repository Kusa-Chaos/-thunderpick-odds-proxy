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
function kalshiExact(body){
 const groups=new Map();
 for(const m of Object.values(body?.data||{})){
  const text=`${m.title||''} ${m.rules_primary||''}`; const sc=scopedKey(text); if(!sc||sc.map==null||sc.key!=='map_winner')continue;
  const pairMatch=String(m.rules_primary||'').match(/:\s*(.+?)\s+vs\.?\s+(.+?)\s+CS2 match/i); if(!pairMatch)continue;
  const pair=[pairMatch[1].trim(),pairMatch[2].trim()]; const k=`${pair[0]}|${pair[1]}|map${sc.map}`;
  if(!groups.has(k))groups.set(k,{pair,map:sc.map,rows:[]});
  const p=Number(m.yes_ask_dollars); const name=m.yes_sub_title||String(m.title||'').replace(/\s+wins map.*$/i,'').trim();
  if(p>0&&p<1)groups.get(k).rows.push({name,price:decOdds(p)});
 }
 const out=[];
 for(const [k,g] of groups){if(g.rows.length!==2)continue;out.push({id:'kalshi:'+k,home_team:g.pair[0],away_team:g.pair[1],live:false,bookmakers:[{key:'kalshi-v2',title:'Kalshi v2',markets:[{key:'map_winner',name:`Map ${g.map} Winner`,period:`Map ${g.map}`,scope:{map:g.map,round:null},outcomes:g.rows}]}]});}
 return out;
}
try{
 const exact=[];
 for(const spec of [{book:'kalshi',sport:'cs2'},{book:'polymarket',sport:'cs2'}]){
  const lr=await v2get(`/${spec.book}/${spec.sport}/leagues`); if(!lr.ok)continue;
  const leagues=lr.body?.data||lr.body?.leagues||lr.body||[];
  for(const row of (Array.isArray(leagues)?leagues:[])){
   const league=typeof row==='string'?row:(row?.leagueKey||row?.key||row?.slug||row?.id); if(!league)continue;
   const br=await v2get(`/${spec.book}/${spec.sport}?league=${encodeURIComponent(String(league))}`); if(!br.ok)continue;
   exact.push(...(spec.book==='polymarket'?polyExact(br.body):kalshiExact(br.body)));
   await sleep(300);
  }
 }
 sports.cs2 ||= {ok:true,status:200,data:{}};
 sports.cs2.exactV2=exact;
 sports.cs2.exactV2EventCount=exact.length;
 console.log('OWLS_V2_EXACT_EVENTS',exact.length);
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
