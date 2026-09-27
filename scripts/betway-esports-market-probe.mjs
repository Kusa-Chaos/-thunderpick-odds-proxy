const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const base='https://betway.com';
const url=base+'/g/en/sports/cat/esports';
function decode(s=''){return String(s).replace(/\\"/g,'"').replace(/\\u0026/g,'&').replace(/\\u003c/g,'<').replace(/\\u003e/g,'>');}
async function get(u){const r=await fetch(u,{headers:{Accept:'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','User-Agent':UA},redirect:'follow',signal:AbortSignal.timeout(30000)});return{status:r.status,url:r.url,text:decode(await r.text())};}
const p=await get(url),raw=p.text;
const out={status:p.status,bytes:raw.length,marketCNames:{},defaultNames:{},events:[],routeCandidates:[],detailTests:[]};
for(const m of raw.matchAll(/"marketCName":"([^"]+)"/g)) out.marketCNames[m[1]]=(out.marketCNames[m[1]]||0)+1;
for(const m of raw.matchAll(/"name":\{[^{}]{0,400}?"default":"([^"]+)"[^{}]{0,400}?\},"marketCName":"([^"]+)"/g)){const k=`${m[2]} :: ${m[1]}`;out.defaultNames[k]=(out.defaultNames[k]||0)+1;}
for(const m of raw.matchAll(/"(\d+)":\{"id":\1,.*?"started":(true|false),.*?"name":"([^"]+)",.*?"subcategoryName":"([^"]+)",.*?"startsAt":"([^"]+)"/gs)){
 if(out.events.length<12) out.events.push({id:m[1],started:m[2]==='true',name:m[3],sub:m[4],start:m[5]});
}
const hrefs=new Set();
for(const m of raw.matchAll(/(?:href|url|link|path|route)[\\"']*[:=][\\"']+([^\\"']+)/gi)){const x=m[1].replace(/\\\//g,'/');if(/sport|event|match|esport/i.test(x))hrefs.add(x);}
for(const e of out.events){
 const idx=raw.indexOf(`"id":${e.id}`); if(idx>=0){const ctx=raw.slice(Math.max(0,idx-5000),idx+7000);for(const m of ctx.matchAll(/(?:href|url|link|path|route)[\\"']*[:=][\\"']+([^\\"']+)/gi)){const x=m[1].replace(/\\\//g,'/');if(x)hrefs.add(x);}}
}
out.routeCandidates=[...hrefs].slice(0,80);
const e=out.events.find(x=>!x.started)||out.events[0];
if(e){
 const slug=e.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
 const guesses=[
  `/g/en/sports/event/${e.id}`,
  `/g/en/sports/evt/${e.id}`,
  `/g/en/sports/event/${slug}/${e.id}`,
  `/g/en/sports/evt/${slug}/${e.id}`,
  `/g/en/sports/cat/esports/event/${e.id}`,
  `/g/en/sports/match/${e.id}`,
 ];
 for(const path of guesses){try{const q=await get(base+path);const names={};for(const m of q.text.matchAll(/"marketCName":"([^"]+)"/g)) names[m[1]]=(names[m[1]]||0)+1;out.detailTests.push({path,status:q.status,final:q.url,bytes:q.text.length,marketCNames:names});}catch(err){out.detailTests.push({path,error:String(err?.message||err)})}}
}
out.marketCNames=Object.fromEntries(Object.entries(out.marketCNames).sort((a,b)=>b[1]-a[1]));
out.defaultNames=Object.fromEntries(Object.entries(out.defaultNames).sort((a,b)=>b[1]-a[1]));
console.log('BETWAY_ESPORTS_MARKET_PROBE',JSON.stringify(out));
