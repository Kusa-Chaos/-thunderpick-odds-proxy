import fs from 'node:fs';
const s=fs.readFileSync('scripts/cloudbet-direct.py','utf8');
for (const marker of ['cloudbet-direct:','cloudbet-direct','data/direct-sources-latest.json','Match Winner','X-API-Key','load_key','sports-api.cloudbet.com','exactV2','bookmakers','outcomes','price']) {
  if (!s.includes(marker)) throw new Error(`missing ${marker}`);
}
if (s.includes('COLLECTOR_NOT_CONNECTED')) throw new Error('collector still scaffolded');
const merge=fs.readFileSync('scripts/direct-merge.mjs','utf8');
if (!merge.includes("'cloudbet-direct:'")) throw new Error('missing cloudbet direct merge prefix');
console.log('cloudbet live collection contract test ok');
