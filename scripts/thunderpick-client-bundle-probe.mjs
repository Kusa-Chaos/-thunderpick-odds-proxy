import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
const out={generatedAt:new Date().toISOString(),page:null,scripts:[],hits:[],docs:[]};
try{
 const page=await browser.newPage();
 await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
 await page.goto('https://thunderpick.io/404',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>null);
 await new Promise(r=>setTimeout(r,9000));
 out.page={url:page.url(),title:await page.title().catch(()=>null)};
 out.scripts=await page.$$eval('script[src]',els=>els.map(e=>e.src).filter(Boolean));
 out.hits=await page.evaluate(async(urls)=>{
   const results=[];
   const needles=['/api/markets','api/markets','marketIds','matchIds','matchesIds','totalOpenMarkets','preferredMarkets'];
   for(const u of urls.slice(0,120)){
     try{
       const r=await fetch(u); if(!r.ok)continue;
       const t=await r.text();
       const low=t.toLowerCase();
       const matched=needles.filter(n=>low.includes(n.toLowerCase()));
       if(!matched.length)continue;
       const snippets=[];
       for(const n of matched){
         let from=0,c=0;
         while(c<8){const i=low.indexOf(n.toLowerCase(),from);if(i<0)break;snippets.push({needle:n,index:i,text:t.slice(Math.max(0,i-700),Math.min(t.length,i+1400))});from=i+n.length;c++;}
       }
       results.push({url:u,bytes:t.length,matched,snippets});
     }catch{}
   }
   return results;
 },out.scripts);
 const docsPaths=['/swagger','/swagger/index.html','/swagger/v1/swagger.json','/swagger.json','/api-docs','/api/docs','/openapi.json','/api/openapi.json'];
 out.docs=await page.evaluate(async(paths)=>{const rows=[];for(const p of paths){try{const r=await fetch(p);const text=await r.text();rows.push({path:p,status:r.status,bytes:text.length,contentType:r.headers.get('content-type'),preview:text.slice(0,1000)});}catch(e){rows.push({path:p,error:String(e?.message||e)})}}return rows;},docsPaths);
} finally {await browser.close();}
fs.writeFileSync('data/thunderpick-client-bundle-probe.json',JSON.stringify(out,null,2));
console.log('THUNDERPICK_CLIENT_BUNDLE_PROBE',JSON.stringify({page:out.page,scriptCount:out.scripts.length,hitFiles:out.hits.map(x=>({url:x.url,bytes:x.bytes,matched:x.matched})),docs:out.docs.map(x=>({path:x.path,status:x.status,bytes:x.bytes}))}));
