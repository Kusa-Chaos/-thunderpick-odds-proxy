import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT='data/gamdom-betby-renderer-shadow.json';
const BRAND='2638368950207000580';
const RENDERERS=[
  'https://ui.invisiblesport.com/bt-renderer.min.js',
  'https://gamdom.sptpub.com/bt-renderer.min.js'
];
const out={generatedAt:new Date().toISOString(),mode:'gamdom-betby-renderer-shadow-v1',brandId:BRAND,attempts:[]};

for(const renderer of RENDERERS){
  const attempt={renderer,state:'STARTING',initialized:false,bodyText:null,requests:[],responses:[],websockets:[],errors:[]};
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({locale:'en-US'});
  const page=await context.newPage();

  page.on('request',req=>{
    const u=req.url();
    if(/invisiblesport|sptpub|betby|sports|odds|market|event|api|graphql|fixture/i.test(u))
      attempt.requests.push({method:req.method(),type:req.resourceType(),url:u,postData:req.postData()?.slice(0,8000)||null});
  });
  page.on('response',async res=>{
    const u=res.url();
    if(/invisiblesport|sptpub|betby|sports|odds|market|event|api|graphql|fixture/i.test(u))
      attempt.responses.push({status:res.status(),url:u,contentType:res.headers()['content-type']||''});
  });
  page.on('websocket',ws=>{
    const rec={url:ws.url(),sent:[],received:[]};
    attempt.websockets.push(rec);
    ws.on('framesent',e=>{if(rec.sent.length<20)rec.sent.push(String(e.payload).slice(0,5000));});
    ws.on('framereceived',e=>{if(rec.received.length<50)rec.received.push(String(e.payload).slice(0,5000));});
  });

  try{
    await page.setContent('<!doctype html><html><body><div id="betby"></div></body></html>');
    await page.addScriptTag({url:renderer});
    const has=await page.evaluate(()=>typeof window.BTRenderer==='function');
    if(!has) throw new Error('BTRenderer did not load');
    await page.evaluate(({BRAND})=>{
      window.__probe={initialized:false};
      const bt=new window.BTRenderer();
      window.__bt=bt;
      bt.initialize({
        brand_id:BRAND,
        token:null,
        themeName:'gamdom',
        lang:'en',
        url:'/',
        target:document.getElementById('betby'),
        stickyTop:0,
        betSlipOffsetTop:0,
        betSlipOffsetBottom:0,
        betSlipOffsetRight:0,
        betslipZIndex:100,
        onAppInitialized:()=>{window.__probe.initialized=true;},
        onTokenExpired:async()=>null,
        onLogin:()=>{},
        onRegister:()=>{},
        onRecharge:()=>{},
        onSessionRefresh:()=>{}
      });
    },{BRAND});
    await page.waitForTimeout(15000);
    attempt.initialized=await page.evaluate(()=>Boolean(window.__probe?.initialized)).catch(()=>false);
    attempt.bodyText=(await page.locator('body').innerText().catch(()=>'' )).slice(0,12000);
    const blocked=/access is forbidden|not available|unexpected error|location/i.test(attempt.bodyText||'');
    const hasData=attempt.requests.some(x=>/market|event|odds|fixture|api|graphql/i.test(x.url))||attempt.websockets.length>0;
    attempt.state=attempt.initialized?'INITIALIZED_GUEST':hasData?'PUBLIC_FEED_ACTIVITY':blocked?'BLOCKED_GUEST':'NO_INIT_NO_FEED';
  }catch(e){
    attempt.state='ERROR';
    attempt.errors.push(String(e?.message||e));
  }
  await browser.close();
  out.attempts.push(attempt);
}

out.generatedAt=new Date().toISOString();
await fs.mkdir('data',{recursive:true});
await fs.writeFile(OUT,JSON.stringify(out,null,2));
console.log('GAMDOM_BETBY_RENDERER',JSON.stringify(out.attempts.map(a=>({renderer:a.renderer,state:a.state,initialized:a.initialized,requestCount:a.requests.length,responseCount:a.responses.length,websockets:a.websockets.length,bodyText:(a.bodyText||'').slice(0,300),errors:a.errors}))));
