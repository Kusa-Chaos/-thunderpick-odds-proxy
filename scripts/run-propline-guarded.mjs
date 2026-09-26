import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

const HEALTH='data/propline-health.json';
const CMP='data/owls-comparison-latest.json';
const now=Date.now();
let health={};
try{health=JSON.parse(await fs.readFile(HEALTH,'utf8'));}catch{}

const blockedUntil=Date.parse(health.blockedUntil||'');
if(Number.isFinite(blockedUntil)&&blockedUntil>now){
  console.warn('PROPLINE_CIRCUIT_OPEN until',health.blockedUntil,'reason=',health.reason||'quota/rate-limit');
  try{
    const cmp=JSON.parse(await fs.readFile(CMP,'utf8'));
    cmp.proplineHealth={snapshotHealthy:false,circuitOpen:true,sourceDataAt:health.lastHealthyAt||null,checkedAt:new Date().toISOString(),blockedUntil:health.blockedUntil,reason:health.reason||'quota/rate-limit',lastKnownQuota:health.quota||null};
    await fs.writeFile(CMP,JSON.stringify(cmp,null,2));
  }catch{}
  process.exit(0);
}

const child=spawn(process.execPath,['scripts/propline-enrich.mjs'],{stdio:'inherit',env:process.env});
const code=await new Promise(resolve=>child.on('close',resolve));
let cmp=null; try{cmp=JSON.parse(await fs.readFile(CMP,'utf8'));}catch{}
const p=cmp?.propline||null;
const remaining=Number(p?.quota?.remaining);
const feed429=Array.isArray(p?.feeds)&&p.feeds.some(x=>Number(x?.status)===429);
const unhealthy=code!==0||feed429||(Number.isFinite(remaining)&&remaining<=50);
const next={
  checkedAt:new Date().toISOString(),
  lastHealthyAt:unhealthy?(health.lastHealthyAt||null):new Date().toISOString(),
  quota:p?.quota||health.quota||null,
  reason:feed429?'HTTP 429':code!==0?`PropLine exit ${code}`:(Number.isFinite(remaining)&&remaining<=50?'quota reserve exhausted':null),
  blockedUntil:unhealthy?new Date(Date.now()+6*3600e3).toISOString():null,
  snapshotHealthy:!unhealthy
};
await fs.writeFile(HEALTH,JSON.stringify(next,null,2));
if(cmp){
  cmp.proplineHealth={...next,circuitOpen:unhealthy,sourceDataAt:next.lastHealthyAt};
  await fs.writeFile(CMP,JSON.stringify(cmp,null,2));
}
// Degraded outside coverage must not kill the whole scan. The screener's source gate
// decides ACTION/WATCH eligibility; low-source rows remain visible as SCREENING.
if(code!==0) console.warn('PROPLINE_DEGRADED_CONTINUE',code);
