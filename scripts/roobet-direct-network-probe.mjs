import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT='data/roobet-direct-network-probe.json';
const target='https://roobet.com/sports/league-of-legends-110';
const keep=/api|sports|odds|bet|event|offering|kambi|abios|sportsbook|league|market/i;
const out={generatedAt:new Date().toISOString(),mode:'roobet-direct-shadow-v1',target,health:{connected:false,usable:false,state:'STARTING',errors:[]},requests:[],responses:[],jsonSamples:[],scripts:[],page:{url:null,title:null,textSample:null}};

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'en-US'});
const page=await context.newPage();
await page.route('**/*', async route=>{
  const t=route.request().resourceType();
  if(['image','font','media'].includes(t)) return route.abort();
  return route.continue();
});
page.on('request',req=>{
  const u=req.url();
  if(keep.test(u)) out.requests.push({method:req.method(),type:req.resourceType(),url:u});
});
page.on('response',async res=>{
  const u=res.url();
  if(!keep.test(u)) return;
  const ct=res.headers()['content-type']||'';
  out.responses.push({status:res.status(),url:u,contentType:ct});
  if(/application\/json|text\/json/i.test(ct) && out.jsonSamples.length<20){
    try{
      const txt=await res.text();
      out.jsonSamples.push({status:res.status(),url:u,body:txt.slice(0,5000)});
    }catch(e){}
  }
});
try{
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForTimeout(12000);
  out.page.url=page.url();
  out.page.title=await page.title().catch(()=>null);
  out.page.textSample=(await page.locator('body').innerText().catch(()=>'' )).slice(0,8000);
  out.scripts=await page.locator('script[src]').evaluateAll(els=>els.map(e=>e.src)).catch(()=>[]);
  const blocked=/unexpected error|access is forbidden|regret any inconvenience|not available in your location/i.test(out.page.textSample||'');
  out.health.connected=!blocked;
  out.health.usable=out.jsonSamples.some(x=>/odds|market|event|bet/i.test(x.body||''));
  out.health.state=blocked?'BLOCKED_PUBLIC_PAGE':out.health.usable?'CONNECTED_PUBLIC_JSON':'PAGE_LOADED_NO_JSON';
  if(blocked) out.health.errors.push('Roobet public sportsbook page blocked or errored in GitHub runner region');
}catch(e){
  out.health.state='NAVIGATION_ERROR';
  out.health.errors.push(String(e?.message||e));
}
out.generatedAt=new Date().toISOString();
await fs.mkdir('data',{recursive:true});
await fs.writeFile(OUT,JSON.stringify(out,null,2));
await browser.close();
console.log('ROOBET_DIRECT_SHADOW',JSON.stringify({state:out.health.state,requestCount:out.requests.length,responseCount:out.responses.length,jsonSamples:out.jsonSamples.length,scripts:out.scripts.length,errors:out.health.errors}));
