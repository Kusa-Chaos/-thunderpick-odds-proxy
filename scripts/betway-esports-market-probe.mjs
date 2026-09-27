const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const url='https://betway.com/g/en/sports/cat/esports';
function decode(s=''){return String(s).replace(/\\"/g,'"').replace(/\\u0026/g,'&').replace(/\\u003c/g,'<').replace(/\\u003e/g,'>');}
const r=await fetch(url,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':UA},redirect:'follow',signal:AbortSignal.timeout(30000)});
const raw=decode(await r.text());
const out={status:r.status,bytes:raw.length,marketCNames:{},defaultNames:{},samples:[]};
for(const m of raw.matchAll(/"marketCName":"([^"]+)"/g)){out.marketCNames[m[1]]=(out.marketCNames[m[1]]||0)+1;}
for(const m of raw.matchAll(/"name":\{[^{}]{0,400}?"default":"([^"]+)"[^{}]{0,400}?\},"marketCName":"([^"]+)"/g)){
 const k=`${m[2]} :: ${m[1]}`;out.defaultNames[k]=(out.defaultNames[k]||0)+1;
}
const wanted=/map|round|handicap|total|kill|death|assist|headshot|winner|match/i;
for(const m of raw.matchAll(/.{0,500}"marketCName":"([^"]+)".{0,1200}/gs)){
 if(!wanted.test(m[1])) continue;
 out.samples.push(m[0].slice(0,1800));if(out.samples.length>=25)break;
}
out.marketCNames=Object.fromEntries(Object.entries(out.marketCNames).sort((a,b)=>b[1]-a[1]).slice(0,100));
out.defaultNames=Object.fromEntries(Object.entries(out.defaultNames).sort((a,b)=>b[1]-a[1]).slice(0,150));
console.log('BETWAY_ESPORTS_MARKET_PROBE',JSON.stringify(out));
