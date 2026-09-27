import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome';
const browser=await puppeteer.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--window-size=1365,900'],defaultViewport:{width:1365,height:900}});
let out={generatedAt:new Date().toISOString(),chrome};
try{
 const page=await browser.newPage();
 await page.setExtraHTTPHeaders({'accept-language':'en-US,en;q=0.9'});
 await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
 const nav=await page.goto('https://thunderpick.io/en/esports/lol',{waitUntil:'domcontentloaded',timeout:90000}).catch(e=>null);
 await new Promise(r=>setTimeout(r,10000));
 out.pageStatus=nav?.status()??null;
 out.finalUrl=page.url();
 out.title=await page.title().catch(()=>null);
 out.bodyPreview=(await page.$eval('body',el=>el.innerText).catch(()=>'' )).slice(0,600);
 out.cookies=(await page.cookies()).map(c=>({name:c.name,domain:c.domain,expires:c.expires,httpOnly:c.httpOnly,secure:c.secure}));
 out.api=await page.evaluate(async()=>{
   try{
     const r=await fetch('/api/matches',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({gameIds:[3]})});
     const text=await r.text();
     let json=null;try{json=JSON.parse(text)}catch{}
     const rows=json?.data?.upcoming||json?.data?.matches||[];
     return {status:r.status,ok:r.ok,bytes:text.length,eventCount:Array.isArray(rows)?rows.length:null,sample:Array.isArray(rows)?rows.slice(0,2).map(m=>({id:m.id,name:m.name,gameId:m.gameId,market:m.market})):null,preview:text.slice(0,600)};
   }catch(e){return {error:String(e?.message||e)}}
 });
} finally {await browser.close();}
fs.writeFileSync('data/thunderpick-cloud-browser-probe.json',JSON.stringify(out,null,2));
console.log('THUNDERPICK_CLOUD_BROWSER_PROBE',JSON.stringify(out));
