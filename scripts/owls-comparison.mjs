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
    // Owls docs expose Pinnacle esports in raw realtime wire format. Keep it separately
    // so map/round identity can be recovered without pretending normalized 1xBet markets have scope.
    if(r.ok&&ESPORTS.has(sport)){
      try{
        let leagues=[];
        // /odds is keyed by sportsbook and does not reliably expose league at this level.
        // Owls documents /events specifically for discovering event IDs and league labels.
        try{
          const er=await fetch(`${base}/${sport}/events`,{headers:{Authorization:`Bearer ${API_KEY}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
          const eb=await er.json().catch(()=>({}));
          const eventRows=Array.isArray(eb?.data)?eb.data:(Array.isArray(eb?.events)?eb.events:[]);
          leagues=[...new Set(eventRows.map(e=>e?.league).map(x=>typeof x==='string'?x:(x?.name||'')).filter(Boolean))].slice(0,8);
          console.log('PINNACLE_LEAGUE_DISCOVERY',sport,'events='+eventRows.length,'leagues='+leagues.length,leagues.join(' | '));
        }catch(e){console.warn('PINNACLE_LEAGUE_DISCOVERY_ERROR',sport,String(e?.message||e));}
        const realtime=[];
        for(const league of leagues){
          const rr=await fetch(`${base}/${sport}/realtime?league=${encodeURIComponent(league)}`,{headers:{Authorization:`Bearer ${API_KEY}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
          const raw=await rr.text();
          let rt; try{rt=JSON.parse(raw)}catch{rt={raw}};
          const payload=rt?.data??rt;
          const payloadSize=Array.isArray(payload)?payload.length:(payload&&typeof payload==='object'?Object.keys(payload).length:0);
          console.log('PINNACLE_REALTIME',sport,JSON.stringify(league),'status='+rr.status,'ok='+rr.ok,'items='+payloadSize,'body='+raw.slice(0,240).replace(/\\s+/g,' '));
          // Persist non-200 responses too: endpoint/schema errors are diagnostic evidence.
          realtime.push({league,status:rr.status,ok:rr.ok,data:payload});
          await sleep(350);
        }
        sports[sport].pinnacleRealtime=realtime;
        sports[sport].pinnacleRealtimeLeagueCount=realtime.length;
      }catch(e){sports[sport].pinnacleRealtimeError=String(e?.message||e);}
    }
    if(!r.ok) { failures.push({sport,status:r.status,body}); console.error('OWLS_FAIL',sport,r.status,JSON.stringify(body).slice(0,500)); }
  }catch(e){sports[sport]={ok:false,status:null,fetchedAt:new Date().toISOString(),error:String(e?.message||e),eventCount:0,data:null};failures.push({sport,error:String(e?.message||e)});console.error('OWLS_ERROR',sport,String(e?.message||e));}
  await sleep(3300);
}
await fs.mkdir('data',{recursive:true});
// Persist only a compact diagnostic view of raw Pinnacle realtime esports data.
// The full comparison board can be too large for repository publication.
const derivativeDiagnostic={generatedAt:new Date().toISOString(),sports:{}};
for(const sport of [...ESPORTS]){
  const z=sports[sport]||{};
  const rows=[];
  for(const pack of z.pinnacleRealtime||[]){
    const stack=[pack?.data];
    while(stack.length&&rows.length<100){
      const v=stack.pop();
      if(Array.isArray(v)){for(const q of v)stack.push(q);continue;}
      if(!v||typeof v!=='object')continue;
      const raw=JSON.stringify(v);
      if(/map|round|period|handicap|total/i.test(raw)){
        rows.push({league:pack.league,raw:v});
        continue;
      }
      for(const q of Object.values(v)) if(q&&typeof q==='object') stack.push(q);
    }
  }
  derivativeDiagnostic.sports[sport]={
    realtimeLeagueCount:z.pinnacleRealtimeLeagueCount||0,
    realtimeError:z.pinnacleRealtimeError||null,
    sampleCount:rows.length,
    samples:rows
  };
}
await fs.writeFile('data/pinnacle-esports-derivative-debug.json',JSON.stringify(derivativeDiagnostic,null,2));
await fs.writeFile('data/owls-comparison-latest.json',JSON.stringify({generatedAt:new Date().toISOString(),source:'Owls v1 normalized esports + sports odds',requestCountThisRun:SPORTS.length,failedSports:failures,sports},null,2));
if(failures.length) console.warn('OWLS_PARTIAL_FAILURES',JSON.stringify(failures.map(f=>({sport:f.sport,status:f.status,error:f.error}))));
