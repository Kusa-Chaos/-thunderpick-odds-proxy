import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer-core';

const GAME_IDS={lol:3,dota2:4,cs2:6,soccer:10,basketball:11,baseball:13,tennis:15,'american-football':18,valorant:32};
const ORDER=['american-football','cs2','dota2','lol','valorant','baseball','basketball','soccer','tennis'];
const DEEP_HORIZON_MS=72*60*60*1000;
const DEEP_CONCURRENCY=Math.max(1,Math.min(4,Number(process.env.TP_DEEP_CONCURRENCY||3)));
const REQUEST_GAP_MS=Math.max(100,Number(process.env.TP_REQUEST_GAP_MS||220));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const generatedAt=new Date().toISOString();
const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome';
const propLike=name=>/\bplayer\b|passing|rushing|receiving|receptions?|touchdowns?|attempts?|completions?|interceptions?|points?|rebounds?|assists?|three[- ]?pointers?|3[- ]?pointers?|steals?|blocks?|turnovers?|strikeouts?|total bases|home runs?|\brbi\b|\bwalks?\b|\baces?\b|double faults?|shots? on target|\bshots?\b|\bcards?\b|\bkills?\b|\bdeaths?\b|headshots?/i.test(String(name||''));
async function mapLimit(items,limit,fn){const out=new Array(items.length);let next=0;async function worker(){for(;;){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i],i)}}await Promise.all(Array.from({length:Math.min(limit,Math.max(1,items.length))},worker));return out}
let throttleTail=Promise.resolve();
let globalCooldownUntil=0;
function throttleStart(){
  const turn=throttleTail.then(async()=>{
    const now=Date.now();
    const wait=Math.max(0,globalCooldownUntil-now);
    if(wait)await sleep(wait);
    await sleep(REQUEST_GAP_MS);
  });
  throttleTail=turn.catch(()=>{});
  return turn;
}
function applyCooldown(ms){globalCooldownUntil=Math.max(globalCooldownUntil,Date.now()+ms)}
const browser=await puppeteer.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled','--window-size=1440,1000'],defaultViewport:{width:1440,height:1000}});
const sports={}; let pageStatus=null,finalUrl=null,title=null,bootstrapOk=false,bootstrapStatus=null;
try{
 const page=await browser.newPage(); await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'); await page.setExtraHTTPHeaders({'accept-language':'en-US,en;q=0.9'}); await page.evaluateOnNewDocument(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>undefined});});
 for(const entry of ['https://thunderpick.io/en/esports/lol','https://thunderpick.io/en/sports','https://thunderpick.io/404']){const nav=await page.goto(entry,{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>null);pageStatus=nav?.status()??null;await sleep(7000);finalUrl=page.url();title=await page.title().catch(()=>null);const test=await page.evaluate(async gid=>{try{const r=await fetch('/api/matches',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({gameIds:[gid]})});return{status:r.status,ok:r.ok}}catch(e){return{status:null,ok:false,error:String(e?.message||e)}}},GAME_IDS.lol);bootstrapStatus=test.status;if(test.ok){bootstrapOk=true;break}await sleep(5000)}
 if(!bootstrapOk)throw new Error(`Thunderpick browser bootstrap failed; last status=${bootstrapStatus} title=${title}`);
 const fetchMatches=gid=>page.evaluate(async gid=>{try{const r=await fetch('/api/matches',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({gameIds:[gid]})});const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{}const rows=body?.data?.upcoming||body?.data?.matches||[];return{status:r.status,ok:r.ok,rows:Array.isArray(rows)?rows:[],error:body?.message||body?.error||null}}catch(e){return{status:null,ok:false,rows:[],error:String(e?.message||e)}}},gid);
 const fetchMarkets=id=>page.evaluate(async id=>{try{const r=await fetch('/api/markets/'+encodeURIComponent(String(id)),{headers:{accept:'application/json'}});const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{}return{status:r.status,ok:r.ok,markets:Array.isArray(body?.data)?body.data:[],error:body?.message||body?.error||null}}catch(e){return{status:null,ok:false,markets:[],error:String(e?.message||e)}}},id);
 async function matchesWithRetry(gid){
   let last={status:null,ok:false,rows:[],error:'not attempted'};
   for(let attempt=0;attempt<5;attempt++){
     await throttleStart();
     last=await fetchMatches(gid);
     if(last.status!==429)return last;
     const delay=Math.min(15000,1500*(2**attempt)+Math.floor(Math.random()*700));
     applyCooldown(delay);
   }
   return last;
 }
 async function marketsWithRetry(id,on429){
   let last={status:null,ok:false,markets:[],error:'not attempted'};
   for(let attempt=0;attempt<5;attempt++){
     await throttleStart();
     last=await fetchMarkets(id);
     if(last.status!==429)return last;
     on429?.();
     const delay=Math.min(12000,1200*(2**attempt)+Math.floor(Math.random()*600));
     applyCooldown(delay);
   }
   return last;
 }
 for(const sport of ORDER){const gid=GAME_IDS[sport],fetchedAt=new Date().toISOString(),result=await matchesWithRetry(gid),rows=result.rows||[],healthy=result.ok&&result.status===200;let deepMarketRequests=0,deepMarketSuccess=0,deepMarketFailures=0,deepMarkets=0,playerPropLikeMarkets=0,deep429s=0,deepEligibleEvents=0,deepSelectedEvents=0;
  if(healthy){const now=Date.now();const selected=rows.filter(e=>{const start=Date.parse(e?.startTime||'');return e?.id&&e?.isLive!==true&&Number.isFinite(start)&&start>now-5*60e3&&start<=now+DEEP_HORIZON_MS}).sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));deepEligibleEvents=selected.length;deepSelectedEvents=selected.length;
   const failed=[];
   await mapLimit(selected,DEEP_CONCURRENCY,async e=>{deepMarketRequests++;const detail=await marketsWithRetry(e.id,()=>deep429s++);if(detail.ok&&detail.status===200){deepMarketSuccess++;deepMarkets+=detail.markets.length;playerPropLikeMarkets+=detail.markets.filter(m=>propLike(m?.name)).length;e.preferredMarkets=detail.markets;e.deepMarketsFetchedAt=new Date().toISOString();e.deepMarketsFresh=true}else{failed.push(e);e.deepMarketsFresh=false;e.deepMarketsError=detail.error||`HTTP ${detail.status}`}return detail.status});
   if(failed.length){applyCooldown(4000);for(const e of failed){deepMarketRequests++;const detail=await marketsWithRetry(e.id,()=>deep429s++);if(detail.ok&&detail.status===200){deepMarketSuccess++;deepMarkets+=detail.markets.length;playerPropLikeMarkets+=detail.markets.filter(m=>propLike(m?.name)).length;e.preferredMarkets=detail.markets;e.deepMarketsFetchedAt=new Date().toISOString();e.deepMarketsFresh=true;e.deepMarketsError=null}else{deepMarketFailures++;e.deepMarketsFresh=false;e.deepMarketsError=detail.error||`HTTP ${detail.status}`}}}
  }
  const coverageStatus=!healthy?'first-party-error':deepSelectedEvents===0?'fresh-first-party':deepMarketFailures===0&&deepMarketSuccess===deepSelectedEvents?'fresh-first-party-deep':'fresh-first-party-deep-partial';sports[sport]={ok:healthy,httpOk:healthy,status:result.status,fetchedAt,gameId:gid,eventCount:rows.length,retainedMarketCount:rows.reduce((n,e)=>n+(Array.isArray(e?.preferredMarkets)?e.preferredMarkets.length:0)+(e?.market?1:0),0),deepEligibleEvents,deepSelectedEvents,deepSkippedByCap:0,deepMarketRequests,deepMarketSuccess,deepMarketFailures,deep429s,deepMarkets,playerPropLikeMarkets,deepConcurrency:DEEP_CONCURRENCY,requestGapMs:REQUEST_GAP_MS,hash:sha(rows),changedSincePrevious:null,coverageStatus,usedFallback:false,error:healthy?null:(result.error||`HTTP ${result.status}`),data:{data:rows}};console.log('THUNDERPICK_FIRSTPARTY',sport,JSON.stringify({status:result.status,ok:healthy,events:rows.length,deepEligibleEvents,deepSelectedEvents,deepMarketSuccess,deepMarketFailures,deep429s,deepMarkets,playerPropLikeMarkets,deepConcurrency:DEEP_CONCURRENCY,requestGapMs:REQUEST_GAP_MS,coverageStatus}));await sleep(1000)}
}finally{await browser.close()}
const successfulSports=ORDER.filter(s=>sports[s]?.ok),failedSports=ORDER.filter(s=>!sports[s]?.ok||/partial|error/i.test(String(sports[s]?.coverageStatus||'')));const snapshot={generatedAt,source:'Thunderpick first-party /api/matches + /api/markets/<id> via unattended cloud browser',format:'first-party-browser-v6-deep-all-nearterm-rate-safe',sports};const meta={generatedAt,source:snapshot.source,format:snapshot.format,pageStatus,finalUrl,title,bootstrapOk,bootstrapStatus,deepConcurrency:DEEP_CONCURRENCY,requestGapMs:REQUEST_GAP_MS,requestCountThisRun:ORDER.length+1+ORDER.reduce((n,s)=>n+(sports[s]?.deepMarketRequests||0),0),requestedSports:ORDER,successfulSports:ORDER.filter(s=>sports[s]?.ok&&!/partial|error/i.test(String(sports[s]?.coverageStatus||''))),failedSports,coverageAnomalies:failedSports.map(s=>({sport:s,status:sports[s]?.status??null,coverageStatus:sports[s]?.coverageStatus||null,deepSelectedEvents:sports[s]?.deepSelectedEvents||0,deepMarketSuccess:sports[s]?.deepMarketSuccess||0,deepMarketFailures:sports[s]?.deepMarketFailures||0,reason:sports[s]?.error||sports[s]?.coverageStatus||'first-party/deep fetch failed'})),coverageComplete:failedSports.length===0,quotaExhausted:false,quotaResetMonth:null,totalEvents:ORDER.reduce((n,s)=>n+(sports[s]?.eventCount||0),0),totalRetainedMarkets:ORDER.reduce((n,s)=>n+(sports[s]?.retainedMarketCount||0),0),totalDeepMarkets:ORDER.reduce((n,s)=>n+(sports[s]?.deepMarkets||0),0),totalPlayerPropLikeMarkets:ORDER.reduce((n,s)=>n+(sports[s]?.playerPropLikeMarkets||0),0),sports:Object.fromEntries(ORDER.map(s=>[s,{...sports[s],data:undefined}]))};await fs.mkdir('data',{recursive:true});await fs.writeFile('data/owls-latest.json',JSON.stringify(snapshot));await fs.writeFile('data/owls-meta.json',JSON.stringify(meta,null,2));console.log('THUNDERPICK_FIRSTPARTY_COMPLETE',JSON.stringify({successfulSports:meta.successfulSports,failedSports,totalEvents:meta.totalEvents,totalMarkets:meta.totalRetainedMarkets,totalDeepMarkets:meta.totalDeepMarkets,totalPlayerPropLikeMarkets:meta.totalPlayerPropLikeMarkets,deepConcurrency:DEEP_CONCURRENCY,requestGapMs:REQUEST_GAP_MS,bootstrapStatus}));if(failedSports.length)process.exitCode=2;