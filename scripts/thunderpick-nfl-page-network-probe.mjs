import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const probe=JSON.parse(await fs.readFile('data/thunderpick-nfl-detail-probe.json','utf8'));
const id=probe?.nfl?.selected?.id;
if(!id) throw new Error('No selected NFL id from detail probe');
const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const browser=await puppeteer.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled','--window-size=1440,1000'],defaultViewport:{width:1440,height:1000}});
const out={generatedAt:new Date().toISOString(),eventId:id,targetUrl:`https://thunderpick.io/match/${id}`,responses:[]};
try{
  const page=await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({'accept-language':'en-US,en;q=0.9'});
  await page.evaluateOnNewDocument(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>undefined});});
  page.on('response',async r=>{
    const u=r.url();
    if(!u.includes('thunderpick.io/api/')) return;
    try{
      const headers=r.headers();
      const ct=headers['content-type']||'';
      let text='';
      if(/json|text/i.test(ct)) text=await r.text().catch(()=> '');
      let body=null; try{body=JSON.parse(text)}catch{}
      const raw=body?JSON.stringify(body):text;
      out.responses.push({url:u,method:r.request().method(),status:r.status(),contentType:ct,bytes:raw?.length||0,topKeys:body&&typeof body==='object'&&!Array.isArray(body)?Object.keys(body):[],sample:(raw||'').slice(0,12000)});
    }catch{}
  });
  const nav=await page.goto(out.targetUrl,{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>null);
  out.navigation={status:nav?.status()??null,finalUrl:page.url(),title:await page.title().catch(()=>null)};
  await sleep(15000);
  out.bodyText=(await page.evaluate(()=>document.body?.innerText||'').catch(()=>'' )).slice(0,20000);
  out.apiSummary=out.responses.map(x=>({url:x.url,method:x.method,status:x.status,bytes:x.bytes,topKeys:x.topKeys}));
} finally {await browser.close();}
await fs.writeFile('data/thunderpick-nfl-page-network-probe.json',JSON.stringify(out,null,2));
console.log('NFL_PAGE_NETWORK',JSON.stringify({eventId:id,navigation:out.navigation,apiSummary:out.apiSummary,bodyHasProps:/passing|rushing|receiving|receptions|touchdown|attempts|completions|interceptions/i.test(out.bodyText||'')}));
