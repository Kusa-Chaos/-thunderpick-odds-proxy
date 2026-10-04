import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT='data/roobet-direct-network-probe.json';
const target='https://roobet.com/sports/league-of-legends-110';
const graphql='https://roobet.com/_api/graphql';
const gameIdentifier='slotegrator:sportsbook-1';
const keep=/api|sports|odds|bet|event|offering|kambi|abios|sportsbook|league|market/i;
const out={generatedAt:new Date().toISOString(),mode:'roobet-direct-shadow-v3',target,health:{connected:false,usable:false,state:'STARTING',errors:[]},guestInit:{configStatus:null,brandId:null,startStatus:null,startGameOk:false,tokenPresent:false,startUrlHost:null,startUrlParams:[],fair:null,partnerId:null,supportedCurrencies:[],errors:[]},requests:[],responses:[],jsonSamples:[],sportsbookBundleFindings:[],scripts:[],page:{url:null,title:null,textSample:null}};

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
function firstGraphql(body){
  const root=Array.isArray(body)?body[0]:body;
  return root&&typeof root==='object'?root:{};
}
function sanitizeStart(data){
  const s=data?.tpGameStartGame||null;
  if(!s)return null;
  let host=null,params=[];
  try{
    const u=new URL(s.url);
    host=u.hostname;
    params=[...new Set([...u.searchParams.keys()])];
  }catch{}
  return {
    tokenPresent:Boolean(s.token),
    startUrlHost:host,
    startUrlParams:params,
    fair:s.fair??null,
    partnerId:s.partnerId??null,
    supportedCurrencies:Array.isArray(s.supportedCurrencies)?s.supportedCurrencies:[]
  };
}
async function gql(operation){
  const headers={'accept':'application/json','content-type':'application/json','accept-language':'en'};
  let r=await context.request.post(graphql,{headers,data:[operation],timeout:30000});
  let text=await r.text();
  let parsed;try{parsed=JSON.parse(text)}catch{parsed={raw:text.slice(0,1000)}}
  if(r.status()===400 || r.status()===415){
    r=await context.request.post(graphql,{headers,data:operation,timeout:30000});
    text=await r.text();
    try{parsed=JSON.parse(text)}catch{parsed={raw:text.slice(0,1000)}}
  }
  return {status:r.status(),body:parsed};
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
    }catch{}
  }
  if(/SportsbettingRoute|sportsbook/i.test(u) && /javascript/i.test(ct) && out.sportsbookBundleFindings.length<10){
    try{
      const txt=await res.text();
      out.sportsbookBundleFindings.push(findingsFrom(txt,u));
    }catch{}
  }
});
try{
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForTimeout(8000);
  out.page.url=page.url();
  out.page.title=await page.title().catch(()=>null);
  out.page.textSample=(await page.locator('body').innerText().catch(()=>'' )).slice(0,8000);
  out.scripts=await page.locator('script[src]').evaluateAll(els=>els.map(e=>e.src)).catch(()=>[]);

  const configOp={operationName:'GetSportsbookConfig',variables:{},query:'query GetSportsbookConfig { getSportsbookConfig { brandId } }'};
  const config=await gql(configOp);
  out.guestInit.configStatus=config.status;
  const configRoot=firstGraphql(config.body);
  out.guestInit.brandId=configRoot?.data?.getSportsbookConfig?.brandId??null;
  if(configRoot?.errors) out.guestInit.errors.push(...configRoot.errors.map(e=>String(e?.message||e)).slice(0,5));

  const startOp={
    operationName:'StartGame',
    variables:{gameIdentifier,gameCurrency:'USD'},
    query:'mutation StartGame($gameIdentifier: GameIdentifier!, $mode: GameMode, $gameCurrency: String, $betId: String) { tpGameStartGame(gameIdentifier: $gameIdentifier, mode: $mode, gameCurrency: $gameCurrency, betId: $betId) { url fair token key partnerId supportedCurrencies } }'
  };
  const start=await gql(startOp);
  out.guestInit.startStatus=start.status;
  const startRoot=firstGraphql(start.body);
  const safe=sanitizeStart(startRoot?.data);
  if(safe) Object.assign(out.guestInit,safe,{startGameOk:true});
  if(startRoot?.errors) out.guestInit.errors.push(...startRoot.errors.map(e=>String(e?.message||e)).slice(0,5));

  const blocked=/unexpected error|access is forbidden|regret any inconvenience|not available in your location/i.test(out.page.textSample||'');
  out.health.connected=!blocked;
  out.health.usable=Boolean(out.guestInit.brandId&&out.guestInit.startGameOk);
  out.health.state=out.health.usable?'GUEST_INIT_USABLE':blocked?'BLOCKED_PUBLIC_PAGE':'PAGE_LOADED_NO_GUEST_INIT';
  if(blocked) out.health.errors.push('Roobet public sportsbook renderer is geo-blocked in GitHub runner region');
}catch(e){
  out.health.state='NAVIGATION_OR_GUEST_INIT_ERROR';
  out.health.errors.push(String(e?.message||e));
}
out.generatedAt=new Date().toISOString();
await fs.mkdir('data',{recursive:true});
await fs.writeFile(OUT,JSON.stringify(out,null,2));
await browser.close();
console.log('ROOBET_DIRECT_SHADOW',JSON.stringify({
  state:out.health.state,
  guestInit:{
    configStatus:out.guestInit.configStatus,
    brandId:out.guestInit.brandId,
    startStatus:out.guestInit.startStatus,
    startGameOk:out.guestInit.startGameOk,
    tokenPresent:out.guestInit.tokenPresent,
    startUrlHost:out.guestInit.startUrlHost,
    startUrlParams:out.guestInit.startUrlParams,
    fair:out.guestInit.fair,
    partnerId:out.guestInit.partnerId,
    supportedCurrencies:out.guestInit.supportedCurrencies,
    errors:out.guestInit.errors
  },
  requestCount:out.requests.length,
  responseCount:out.responses.length,
  errors:out.health.errors
}));
