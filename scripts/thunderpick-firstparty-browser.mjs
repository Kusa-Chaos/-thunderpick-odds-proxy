import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer-core';

const GAME_IDS={
  lol:3,
  dota2:4,
  cs2:6,
  soccer:10,
  basketball:11,
  baseball:13,
  tennis:15,
  'american-football':18,
  valorant:32,
};
const ORDER=['american-football','cs2','dota2','lol','valorant','baseball','basketball','soccer','tennis'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const generatedAt=new Date().toISOString();
const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome';

const browser=await puppeteer.launch({
  headless:true,
  executablePath:chrome,
  args:[
    '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled','--window-size=1440,1000',
  ],
  defaultViewport:{width:1440,height:1000},
});

const sports={};
let pageStatus=null, finalUrl=null, title=null, bootstrapOk=false, bootstrapStatus=null;
try{
  const page=await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({'accept-language':'en-US,en;q=0.9'});
  await page.evaluateOnNewDocument(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>undefined});});

  // Establish a normal first-party browser session. The sportsbook API is then
  // called same-origin from the page, avoiding paid aggregators and stale caches.
  const entries=['https://thunderpick.io/en/esports/lol','https://thunderpick.io/en/sports','https://thunderpick.io/404'];
  for(const entry of entries){
    const nav=await page.goto(entry,{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>null);
    pageStatus=nav?.status()??null;
    await sleep(7000);
    finalUrl=page.url(); title=await page.title().catch(()=>null);
    const test=await page.evaluate(async gid=>{
      try{
        const r=await fetch('/api/matches',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({gameIds:[gid]})});
        const text=await r.text(); return {status:r.status,ok:r.ok,bytes:text.length};
      }catch(e){return {status:null,ok:false,error:String(e?.message||e)}}
    },GAME_IDS.lol);
    bootstrapStatus=test.status;
    if(test.ok){bootstrapOk=true;break;}
    await sleep(5000);
  }

  if(!bootstrapOk) throw new Error(`Thunderpick browser bootstrap failed; last status=${bootstrapStatus} title=${title}`);

  for(const sport of ORDER){
    const gid=GAME_IDS[sport];
    const fetchedAt=new Date().toISOString();
    const result=await page.evaluate(async gid=>{
      try{
        const r=await fetch('/api/matches',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({gameIds:[gid]})});
        const text=await r.text(); let body=null; try{body=JSON.parse(text)}catch{}
        const rows=body?.data?.upcoming||body?.data?.matches||[];
        return {status:r.status,ok:r.ok,bytes:text.length,rows:Array.isArray(rows)?rows:[],statusCode:body?.statusCode??null,error:body?.message||body?.error||null};
      }catch(e){return {status:null,ok:false,bytes:0,rows:[],error:String(e?.message||e)}}
    },gid);
    const rows=result.rows||[];
    const healthy=result.ok&&result.status===200;

    // The top-level /api/matches payload only includes preferred/main markets.
    // Thunderpick's own match page fetches the full market board from
    // GET /api/markets/<matchId>. Enrich future NFL events with that same
    // first-party endpoint so player props are fresh and never inherited from
    // a stale third-party snapshot.
    let deepMarketRequests=0,deepMarketSuccess=0,deepMarketFailures=0,deepMarkets=0,playerPropLikeMarkets=0;
    if(healthy&&sport==='american-football'){
      const now=Date.now();
      const nflRows=rows.filter(e=>{
        const comp=String(e?.competition?.name||e?.competition?.shortName||'').toLowerCase();
        const start=Date.parse(e?.startTime||'');
        return e?.id && /\bnfl\b/i.test(comp) && e?.isLive!==true && Number.isFinite(start) && start>now-5*60e3;
      });
      for(const e of nflRows){
        await sleep(1350);
        deepMarketRequests++;
        let detail=await page.evaluate(async id=>{
          try{
            const r=await fetch('/api/markets/'+encodeURIComponent(String(id)),{headers:{accept:'application/json'}});
            const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{}
            const data=body?.data;
            return {status:r.status,ok:r.ok,markets:Array.isArray(data)?data:[],error:body?.message||body?.error||null};
          }catch(err){return {status:null,ok:false,markets:[],error:String(err?.message||err)}}
        },e.id);
        if(detail.status===429){
          await sleep(5000);
          detail=await page.evaluate(async id=>{
            try{
              const r=await fetch('/api/markets/'+encodeURIComponent(String(id)),{headers:{accept:'application/json'}});
              const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{}
              return {status:r.status,ok:r.ok,markets:Array.isArray(body?.data)?body.data:[],error:body?.message||body?.error||null};
            }catch(err){return {status:null,ok:false,markets:[],error:String(err?.message||err)}}
          },e.id);
        }
        if(detail.ok&&detail.status===200&&detail.markets.length){
          deepMarketSuccess++;
          deepMarkets+=detail.markets.length;
          playerPropLikeMarkets+=detail.markets.filter(m=>/\bplayer\b|passing|rushing|receiving|receptions|touchdown|attempts|completions|interceptions/i.test(String(m?.name||''))).length;
          e.preferredMarkets=detail.markets;
          e.deepMarketsFetchedAt=new Date().toISOString();
          e.deepMarketsFresh=true;
        }else{
          deepMarketFailures++;
          e.deepMarketsFresh=false;
          e.deepMarketsError=detail.error||`HTTP ${detail.status}`;
        }
      }
      console.log('THUNDERPICK_NFL_DEEP',JSON.stringify({eligibleEvents:nflRows.length,deepMarketRequests,deepMarketSuccess,deepMarketFailures,deepMarkets,playerPropLikeMarkets}));
    }

    sports[sport]={
      ok:healthy,
      httpOk:healthy,
      status:result.status,
      fetchedAt,
      gameId:gid,
      eventCount:rows.length,
      retainedMarketCount:rows.reduce((n,e)=>n+(Array.isArray(e?.preferredMarkets)?e.preferredMarkets.length:0)+(e?.market?1:0),0),
      deepMarketRequests,
      deepMarketSuccess,
      deepMarketFailures,
      deepMarkets,
      playerPropLikeMarkets,
      hash:sha(rows),
      changedSincePrevious:null,
      coverageStatus:healthy?'fresh-first-party':'first-party-error',
      usedFallback:false,
      error:healthy?null:(result.error||`HTTP ${result.status}`),
      data:{data:rows},
    };
    console.log('THUNDERPICK_FIRSTPARTY',sport,JSON.stringify({status:result.status,ok:healthy,events:rows.length,bytes:result.bytes,preferredMarkets:sports[sport].retainedMarketCount,deepMarketSuccess,deepMarkets,playerPropLikeMarkets}));
    // Be respectful of Thunderpick's observed first-party rate limits.
    await sleep(1350);
  }
} finally {
  await browser.close();
}

