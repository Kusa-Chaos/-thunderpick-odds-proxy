import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pinnacle-off-'));
try{
 const file=path.join(temp,'direct.json');
 const data={sports:{lol:{exactV2:[
  {id:'pinnacle-direct:old-403'},
  {id:'pinnwire-direct:keep-live'},
  {id:'oddspapi-direct:keep-other'},
 ]},cs2:{exactV2:[{id:'pinnacle-direct:old-2'}]}},
  providerHealth:{pinnacle:{ok:false,status:403},pinnwire:{ok:true,markets:400},ggbet:{ok:true}}};
 await fs.writeFile(file,JSON.stringify(data));
 const r=spawnSync(process.execPath,[new URL('./pinnacle-direct.mjs',import.meta.url).pathname],
  {env:{...process.env,DIRECT_FILE:file},encoding:'utf8',timeout:15000});
 assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/NATIVE_PINNACLE_DISABLED_NO_HTTP_REQUESTS/);
 assert.match(r.stdout,/"networkRequests":0/);
 const after=JSON.parse(await fs.readFile(file,'utf8'));
 assert.deepEqual(after.sports.lol.exactV2.map(x=>x.id),['pinnwire-direct:keep-live','oddspapi-direct:keep-other']);
 assert.equal(after.sports.cs2.exactV2.length,0);
 assert.equal(after.sports.lol.exactV2EventCount,2);
 assert.equal(after.providerHealth.pinnacle,undefined);
 assert.deepEqual(after.providerHealth.pinnwire,{ok:true,markets:400});
 assert.deepEqual(after.providerHealth.ggbet,{ok:true});
 console.log('NATIVE_PINNACLE_DISABLED_VERIFIED');
}finally{await fs.rm(temp,{recursive:true,force:true});}
