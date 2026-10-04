import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT='data/gamdom-betby-guest-latest.json';
const BASE='https://gamdom.com';
const endpoint=BASE+'/client-api/casino/game-url';
const payload={
  gameCode:'betby_sportsbook',
  demo:true,
  lang:'en',
  mobile:false,
  walletInfo:{
    amount:0,
    displayCurrency:'USD',
    unit:'COINS',
    wallet_type:'DEFAULT'
  }
};
const out={generatedAt:new Date().toISOString(),mode:'gamdom-betby-guest-v2',endpoint,payload:{...payload,walletInfo:{...payload.walletInfo}},status:null,ok:false,state:'STARTING',config:{},errors:[]};

function parseMaybeJson(v){
  let x=v;
  for(let i=0;i<3&&typeof x==='string';i++){
    try{x=JSON.parse(x);}catch{return x;}
  }
  return x;
}
function sanitize(j){
  const parsed=parseMaybeJson(j);
  if(!parsed||typeof parsed!=='object') return {type:typeof parsed,preview:String(parsed??'').slice(0,500)};
  const cfg=parsed;
  let rendererHost=null,urlHost=null;
  try{if(cfg.btRendererUrl)rendererHost=new URL(cfg.btRendererUrl).hostname;}catch{}
  try{if(cfg.url)urlHost=new URL(cfg.url).hostname;}catch{}
  return {
    keys:Object.keys(cfg),
    brandId:cfg.brandId??cfg.brand_id??null,
    tokenPresent:Boolean(cfg.token),
    themeName:cfg.themeName??null,
    btRendererUrlPresent:Boolean(cfg.btRendererUrl),
    btRendererHost:rendererHost,
    urlPresent:Boolean(cfg.url),
    urlHost,
    fair:cfg.fair??null,
    partnerId:cfg.partnerId??null,
    supportedCurrencies:Array.isArray(cfg.supportedCurrencies)?cfg.supportedCurrencies:[],
    error:cfg.error??cfg.message??null
  };
}

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'en-US'});
try{
  const r=await context.request.post(endpoint,{
    headers:{'content-type':'application/json','accept':'application/json','accept-language':'en'},
    data:payload,
    timeout:30000
  });
  out.status=r.status();
  const text=await r.text();
  out.config=sanitize(text);
  out.ok=r.ok()&&Boolean(out.config.brandId)&&out.config.btRendererUrlPresent;
  out.state=out.ok?'GUEST_CONFIG_USABLE':r.ok()?'GUEST_CONFIG_RESPONSE_NO_USABLE_CONFIG':'GUEST_CONFIG_BLOCKED_OR_ERROR';
}catch(e){
  out.state='REQUEST_ERROR';
  out.errors.push(String(e?.message||e));
}
out.generatedAt=new Date().toISOString();
await fs.mkdir('data',{recursive:true});
await fs.writeFile(OUT,JSON.stringify(out,null,2));
await browser.close();
console.log('GAMDOM_BETBY_GUEST',JSON.stringify({status:out.status,ok:out.ok,state:out.state,config:out.config,errors:out.errors}));
