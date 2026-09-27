import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome';
const browser=await puppeteer.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--window-size=1440,1000'],defaultViewport:{width:1440,height:1000}});
const out={generatedAt:new Date().toISOString(),requests:[],responses:[],links:[]};
try{
  const page=await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
  page.on('request',req=>{const u=req.url();if(u.includes('thunderpick.io')&&/\/api\//.test(u))out.requests.push({method:req.method(),url:u,postData:(req.postData()||'').slice(0,1200)});});
  page.on('response',async res=>{const u=res.url();if(u.includes('thunderpick.io')&&/\/api\//.test(u)){let text='';try{text=(await res.text()).slice(0,2500)}catch{}out.responses.push({status:res.status(),url:u,preview:text});}});
  await page.goto('https://thunderpick.io/en/sports/american-football',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>null);
  await new Promise(r=>setTimeout(r,9000));
  out.finalUrl=page.url();out.title=await page.title().catch(()=>null);
  out.links=await page.evaluate(()=>[...document.querySelectorAll('a[href]')].map(a=>({text:(a.innerText||'').trim().replace(/\s+/g,' ').slice(0,250),href:a.href})).filter(x=>/dolphins|chiefs|jaguars|patriots|nfl/i.test(x.text+' '+x.href)).slice(0,100));
  let target=out.links.find(x=>/dolphins/i.test(x.text)&&/chiefs/i.test(x.text));
  if(!target)target=out.links.find(x=>/american-football/i.test(x.href)&&/match|event/i.test(x.href));
  out.target=target||null;
  if(target?.href){
    await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>null);
    await new Promise(r=>setTimeout(r,9000));
    out.eventFinalUrl=page.url();out.eventTitle=await page.title().catch(()=>null);
    out.eventText=(await page.$eval('body',el=>el.innerText).catch(()=>'')).slice(0,3000);
  }
  out.uniqueApiUrls=[...new Set(out.requests.map(x=>x.url))];
} finally {await browser.close();}
fs.writeFileSync('data/thunderpick-network-probe.json',JSON.stringify(out,null,2));
console.log('THUNDERPICK_NETWORK_PROBE',JSON.stringify({finalUrl:out.finalUrl,target:out.target,eventFinalUrl:out.eventFinalUrl,apiUrls:out.uniqueApiUrls,requests:out.requests.length,responses:out.responses.length}));
