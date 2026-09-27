import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome';
const browser=await puppeteer.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--window-size=1365,900'],defaultViewport:{width:1365,height:900}});
let out={generatedAt:new Date().toISOString(),chrome};
try{
 const page=await browser.newPage();
 await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
 await page.goto('https://thunderpick.io/en/sports',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>null);
 await new Promise(r=>setTimeout(r,6000));
 out.finalUrl=page.url();
 out.title=await page.title().catch(()=>null);
 out.probe=await page.evaluate(async()=>{
   const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   async function post(body){
     const r=await fetch('/api/matches',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
     const text=await r.text();let j=null;try{j=JSON.parse(text)}catch{}
     const rows=j?.data?.upcoming||j?.data?.matches||[];
     return {status:r.status,ok:r.ok,rows:Array.isArray(rows)?rows:[],bytes:text.length};
   }
   const empty=await post({});
   const emptyArray=await post({gameIds:[]});
   const ids=[];
   for(let gid=1;gid<=50;gid++){
     const x=await post({gameIds:[gid]});
     if(x.rows.length){
       ids.push({gameId:gid,count:x.rows.length,sample:x.rows.slice(0,4).map(m=>({id:m.id,name:m.name,gameId:m.gameId,competition:m.competition?.name||null,market:m.market?.name||null}))});
     }
     await sleep(80);
   }
   const all=[...empty.rows,...emptyArray.rows];
   const first=all[0]||ids.flatMap(x=>x.sample)[0]||null;
   let detail=null;
   if(first?.id){
     const r=await fetch('/api/matches?matchesIds='+encodeURIComponent(first.id));
     const text=await r.text();let j=null;try{j=JSON.parse(text)}catch{}
     const rows=j?.data?.matches||j?.data?.upcoming||[];
     const ev=Array.isArray(rows)?rows[0]:null;
     detail={status:r.status,ok:r.ok,bytes:text.length,eventId:first.id,eventName:ev?.name||first.name||null,topKeys:ev?Object.keys(ev):[],marketCount:Array.isArray(ev?.markets)?ev.markets.length:null,preferredMarketCount:Array.isArray(ev?.preferredMarkets)?ev.preferredMarkets.length:null,marketNames:(ev?.markets||[]).slice(0,30).map(m=>m.name)};
   }
   return {empty:{status:empty.status,count:empty.rows.length,gameIds:[...new Set(empty.rows.map(x=>x.gameId))]},emptyArray:{status:emptyArray.status,count:emptyArray.rows.length,gameIds:[...new Set(emptyArray.rows.map(x=>x.gameId))]},ids,detail};
 });
} finally {await browser.close();}
fs.writeFileSync('data/thunderpick-gameid-probe.json',JSON.stringify(out,null,2));
console.log('THUNDERPICK_GAMEID_PROBE',JSON.stringify(out));
