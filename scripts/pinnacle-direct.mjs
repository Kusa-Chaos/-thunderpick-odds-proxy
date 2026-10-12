// Native Pinnacle's guest endpoint has consistently denied server requests
// (HTTP 403). Do not waste collector time polling it or leave prior prices
// eligible. PinnWire is a separate, WORKING source in the Pinnacle family
// and must never be modified by this disabled adapter.
import fs from 'node:fs/promises';
const target=process.env.DIRECT_FILE||'data/direct-sources-latest.json';
const direct=JSON.parse(await fs.readFile(target,'utf8'));
let removed=0;
for(const sport of Object.values(direct.sports||{})){
 if(!Array.isArray(sport?.exactV2))continue;
 const before=sport.exactV2.length;
 sport.exactV2=sport.exactV2.filter(e=>!String(e?.id||'').startsWith('pinnacle-direct:'));
 removed+=before-sport.exactV2.length;
 sport.exactV2EventCount=sport.exactV2.length;
}
// Omit disabled native Pinnacle from source health. PinnWire health and quotes
// are still collected and counted as the ONE Pinnacle family in its own step.
if(direct.providerHealth&&typeof direct.providerHealth==='object'){
 delete direct.providerHealth.pinnacle;
}
await fs.writeFile(target,JSON.stringify(direct,null,2));
console.log('NATIVE_PINNACLE_DISABLED_NO_HTTP_REQUESTS',JSON.stringify({
 disabled:true,reason:'UPSTREAM_HTTP_403',clearedNativeEvents:removed,
 preservedPinnWire:true,networkRequests:0
}));
