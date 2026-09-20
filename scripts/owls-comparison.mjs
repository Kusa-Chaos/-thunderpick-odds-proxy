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

      // Resolve exact map/round identity from 1xBet's own prematch event-detail feed.
      // Limit to two derivative-bearing events per sport to keep request use small.
      const detail=[];
      const events=[];
      const walk=[data];
      while(walk.length&&events.length<2){
        const v=walk.pop();
        if(Array.isArray(v)){for(const q of v)walk.push(q);continue;}
        if(!v||typeof v!=='object')continue;
        if(v.id&&Array.isArray(v.bookmakers)&&JSON.stringify(v).match(/map_winner|round_handicap|round_totals/i)){
          events.push(v);continue;
        }
        for(const q of Object.values(v)) if(q&&typeof q==='object') walk.push(q);
      }
      for(const ev of events){
        try{
          const url=`https://1xbet.com/LineFeed/GetGameZip?id=${encodeURIComponent(ev.id)}&lng=en&cfview=0&isSubGames=true&GroupEvents=true&countevents=250`;
          const dr=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)});
          const raw=await dr.text(); let body; try{body=JSON.parse(raw)}catch{body={raw}};
          detail.push({id:String(ev.id),home:ev.home_team,away:ev.away_team,status:dr.status,ok:dr.ok,data:body});
          console.log('1XBET_GAMEZIP',sport,ev.id,'status='+dr.status,'ok='+dr.ok,'bytes='+raw.length);
        }catch(e){
          detail.push({id:String(ev.id),home:ev.home_team,away:ev.away_team,error:String(e?.message||e)});
        }
        await sleep(250);
      }
      sports[sport].oneXBetGameZip=detail;
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
  const rows=(z.oneXBetDerivativeSamples||[]).slice(0,40);
  derivativeDiagnostic.sports[sport]={
    source:'owls-v1-odds-1xbet',
    sampleCount:rows.length,
    samples:rows,
    gameZip:(z.oneXBetGameZip||[]).map(x=>({id:x.id,home:x.home,away:x.away,status:x.status,ok:x.ok,error:x.error||null,data:x.data||null}))
  };
}
await fs.writeFile('data/pinnacle-esports-derivative-debug.json',JSON.stringify(derivativeDiagnostic,null,2));
await fs.writeFile('data/owls-comparison-latest.json',JSON.stringify({generatedAt:new Date().toISOString(),source:'Owls v1 normalized esports + sports odds',requestCountThisRun:SPORTS.length,failedSports:failures,sports},null,2));
if(failures.length) console.warn('OWLS_PARTIAL_FAILURES',JSON.stringify(failures.map(f=>({sport:f.sport,status:f.status,error:f.error}))));
