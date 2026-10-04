import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT='data/roobet-direct-network-probe.json';
const target='https://roobet.com/sports/league-of-legends-110';
const keep=/api|sports|odds|bet|event|offering|kambi|abios|sportsbook|league|market/i;
const out={generatedAt:new Date().toISOString(),mode:'roobet-direct-shadow-v2',target,health:{connected:false,usable:false,state:'STARTING',errors:[]},requests:[],responses:[],jsonSamples:[],sportsbookBundleFindings:[],scripts:[],page:{url:null,title:null,textSample:null}};

function findingsFrom(text,url){
  const terms=/graphql|_api|sportsbook|sportsbetting|market|odds|event|offering|kambi|abios|league|fixture/ig;
  const found=[]; let m;
  while((m=terms.exec(text))&&found.length<250){
    const a=Math.max(0,m.index-180), b=Math.min(text.length,m.index+360);
    const s=text.slice(a,b).replace(/\s+/g,' ');
    if(!found.some(x=>x.context===s)) found.push({term:m[0],context:s});
  }
  const urls=[...new Set([
    ...(text.match(/https?:\/\/[^"'\x60\s)]+/g)||[]),
    ...(text.match(/\/_api\/[A-Za-z0-9_?=&/.,:{}\[\]-]+/g)||[])
  ])].slice(0,200);
  return {url,urls,findings:found};
}

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
  if(!keep.test(u)) return;
  const row={method:req.method(),type:req.resourceType(),url:u};
  if(/\/_api\/graphql/i.test(u)){
    const pd=req.postData();
    if(pd) row.postData=pd.slice(0,20000);
  }
  out.requests.push(row);
});
page.on('response',async res=>{
  const u=res.url();
  const ct=res.headers()['content-type']||'';
  if(keep.test(u)) out.responses.push({status:res.status(),url:u,contentType:ct});
  if(keep.test(u) && /application\/json|text\/json/i.test(ct) && out.jsonSamples.length<30){
    try{
      const txt=await res.text();
      out.jsonSamples.push({status:res.status(),url:u,body:txt.slice(0,8000)});
    }catch(e){}
  }
  if(/SportsbettingRoute|sportsbook/i.test(u) && /javascript/i.test(ct) && out.sportsbookBundleFindings.length<10){
    try{
      const txt=await res.text();
      out.sportsbookBundleFindings.push(findingsFrom(txt,u));
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
  out.health.usable=out.jsonSamples.some(x=>/odds|market|event|bet/i.test(x.body||''))||out.sportsbookBundleFindings.length>0;
  out.health.state=blocked?'BLOCKED_PUBLIC_PAGE':out.health.usable?'CONNECTED_PUBLIC_DATA':'PAGE_LOADED_NO_DATA';
  if(blocked) out.health.errors.push('Roobet public sportsbook page blocked or errored in GitHub runner region');
}catch(e){
  out.health.state='NAVIGATION_ERROR';
  out.health.errors.push(String(e?.message||e));
}
out.generatedAt=new Date().toISOString();
await fs.mkdir('data',{recursive:true});
await fs.writeFile(OUT,JSON.stringify(out,null,2));
await browser.close();
console.log('ROOBET_DIRECT_SHADOW',JSON.stringify({state:out.health.state,requestCount:out.requests.length,responseCount:out.responses.length,jsonSamples:out.jsonSamples.length,bundleFindings:out.sportsbookBundleFindings.length,graphqlPosts:out.requests.filter(x=>/graphql/i.test(x.url)&&x.postData).length,errors:out.health.errors}));