const successfulSports=ORDER.filter(s=>sports[s]?.ok);
const failedSports=ORDER.filter(s=>!sports[s]?.ok);
const snapshot={
  generatedAt,
  source:'Thunderpick first-party /api/matches + /api/markets/<id> via unattended cloud browser',
  format:'first-party-browser-v2-deep-nfl',
  sports,
};
const meta={
  generatedAt,
  source:'Thunderpick first-party /api/matches + /api/markets/<id> via unattended cloud browser',
  format:'first-party-browser-v2-deep-nfl',
  pageStatus,finalUrl,title,bootstrapOk,bootstrapStatus,
  requestCountThisRun:ORDER.length+1+ORDER.reduce((n,s)=>n+(sports[s]?.deepMarketRequests||0),0),
  requestedSports:ORDER,
  successfulSports,failedSports,
  coverageAnomalies:failedSports.map(s=>({sport:s,status:sports[s]?.status??null,reason:sports[s]?.error||'first-party fetch failed'})),
  coverageComplete:failedSports.length===0,
  quotaExhausted:false,
  quotaResetMonth:null,
  totalEvents:ORDER.reduce((n,s)=>n+(sports[s]?.eventCount||0),0),
  totalRetainedMarkets:ORDER.reduce((n,s)=>n+(sports[s]?.retainedMarketCount||0),0),
  sports:Object.fromEntries(ORDER.map(s=>[s,{...sports[s],data:undefined}])),
};
await fs.mkdir('data',{recursive:true});
await fs.writeFile('data/owls-latest.json',JSON.stringify(snapshot));
await fs.writeFile('data/owls-meta.json',JSON.stringify(meta,null,2));
console.log('THUNDERPICK_FIRSTPARTY_COMPLETE',JSON.stringify({successfulSports,failedSports,totalEvents:meta.totalEvents,totalMarkets:meta.totalRetainedMarkets,bootstrapStatus,nflDeep:{requests:sports['american-football']?.deepMarketRequests||0,success:sports['american-football']?.deepMarketSuccess||0,markets:sports['american-football']?.deepMarkets||0,playerPropLikeMarkets:sports['american-football']?.playerPropLikeMarkets||0}}));
if(failedSports.length) process.exitCode=2;
