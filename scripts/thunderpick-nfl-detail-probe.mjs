import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const browser=await puppeteer.launch({
  headless:true,
  executablePath:chrome,
  args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled','--window-size=1440,1000'],
  defaultViewport:{width:1440,height:1000},
});
const out={generatedAt:new Date().toISOString(),source:'Thunderpick first-party NFL detail probe',bootstrap:null,nfl:null,detail:null};
try{
  const page=await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({'accept-language':'en-US,en;q=0.9'});
  await page.evaluateOnNewDocument(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>undefined});});
  const nav=await page.goto('https://thunderpick.io/en/sports',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>null);
  await sleep(7000);
  out.bootstrap={status:nav?.status()??null,url:page.url(),title:await page.title().catch(()=>null)};

  const nfl=await page.evaluate(async()=>{
    const r=await fetch('/api/matches',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({gameIds:[18]})});
    const text=await r.text(); let body=null; try{body=JSON.parse(text)}catch{}
    const rows=body?.data?.upcoming||body?.data?.matches||[];
    return {status:r.status,ok:r.ok,bytes:text.length,rows:Array.isArray(rows)?rows:[]};
  });
  const first=(nfl.rows||[]).find(x=>Number(x?.totalOpenMarkets||0)>20)||(nfl.rows||[])[0]||null;
  out.nfl={status:nfl.status,ok:nfl.ok,bytes:nfl.bytes,count:(nfl.rows||[]).length,selected:first?{id:first.id,name:first.name,startTime:first.startTime,totalOpenMarkets:first.totalOpenMarkets,keys:Object.keys(first)}:null};
  if(!first?.id) throw new Error('No NFL event id available');

  // One isolated detail request only, to avoid first-party rate limiting.
  await sleep(2500);
  const detail=await page.evaluate(async id=>{
    const u='/api/matches?matchesIds='+encodeURIComponent(String(id));
    const r=await fetch(u,{headers:{accept:'application/json'}});
    const text=await r.text(); let body=null; try{body=JSON.parse(text)}catch{}
    return {url:u,status:r.status,ok:r.ok,bytes:text.length,body};
  },first.id);
  const body=detail.body;
  const rows=body?.data?.matches||body?.data?.upcoming||body?.data||[];
  const arr=Array.isArray(rows)?rows:[];
  const match=arr[0]||null;
  const raw=JSON.stringify(match||body||{});
  const propWords=(raw.match(/passing|rushing|receiving|receptions|touchdown|attempts|completions|interceptions|player/gi)||[]).length;
  out.detail={url:detail.url,status:detail.status,ok:detail.ok,bytes:detail.bytes,topKeys:body&&typeof body==='object'?Object.keys(body):[],dataKeys:body?.data&&typeof body.data==='object'?Object.keys(body.data):[],rowCount:arr.length,matchKeys:match&&typeof match==='object'?Object.keys(match):[],marketArrayCounts:match&&typeof match==='object'?Object.fromEntries(Object.entries(match).filter(([k,v])=>Array.isArray(v)&&/market|bet|offer/i.test(k)).map(([k,v])=>[k,v.length])):{},propWordHits:propWords,sample:raw.slice(0,40000)};
} catch(e){out.error=String(e?.stack||e);} finally {await browser.close();}
await fs.mkdir('data',{recursive:true});
await fs.writeFile('data/thunderpick-nfl-detail-probe.json',JSON.stringify(out,null,2));
console.log('NFL_DETAIL_PROBE',JSON.stringify({nfl:out.nfl,detail:out.detail&&{url:out.detail.url,status:out.detail.status,ok:out.detail.ok,bytes:out.detail.bytes,rowCount:out.detail.rowCount,matchKeys:out.detail.matchKeys,marketArrayCounts:out.detail.marketArrayCounts,propWordHits:out.detail.propWordHits},error:out.error||null}));
