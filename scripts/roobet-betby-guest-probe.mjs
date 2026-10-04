import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT='data/roobet-betby-guest-probe.json';
const BRAND='2186449803775455232';
const RENDERER='https://ui.invisiblesport.com/bt-renderer.min.js';
const out={generatedAt:new Date().toISOString(),mode:'roobet-betby-guest-v1',brandId:BRAND,renderer:RENDERER,state:'STARTING',initialized:false,requests:[],responses:[],websockets:[],bodyText:null,errors:[]};

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'en-US'});
const page=await context.newPage();

page.on('request',req=>{
  const u=req.url();
  if(/sptpub|betby|invisiblesport|sports|odds|market|event|api/i.test(u))
    out.requests.push({method:req.method(),type:req.resourceType(),url:u,postData:req.postData()?.slice(0,12000)||null});
});
page.on('response',async res=>{
  const u=res.url();
  if(/sptpub|betby|invisiblesport|sports|odds|market|event|api/i.test(u))
    out.responses.push({status:res.status(),url:u,contentType:res.headers()['content-type']||''});
});
page.on('websocket',ws=>{
  const rec={url:ws.url(),framesSent:[],framesReceived:[]};
  out.websockets.push(rec);
  ws.on('framesent',e=>{if(rec.framesSent.length<20)rec.framesSent.push(String(e.payload).slice(0,5000));});
  ws.on('framereceived',e=>{if(rec.framesReceived.length<40)rec.framesReceived.push(String(e.payload).slice(0,5000));});
});

await page.setContent('<!doctype html><html><head></head><body><div id="betby"></div></body></html>',{waitUntil:'domcontentloaded'});
try{
  await page.addScriptTag({url:RENDERER});
  const has=await page.evaluate(()=>typeof window.BTRenderer==='function');
  if(!has) throw new Error('BTRenderer did not load');
  await page.evaluate(({BRAND})=>{
    window.__roobetGuest={initialized:false,error:null};
    const bt=new window.BTRenderer();
    window.__bt=bt;
    bt.initialize({
      brand_id:BRAND,
      token:null,
      themeName:'roobet-tile',
      lang:'en',
      url:'/',
      target:document.getElementById('betby'),
      stickyTop:0,
      betSlipOffsetTop:0,
      betSlipOffsetBottom:0,
      betSlipOffsetRight:0,
      betslipZIndex:100,
      onAppInitialized:()=>{window.__roobetGuest.initialized=true;},
      onTokenExpired:async()=>null,
      onLogin:()=>{},
      onRegister:()=>{},
      onRecharge:()=>{},
      onSessionRefresh:()=>{}
    });
  },{BRAND});
  await page.waitForTimeout(15000);
  out.initialized=await page.evaluate(()=>Boolean(window.__roobetGuest?.initialized)).catch(()=>false);
  out.bodyText=(await page.locator('body').innerText().catch(()=>'' )).slice(0,12000);
  const blocked=/access is forbidden|not available|unexpected error|location/i.test(out.bodyText||'');
  out.state=out.initialized?'INITIALIZED_GUEST':blocked?'BLOCKED_GUEST':'NO_INIT';
}catch(e){
  out.state='ERROR';
  out.errors.push(String(e?.message||e));
}
out.generatedAt=new Date().toISOString();
await fs.mkdir('data',{recursive:true});
await fs.writeFile(OUT,JSON.stringify(out,null,2));
await browser.close();
console.log('ROOBET_BETBY_GUEST',JSON.stringify({state:out.state,initialized:out.initialized,requestCount:out.requests.length,responseCount:out.responses.length,websocketCount:out.websockets.length,bodyText:(out.bodyText||'').slice(0,500),errors:out.errors}));
