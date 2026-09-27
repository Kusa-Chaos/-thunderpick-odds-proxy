const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const base='https://betway.com';
const url=base+'/g/en/sports/cat/esports';
function decode(s=''){return String(s).replace(/\\"/g,'"').replace(/\\u0026/g,'&').replace(/\\u003c/g,'<').replace(/\\u003e/g,'>');}
async function get(u){const r=await fetch(u,{headers:{Accept:'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','User-Agent':UA},redirect:'follow',signal:AbortSignal.timeout(30000)});return{status:r.status,url:r.url,text:decode(await r.text())};}
function uniq(xs){return [...new Set(xs)]}
const p=await get(url),raw=p.text;
const out={status:p.status,bytes:raw.length,events:[],categoryMarkets:{},eventDetail:null};
for(const m of raw.matchAll(/"marketCName":"([^"]+)"/g)) out.categoryMarkets[m[1]]=(out.categoryMarkets[m[1]]||0)+1;
for(const m of raw.matchAll(/"(\d+)":\{"id":\1,.*?"started":(true|false),.*?"name":"([^"]+)",.*?"subcategoryName":"([^"]+)",.*?"startsAt":"([^"]+)"/gs)){
 if(out.events.length<12) out.events.push({id:m[1],started:m[2]==='true',name:m[3],sub:m[4],start:m[5]});
}
const e=out.events.find(x=>!x.started)||out.events[0];
if(e){
 const q=await get(`${base}/g/en/sports/event/${e.id}`),txt=q.text;
 const refs=[];
 for(const m of txt.matchAll(/https?:\\?\/\\?\/[^"'<>\s\\]+/g)){const x=m[0].replace(/\\\//g,'/');if(/api|sport|event|market|fixture|offer|swift|valueactive|spin/i.test(x))refs.push(x.slice(0,500));}
 for(const m of txt.matchAll(/["']([^"']{1,400})["']/g)){const x=m[1].replace(/\\\//g,'/');if(/(?:api|event|market|fixture|offer|sportsbook|sportsdata|valueactive|swift)/i.test(x)&&(/\//.test(x)||/https?:/i.test(x)))refs.push(x.slice(0,500));}
 const scriptSrc=[];
 for(const m of txt.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) scriptSrc.push(new URL(m[1],q.url).href);
 const bundleRefs=[];
 for(const su of uniq(scriptSrc).slice(0,20)){
   try{const b=await get(su);if(b.status!==200||b.text.length>7000000)continue;
     for(const m of b.text.matchAll(/https?:\\?\/\\?\/[^"'<>\s\\]+/g)){const x=m[0].replace(/\\\//g,'/');if(/api|sport|event|market|fixture|offer|swift|valueactive|spin/i.test(x))bundleRefs.push(x.slice(0,500));}
     for(const m of b.text.matchAll(/["']([^"']{1,350})["']/g)){const x=m[1].replace(/\\\//g,'/');if(/(?:api|event|market|fixture|offer|sportsbook|sportsdata)/i.test(x)&&(/\//.test(x)||/https?:/i.test(x)))bundleRefs.push(x.slice(0,350));}
   }catch{}
 }
 const eventIdContexts=[];let pos=0;while((pos=txt.indexOf(e.id,pos))>=0&&eventIdContexts.length<12){eventIdContexts.push(txt.slice(Math.max(0,pos-500),pos+1000));pos+=e.id.length;}
 out.eventDetail={id:e.id,name:e.name,status:q.status,final:q.url,bytes:txt.length,scripts:uniq(scriptSrc).slice(0,40),pageRefs:uniq(refs).slice(0,120),bundleRefs:uniq(bundleRefs).slice(0,160),eventIdContexts};
}
console.log('BETWAY_ESPORTS_MARKET_PROBE',JSON.stringify(out));
