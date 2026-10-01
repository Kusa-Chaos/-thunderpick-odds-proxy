import fs from 'node:fs';
const s=fs.readFileSync('scripts/build-results-display.mjs','utf8');
for (const marker of ['delivery-latest.json','strictSnapshotHealthy','coverageAudit','actionRows','watchRows','screeningRows','topPriceBoardRows','parseErrors']) {
  if (!s.includes(marker)) throw new Error(`missing ${marker}`);
}
console.log('delivery artifact contract test ok');
