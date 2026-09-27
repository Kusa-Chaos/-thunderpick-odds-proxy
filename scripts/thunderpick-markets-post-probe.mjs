import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const eventId=2664505;
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
const out={generatedAt:new Date().toISOString(),eventId,results:[]};
try{
 const page=await browser.newPage();
 await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
 await page.goto('https://thunderpick.io/404',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>null);
 await new Promise(r=>setTimeout(r,7000));
 const bodies=[
  {id:eventId},
  {ids:[eventId]},
  {eventId},
  {eventIds:[eventId]},
  {matchId:eventId},
  {matchIds:[eventId]},
  {matchesIds:[eventId]},
  {eventIds:[eventId],isLive:false},
  {matchIds:[eventId],isLive:false},
  {ids:[eventId],isLive:false}
 ];
 out.results=await page.evaluate(async(bodies)=>{
   const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   const rows=[];
   for(const body of bodies){
    const r=await fetch('/api/markets',{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify(body)});
    const text=await r.text();let j=null;try{j=JSON.parse(text)}catch{}
    const data=j?.data;const count=Array.isArray(data)?data.length:Array.isArray(data?.markets)?data.markets.length:null;
    const raw=text.toLowerCase();
    rows.push({body,status:r.status,ok:r.ok,bytes:text.length,count,hasReceptions:/receptions/.test(raw),hasPassing:/passing yards/.test(raw),hasRushing:/rushing yards/.test(raw),hasReceiving:/receiving yards/.test(raw),preview:text.slice(0,1500)});
    await sleep(1500);
   }
   return rows;
 },bodies);
} finally {await browser.close();}
fs.writeFileSync('data/thunderpick-markets-post-probe.json',JSON.stringify(out,null,2));
console.log('THUNDERPICK_MARKETS_POST_PROBE',JSON.stringify(out.results.map(x=>({body:x.body,status:x.status,bytes:x.bytes,count:x.count,rec:x.hasReceptions,pass:x.hasPassing}))));
