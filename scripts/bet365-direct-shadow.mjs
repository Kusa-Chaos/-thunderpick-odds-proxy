import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT='data/bet365-direct-shadow.json';
const targets=[
  'https://www.nj.bet365.com/',
  'https://www.nj.bet365.com/#/AC/B151/C1/D50/E2/F163/'
];
const sig=/bet365|sports|sporting|api|graphql|event|market|fixture|coupon|prematch|inplay|esport|league|odds|stream|socket|push/i;
const out={
  generatedAt:new Date().toISOString(),
  mode:'bet365-direct-shadow-v1',
  pages:[],
  requests:[],
  responses:[],
  websockets:[],
  jsonSamples:[],
  scripts:[],
  providerSignals:[],
  health:{state:'STARTING',errors:[]}
};

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'en-US'});
const page=await context.newPage();

page.on('request',req=>{
  const u=req.url();
  if(sig.test(u)) out.requests.push({
    method:req.method(),
    type:req.resourceType(),
    url:u,
    postData:req.postData()?.slice(0,12000)||null
  });
});
page.on('response',async res=>{
  const u=res.url();
  const ct=res.headers()['content-type']||'';
  if(sig.test(u)) out.responses.push({status:res.status(),url:u,contentType:ct});
  if(/application\/json|text\/json/i.test(ct) && out.jsonSamples.length<60){
    try{
      const txt=await res.text();
      if(sig.test(u)||sig.test(txt)) out.jsonSamples.push({status:res.status(),url:u,body:txt.slice(0,12000)});
    }catch{}
  }
});
page.on('websocket',ws=>{
  const rec={url:ws.url(),sent:[],received:[]};
  out.websockets.push(rec);
  ws.on('framesent',e=>{if(rec.sent.length<20) rec.sent.push(String(e.payload).slice(0,6000));});
  ws.on('framereceived',e=>{if(rec.received.length<50) rec.received.push(String(e.payload).slice(0,6000));});
});

for(const target of targets){
  try{
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(12000);
    const body=(await page.locator('body').innerText().catch(()=>'' )).slice(0,20000);
    const scripts=await page.locator('script[src]').evaluateAll(els=>els.map(e=>e.src)).catch(()=>[]);
    out.pages.push({
      requested:target,
      finalUrl:page.url(),
      title:await page.title().catch(()=>null),
      bodyText:body,
      scripts
    });
    for(const s of scripts) if(!out.scripts.includes(s)) out.scripts.push(s);
  }catch(e){
    out.pages.push({requested:target,error:String(e?.message||e)});
    out.health.errors.push(String(e?.message||e));
  }
}

// Inspect loaded public JS for endpoint/provider strings.
for(const s of out.scripts.slice(0,80)){
  try{
    const r=await context.request.get(s,{timeout:20000});
    const ct=r.headers()['content-type']||'';
    if(!/javascript|text\//i.test(ct)) continue;
    const txt=await r.text();
    const names=['websocket','sockjs','signalr','sportsbook','esports','coupon','fixture','event','market','odds','prematch','inplay','push','api','graphql'];
    const hits=[];
    for(const name of names){
      let i=txt.toLowerCase().indexOf(name.toLowerCase()),n=0;
      while(i>=0&&n<8){
        hits.push({term:name,context:txt.slice(Math.max(0,i-220),Math.min(txt.length,i+520)).replace(/\s+/g,' ')});
        i=txt.toLowerCase().indexOf(name.toLowerCase(),i+name.length);
        n++;
      }
    }
    const urls=[...new Set(txt.match(/https?:\/\/[^"'\x60\s)]+/g)||[])].filter(u=>sig.test(u)).slice(0,120);
    if(hits.length||urls.length) out.providerSignals.push({script:s,status:r.status(),hits:hits.slice(0,150),urls});
  }catch{}
}

const realEsportsVisible=out.pages.some(p=>/league of legends|dota|counter[- ]?strike|valorant|esports/i.test(p.bodyText||''));
const hasFeed=out.jsonSamples.length>0||out.websockets.length>0||out.providerSignals.length>0;
out.health.state=hasFeed?'PUBLIC_FEED_SIGNALS_FOUND':realEsportsVisible?'ESPORTS_VISIBLE_NO_FEED':'NO_FEED_YET';
out.generatedAt=new Date().toISOString();
await fs.mkdir('data',{recursive:true});
await fs.writeFile(OUT,JSON.stringify(out,null,2));
await browser.close();

console.log('BET365_DIRECT_SHADOW',JSON.stringify({
  state:out.health.state,
  pageCount:out.pages.length,
  requestCount:out.requests.length,
  responseCount:out.responses.length,
  websocketCount:out.websockets.length,
  jsonSamples:out.jsonSamples.length,
  scripts:out.scripts.length,
  providerSignals:out.providerSignals.length,
  finals:out.pages.map(p=>p.finalUrl).filter(Boolean),
  snippets:out.pages.map(p=>(p.bodyText||'').slice(0,500)),
  errors:out.health.errors
}));
