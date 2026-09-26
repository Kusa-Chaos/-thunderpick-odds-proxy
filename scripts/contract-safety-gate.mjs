import fs from 'node:fs/promises';

const files=['data/scan-report-latest.json','data/scan-display-latest.json'];
const segmented=/\b(?:1st|first|2nd|second|3rd|third|4th|fourth)\s+(?:quarter|half|innings?)\b|\b(?:quarter|half|innings?)\s*\d+\b/i;
const playerLabel=/^\s*Player\s+/i;

function unsafe(r={}){
  const market=String(r.market||r.marketLabel||'');
  // Fail closed: player props must be classified as player_prop, never generic totals.
  if(r.marketKey==='totals' && playerLabel.test(market)) return 'player-labelled contract was classified as generic totals; canonical player/stat identity required';
  // Segmented team totals remain quarantined until team + period + line + settlement
  // identity is carried explicitly by every outside source.
  if(r.marketKey==='totals' && segmented.test(market) && !playerLabel.test(market)) return 'segmented total requires explicit canonical team + period + line + settlement identity';
  return null;
}

function gate(x={}){
  const removed=[];
  for(const bucket of ['actionRows','watchRows']){
    const keep=[];
    for(const r of (x[bucket]||[])){
      const blocker=unsafe(r);
      if(blocker) removed.push({...r,tier:'SCREENING',verificationTier:'IDENTITY_QUARANTINE',blocker});
      else keep.push(r);
    }
    x[bucket]=keep;
  }
  if(Array.isArray(x.rows)) x.rows=x.rows.filter(r=>!unsafe(r));
  x.identityQuarantineRows=[...(x.identityQuarantineRows||[]),...removed].slice(0,100);
  x.identitySafety={appliedAt:new Date().toISOString(),failClosed:true,quarantined:removed.length,rules:['player-labelled totals require player_prop classification','segmented totals require canonical team+period+line+settlement identity']};
  if(x.counts){x.counts.action=(x.actionRows||[]).length;x.counts.watch=(x.watchRows||[]).length;x.counts.identityQuarantine=x.identityQuarantineRows.length;}
  if(x.published){x.published.action=(x.actionRows||[]).length;x.published.watch=(x.watchRows||[]).length;}
  return x;
}

for(const p of files){
  try{const x=JSON.parse(await fs.readFile(p,'utf8'));await fs.writeFile(p,JSON.stringify(gate(x),null,2));}
  catch(e){if(e?.code!=='ENOENT')throw e;}
}
console.log('CONTRACT_IDENTITY_SAFETY_GATE_APPLIED');