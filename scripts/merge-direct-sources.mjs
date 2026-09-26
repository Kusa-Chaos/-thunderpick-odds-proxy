import fs from 'node:fs/promises';
const comparisonPath='data/owls-comparison-latest.json';
const directPath='data/direct-sources-latest.json';
const c=JSON.parse(await fs.readFile(comparisonPath,'utf8'));
const d=JSON.parse(await fs.readFile(directPath,'utf8'));
c.sports ||= {};
for(const [sport,src] of Object.entries(d.sports||{})){
 c.sports[sport] ||= {ok:true,status:200,data:{}};
 const existing=Array.isArray(c.sports[sport].exactV2)?c.sports[sport].exactV2:[];
 const incoming=Array.isArray(src.exactV2)?src.exactV2:[];
 // Deduplicate only identical provider/event IDs; different providers remain independent.
 const seen=new Set(existing.map(x=>String(x.id||'')));
 const merged=[...existing,...incoming.filter(x=>!seen.has(String(x.id||'')))];
 c.sports[sport].exactV2=merged;
 c.sports[sport].exactV2EventCount=merged.length;
 c.sports[sport].directPublicEventCount=incoming.length;
}
c.directPublic={generatedAt:d.generatedAt,providerHealth:d.providerHealth||{},source:'quota-free direct collectors'};
c.generatedAt=new Date().toISOString();
await fs.writeFile(comparisonPath,JSON.stringify(c,null,2));
console.log('DIRECT_MERGE_OK',JSON.stringify(c.directPublic));
