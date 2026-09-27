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

  // This route consistently hydrates the sportsbook shell and establishes the
  // Cloudflare browser cookie even when the final app route resolves to /404.
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
    sports[sport]={
      ok:healthy,
      httpOk:healthy,
      status:result.status,
      fetchedAt,
      gameId:gid,
      eventCount:rows.length,
      retainedMarketCount:rows.reduce((n,e)=>n+(Array.isArray(e?.preferredMarkets)?e.preferredMarkets.length:0)+(e?.market?1:0),0),
      hash:sha(rows),
      changedSincePrevious:null,
      coverageStatus:healthy?'fresh-first-party':'first-party-error',
      usedFallback:false,
      error:healthy?null:(result.error||`HTTP ${result.status}`),
      data:{data:rows},
    };
    console.log('THUNDERPICK_FIRSTPARTY',sport,JSON.stringify({status:result.status,ok:healthy,events:rows.length,bytes:result.bytes,preferredMarkets:sports[sport].retainedMarketCount}));
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
  source:'Thunderpick first-party /api/matches via unattended cloud browser',
  format:'first-party-browser-v1',
  sports,
};
const meta={
  generatedAt,
  source:'Thunderpick first-party /api/matches via unattended cloud browser',
  format:'first-party-browser-v1',
  pageStatus,finalUrl,title,bootstrapOk,bootstrapStatus,
  requestCountThisRun:ORDER.length+1,
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
console.log('THUNDERPICK_FIRSTPARTY_COMPLETE',JSON.stringify({successfulSports,failedSports,totalEvents:meta.totalEvents,totalMarkets:meta.totalRetainedMarkets,bootstrapStatus}));
if(failedSports.length) process.exitCode=2;
