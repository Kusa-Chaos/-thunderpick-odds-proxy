import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {replaceDirectSnapshot} from './direct-merge.mjs';

const comparisonPath='data/owls-comparison-latest.json';
const directPath='data/direct-sources-latest.json';
const redact=s=>String(s||'').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[REDACTED]').slice(0,240);
const cloudbet=spawnSync('python',['scripts/cloudbet-direct.py'],{encoding:'utf8',env:process.env,timeout:120000});
if(cloudbet.status!==0){
 const failed=JSON.parse(await fs.readFile(directPath,'utf8'));
 failed.providerHealth ||= {};
 failed.providerHealth.cloudbet={ok:false,source:'cloudbet-direct',events:0,state:'COLLECTOR_PROCESS_FAILED',error:redact(cloudbet.stderr||cloudbet.error?.message),fetchedAt:new Date().toISOString()};
 failed.generatedAt=new Date().toISOString();
 await fs.writeFile(directPath,JSON.stringify(failed,null,2));
 console.warn('CLOUDBET_DIRECT_FAILED',failed.providerHealth.cloudbet);
}else if(cloudbet.stdout?.trim()) console.log('CLOUDBET_DIRECT',cloudbet.stdout.trim());

const c=JSON.parse(await fs.readFile(comparisonPath,'utf8'));
const d=JSON.parse(await fs.readFile(directPath,'utf8'));
c.sports ||= {};
for(const [sport,src] of Object.entries(d.sports||{})){
 c.sports[sport] ||= {ok:true,status:200,data:{}};
 const existing=Array.isArray(c.sports[sport].exactV2)?c.sports[sport].exactV2:[];
 const incoming=Array.isArray(src.exactV2)?src.exactV2:[];
 // Direct collectors are a current snapshot, not an append-only history.
 // Remove every prior direct-layer event first so vanished/stale provider rows
 // cannot survive into later scans, then add only this run's current snapshot.
 const merged=replaceDirectSnapshot(existing,incoming);
 c.sports[sport].exactV2=merged;
 c.sports[sport].exactV2EventCount=merged.length;
 c.sports[sport].directPublicEventCount=incoming.length;
}
c.directPublic={generatedAt:d.generatedAt,providerHealth:d.providerHealth||{},source:'quota-free direct collectors'};
c.generatedAt=new Date().toISOString();
await fs.writeFile(comparisonPath,JSON.stringify(c,null,2));
console.log('DIRECT_MERGE_OK',JSON.stringify(c.directPublic));
