import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT='data/gamdom-direct-shadow.json';
const targets=[
  'https://gamdom.com/sports',
  'https://gamdom.com/sports/esports/league-of-legends',
  'https://gamdom.com/sports/esports/dota-2'
];
const sig=/kambi|betby|betradar|sportradar|sportsbook|sportsbet|sportsradar|oddin|everymatrix|sbtech|openbet|altenar|digitain|gr8|api|graphql|odds|market|fixture|event|league|esport/i;
const out={
  generatedAt:new Date().toISOString(),
  mode:'gamdom-direct-shadow-v1',
  health:{connected:false,usable:false,state:'STARTING',errors:[]},
  pages:[],
  requests:[],
  responses:[],
  jsonSamples:[],
  scripts:[],
  providerSignals:[]
};

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'en-US'});
const page=await context.newPage();

page.on('request',req=>{
  const u=req.url();
  if(sig.test(u)){
    out.requests.push({
      method:req.method(),
      type:req.resourceType(),
      url:u,
      postData:req.postData()?.slice(0,12000)||null
    });
  }
});
page.on('response',async res=>{
  const u=res.url();
  const ct=res.headers()['content-type']||'';
  if(sig.test(u)) out.responses.push({status:res.status(),url:u,contentType:ct});
  if(/application\/json|text\/json/i.test(ct) && out.jsonSamples.length<40){
    try{
      const txt=await res.text();
      if(sig.test(u)||sig.test(txt)){
        out.jsonSamples.push({status:res.status(),url:u,body:txt.slice(0,10000)});
      }
    }catch{}
  }
});

for(const target of targets){
  try{
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(5000);
    const body=(await page.locator('body').innerText().catch(()=>'' )).slice(0,12000);
    const scripts=await page.locator('script[src]').evaluateAll(els=>els.map(e=>e.src)).catch(()=>[]);
    out.pages.push({
      requested:target,
      finalUrl:page.url(),
      title:await page.title().catch(()=>null),
      bodyText:body,
      scripts
    });
    for(const s of scripts){
      if(!out.scripts.includes(s)) out.scripts.push(s);
    }
  }catch(e){
    out.pages.push({requested:target,error:String(e?.message||e)});
    out.health.errors.push(String(e?.message||e));
  }
}

// Inspect public frontend JS for provider / endpoint signatures.
for(const s of out.scripts.slice(0,80)){
  try{
    const r=await context.request.get(s,{timeout:20000});
    const ct=r.headers()['content-type']||'';
    if(!/javascript|text\//i.test(ct)) continue;
    const txt=await r.text();
    const names=['kambi','betby','betradar','sportradar','oddin','everymatrix','sbtech','openbet','altenar','digitain','gr8','sportsbook','graphql','/api/','odds','markets'];
    const hits=[];
    for(const name of names){
      let i=txt.toLowerCase().indexOf(name.toLowerCase());
      let n=0;
      while(i>=0&&n<8){
        hits.push({term:name,context:txt.slice(Math.max(0,i-220),Math.min(txt.length,i+500)).replace(/\s+/g,' ')});
        i=txt.toLowerCase().indexOf(name.toLowerCase(),i+name.length);
        n++;
      }
    }
    const urls=[...new Set(txt.match(/https?:\/\/[^"'\x60\s)]+/g)||[])].filter(u=>sig.test(u)).slice(0,100);
    if(hits.length||urls.length) out.providerSignals.push({script:s,status:r.status(),hits:hits.slice(0,120),urls});
  }catch{}
}

const geoblocked=out.pages.some(p=>/geoblocked/i.test(p.finalUrl||'')||/not available in your country|blacklisted/i.test(p.bodyText||''));
const hasPublicData=out.jsonSamples.length>0||out.providerSignals.length>0;
out.health.connected=!geoblocked;
out.health.usable=hasPublicData;
out.health.state=hasPublicData?'PUBLIC_FRONTEND_SIGNALS_FOUND':geoblocked?'GEOBLOCKED_NO_FEED_YET':'PAGE_LOADED_NO_FEED';
if(geoblocked) out.health.errors.push('Gamdom redirected server-region requests to /geoblocked');
out.generatedAt=new Date().toISOString();

await fs.mkdir('data',{recursive:true});
await fs.writeFile(OUT,JSON.stringify(out,null,2));
await browser.close();

console.log('GAMDOM_DIRECT_SHADOW',JSON.stringify({
  state:out.health.state,
  pageCount:out.pages.length,
  requestCount:out.requests.length,
  responseCount:out.responses.length,
  jsonSamples:out.jsonSamples.length,
  scripts:out.scripts.length,
  providerSignals:out.providerSignals.length,
  finalUrls:out.pages.map(x=>x.finalUrl).filter(Boolean),
  errors:out.health.errors
}));
