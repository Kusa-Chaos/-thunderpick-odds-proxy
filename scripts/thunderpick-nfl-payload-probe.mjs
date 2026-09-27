import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
const out={generatedAt:new Date().toISOString()};
try{
 const page=await browser.newPage();
 await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
 await page.goto('https://thunderpick.io/en/sports',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>null);
 await new Promise(r=>setTimeout(r,5000));
 out.data=await page.evaluate(async()=>{
   async function post(body){const r=await fetch('/api/matches',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const text=await r.text();let j=null;try{j=JSON.parse(text)}catch{};return {status:r.status,text,j};}
   const x=await post({gameIds:[18]});
   const rows=x.j?.data?.upcoming||[];
   const target=rows.find(m=>/Miami Dolphins/i.test(m.name||'')&&/Kansas City Chiefs/i.test(m.name||''))||rows[0]||null;
   let detail=null;
   if(target?.id){const r=await fetch('/api/matches?matchesIds='+target.id);const text=await r.text();let j=null;try{j=JSON.parse(text)}catch{};const ev=j?.data?.matches?.[0]||null;detail={status:r.status,bytes:text.length,hasReceptions:/receptions/i.test(text),hasPassing:/passing yards/i.test(text),hasRushing:/rushing yards/i.test(text),hasReceiving:/receiving yards/i.test(text),topKeys:ev?Object.keys(ev):[],rawPreview:text.slice(0,5000)};}
   const raw=target?JSON.stringify(target):'';
   return {status:x.status,eventCount:rows.length,target:target?{id:target.id,name:target.name,startTime:target.startTime,topKeys:Object.keys(target),preferredCount:Array.isArray(target.preferredMarkets)?target.preferredMarkets.length:null,preferredNames:(target.preferredMarkets||[]).map(m=>m.nickName||m.name).slice(0,120),hasReceptions:/receptions/i.test(raw),hasPassing:/passing yards/i.test(raw),hasRushing:/rushing yards/i.test(raw),hasReceiving:/receiving yards/i.test(raw),bytes:raw.length}:null,detail};
 });
} finally {await browser.close();}
fs.writeFileSync('data/thunderpick-nfl-payload-probe.json',JSON.stringify(out,null,2));
console.log('THUNDERPICK_NFL_PAYLOAD_PROBE',JSON.stringify(out));
