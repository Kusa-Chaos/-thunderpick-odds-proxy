import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--window-size=1440,1400'],defaultViewport:{width:1440,height:1400}});
const out={generatedAt:new Date().toISOString(),before:[],after:[],click:null};
try{
 const page=await browser.newPage();
 await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
 let phase='before';
 page.on('request',req=>{const u=req.url();if(u.includes('thunderpick.io')&&/\/api\//.test(u)){(phase==='before'?out.before:out.after).push({kind:'request',method:req.method(),url:u,postData:(req.postData()||'').slice(0,1200)});}});
 page.on('response',async res=>{const u=res.url();if(u.includes('thunderpick.io')&&/\/api\//.test(u)){let text='';try{text=(await res.text()).slice(0,6000)}catch{};(phase==='before'?out.before:out.after).push({kind:'response',status:res.status(),url:u,preview:text});}});
 await page.goto('https://thunderpick.io/en/sports/american-football',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>null);
 await new Promise(r=>setTimeout(r,9000));
 out.pageUrl=page.url();out.title=await page.title().catch(()=>null);
 out.bodyHasTarget=await page.evaluate(()=>document.body.innerText.includes('Miami Dolphins')&&document.body.innerText.includes('Kansas City Chiefs'));
 phase='after';
 out.click=await page.evaluate(()=>{
   const all=[...document.querySelectorAll('body *')];
   const el=all.find(e=>{const t=(e.innerText||'').trim();return t.includes('Miami Dolphins')&&t.includes('Kansas City Chiefs')&&t.length<500;});
   if(!el)return {found:false};
   let c=el; for(let i=0;i<8&&c;i++,c=c.parentElement){const tag=c.tagName;const role=c.getAttribute?.('role');if(tag==='A'||tag==='BUTTON'||role==='button'||c.onclick||getComputedStyle(c).cursor==='pointer'){c.click();return {found:true,clickedTag:tag,role,text:(c.innerText||'').slice(0,500),href:c.href||null};}}
   el.click();return {found:true,clickedTag:el.tagName,text:(el.innerText||'').slice(0,500),href:el.href||null,fallback:true};
 });
 await new Promise(r=>setTimeout(r,10000));
 out.afterUrl=page.url();out.afterTitle=await page.title().catch(()=>null);out.afterText=(await page.$eval('body',e=>e.innerText).catch(()=>'')).slice(0,4000);
 out.afterApiUrls=[...new Set(out.after.filter(x=>x.url).map(x=>x.url))];
} finally {await browser.close();}
fs.writeFileSync('data/thunderpick-click-network-probe.json',JSON.stringify(out,null,2));
console.log('THUNDERPICK_CLICK_NETWORK_PROBE',JSON.stringify({pageUrl:out.pageUrl,bodyHasTarget:out.bodyHasTarget,click:out.click,afterUrl:out.afterUrl,afterApiUrls:out.afterApiUrls}));
