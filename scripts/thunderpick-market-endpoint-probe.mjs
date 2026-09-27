import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const eventId=2664505;
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
const out={generatedAt:new Date().toISOString(),eventId,results:[]};
try{
 const page=await browser.newPage();
 await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
 await page.goto('https://thunderpick.io/404',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>null);
 await new Promise(r=>setTimeout(r,8000));
 const paths=[
  `/api/matches/${eventId}`,
  `/api/matches/${eventId}/markets`,
  `/api/matches/${eventId}/market`,
  `/api/matches/${eventId}/betting-events`,
  `/api/markets?matchId=${eventId}`,
  `/api/markets?eventId=${eventId}`,
  `/api/markets?matchIds=${eventId}`,
  `/api/markets?matchesIds=${eventId}`,
  `/api/match-markets?matchId=${eventId}`,
  `/api/betting-events?matchId=${eventId}`,
  `/api/betting-events/${eventId}`,
  `/api/betting-events/${eventId}/markets`,
  `/api/v2/matches/${eventId}`,
  `/api/v2/matches/${eventId}/markets`,
  `/api/v2/markets?matchId=${eventId}`,
  `/api/v2/markets?eventId=${eventId}`,
  `/api/events/${eventId}/markets`,
  `/api/events/${eventId}`,
  `/api/sportsbook/events/${eventId}/markets`,
  `/api/sportsbook/matches/${eventId}/markets`
 ];
 out.page={url:page.url(),title:await page.title().catch(()=>null)};
 out.results=await page.evaluate(async(paths)=>{
  const rows=[];
  for(const path of paths){
   try{
    const r=await fetch(path,{headers:{accept:'application/json'}});
    const text=await r.text();
    let j=null;try{j=JSON.parse(text)}catch{}
    const raw=text.toLowerCase();
    rows.push({path,status:r.status,ok:r.ok,contentType:r.headers.get('content-type'),bytes:text.length,hasMarkets:/\"markets\"/.test(raw),hasReceptions:/receptions/.test(raw),hasPassing:/passing yards/.test(raw),hasRushing:/rushing yards/.test(raw),hasReceiving:/receiving yards/.test(raw),topKeys:j&&typeof j==='object'?Object.keys(j):[],preview:text.slice(0,800)});
   }catch(e){rows.push({path,error:String(e?.message||e)})}
  }
  return rows;
 },paths);
} finally {await browser.close();}
fs.writeFileSync('data/thunderpick-market-endpoint-probe.json',JSON.stringify(out,null,2));
console.log('THUNDERPICK_MARKET_ENDPOINT_PROBE',JSON.stringify(out.results.map(x=>({path:x.path,status:x.status,bytes:x.bytes,markets:x.hasMarkets,receptions:x.hasReceptions,passing:x.hasPassing}))));
