import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=mkdtempSync(join(tmpdir(),'tp-cloudbet-one-pass-'));
try{
 const data=join(root,'data'),bin=join(root,'bin');mkdirSync(data);mkdirSync(bin);
 const marker=join(root,'python-recalled');
 const py=join(bin,'python3');writeFileSync(py,'#!/bin/sh\necho recalled > "$CLOUDBET_RECALL_MARKER"\nexit 0\n');chmodSync(py,0o755);
 const seed={generatedAt:'2026-10-09T16:35:00Z',providerHealth:{cloudbet:{ok:true,state:'CONNECTED_USABLE',events:10,fetchedAt:'2026-10-09T16:35:00Z'}},sports:{}};
 writeFileSync(join(data,'direct-sources-latest.json'),JSON.stringify(seed));
 writeFileSync(join(data,'owls-latest.json'),JSON.stringify({sports:{}}));
 const source=fileURLToPath(new URL('./simple-direct-discovery.mjs',import.meta.url));
 const run=spawnSync(process.execPath,[source],{cwd:root,encoding:'utf8',timeout:15000,env:{...process.env,PATH:bin+':'+process.env.PATH,CLOUDBET_RECALL_MARKER:marker}});
 assert.equal(run.status,0,run.stderr||String(run.error));
 assert.equal(existsSync(marker),false,'simple-direct-discovery must not launch Cloudbet a second time');
 const after=JSON.parse(readFileSync(join(data,'direct-sources-latest.json'),'utf8'));
 assert.deepEqual(after.providerHealth.cloudbet,seed.providerHealth.cloudbet,'discovery must preserve first collector outcome');
 const board=JSON.parse(readFileSync(join(data,'simple-direct-discovery-latest.json'),'utf8'));
 assert.equal(board.counts.rows,0);
 console.log('CLOUDBET_SINGLE_COLLECTION_VERIFIED');
}finally{rmSync(root,{recursive:true,force:true});}
