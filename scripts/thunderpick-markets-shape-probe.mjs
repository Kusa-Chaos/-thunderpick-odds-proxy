import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const eventId=2664505;
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
const out={generatedAt:new Date().toISOString(),eventId,results:[]};
try{
 const page=await browser.newPage();
 await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
 await page.goto('https://thunderpick.io/404',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>null);
 await new Promise(r=>setTimeout(r,6000));
 const specs=[
  {m:'GET',p:`/api/markets`},
  {m:'GET',p:`/api/markets?id=${eventId}`},
  {m:'GET',p:`/api/markets?ids=${eventId}`},
  {m:'GET',p:`/api/markets?eventIds=${eventId}`},
  {m:'GET',p:`/api/markets?eventsIds=${eventId}`},
  {m:'GET',p:`/api/markets?eventIds[]=${eventId}`},
  {m:'GET',p:`/api/markets?matchIds[]=${eventId}`},
  {m:'GET',p:`/api/markets?matchesIds[]=${eventId}`},
  {m:'GET',p:`/api/markets?bettingEventId=${eventId}`},
  {m:'GET',p:`/api/markets?bettingEventIds=${eventId}`},
  {m:'GET',p:`/api/markets?fixtureId=${eventId}`},
  {m:'GET',p:`/api/markets?fixtureIds=${eventId}`},
  {m:'GET',p:`/api/markets?event=${eventId}`},
  {m:'GET',p:`/api/markets?match=${eventId}`},
  {m:'POST',p:'/api/markets',b:{}},
  {m:'POST',p:'/api/markets',b:{id:eventId}},
  {m:'POST',p:'/api/markets',b:{ids:[eventId]}},
  {m:'POST',p:'/api/markets',b:{eventId}},
  {m:'POST',p:'/api/markets',b:{eventIds:[eventId]}},
  {m:'POST',p:'/api/markets',b:{matchId:eventId}},
  {m:'POST',p:'/api/markets',b:{matchIds:[eventId]}},
  {m:'POST',p:'/api/markets',b:{matchesIds:[eventId]}},
  {m:'POST',p:'/api/markets',b:{bettingEventId:eventId}},
  {m:'POST',p:'/api/markets',b:{bettingEventIds:[eventId]}},
  {m:'POST',p:'/api/markets',b:{fixtureId:eventId}},
  {m:'POST',p:'/api/markets',b:{fixtureIds:[eventId]}},
  {m:'POST',p:'/api/markets',b:{matchIds:[eventId],isLive:false}},
  {m:'POST',p:'/api/markets',b:{eventIds:[eventId],isLive:false}},
 ];
 out.results=await page.evaluate(async(specs)=>{
   const rows=[];
   for(const s of specs){
    try{
     const opts={method:s.m,headers:{accept:'application/json'}};
     if(s.b!==undefined){opts.headers['content-type']='application/json';opts.body=JSON.stringify(s.b);}
     const r=await fetch(s.p,opts);const text=await r.text();let j=null;try{j=JSON.parse(text)}catch{}
     const data=j?.data;const count=Array.isArray(data)?data.length:Array.isArray(data?.markets)?data.markets.length:null;
     const raw=text.toLowerCase();
     rows.push({method:s.m,path:s.p,body:s.b??null,status:r.status,ok:r.ok,bytes:text.length,count,hasReceptions:/receptions/.test(raw),hasPassing:/passing yards/.test(raw),hasRushing:/rushing yards/.test(raw),hasReceiving:/receiving yards/.test(raw),preview:text.slice(0,1000)});
    }catch(e){rows.push({method:s.m,path:s.p,body:s.b??null,error:String(e?.message||e)})}
   }
   return rows;
 },specs);
} finally {await browser.close();}
fs.writeFileSync('data/thunderpick-markets-shape-probe.json',JSON.stringify(out,null,2));
console.log('THUNDERPICK_MARKETS_SHAPE_PROBE',JSON.stringify(out.results.map(x=>({method:x.method,path:x.path,body:x.body,status:x.status,bytes:x.bytes,count:x.count,rec:x.hasReceptions,pass:x.hasPassing}))));
