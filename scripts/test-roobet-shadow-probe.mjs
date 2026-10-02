import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

function expect(cond,msg){if(!cond)throw new Error(msg);}
const script='scripts/roobet-shadow-probe.mjs';
try{await fs.access(script);}catch{throw new Error('Roobet shadow probe is missing');}
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'roobet-probe-'));
const out=path.join(dir,'out.json');
execFileSync(process.execPath,[script],{cwd:process.cwd(),env:{...process.env,ODDSPAPI_API_KEY:'',ROOBET_SHADOW_OUT:out},stdio:'pipe'});
const body=JSON.parse(await fs.readFile(out,'utf8'));
expect(body.mode==='roobet-shadow-v1','probe must persist shadow mode');
expect(body.health?.configured===false,'probe without key must fail closed as unconfigured');
expect(Array.isArray(body.sports?.lol?.exactV2)&&Array.isArray(body.sports?.dota2?.exactV2),'probe must preserve both target sport buckets');
console.log('ROOBET_SHADOW_PROBE_FAIL_CLOSED_VERIFIED');
