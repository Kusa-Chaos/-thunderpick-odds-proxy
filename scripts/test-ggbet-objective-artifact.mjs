import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const output='data/ggbet-objective-latest.json';
await fs.rm(output,{force:true});
const {buildGgBetObjectiveArtifact}=await import('./ggbet-objective-artifact.mjs');
let importWroteFile=true;
try{await fs.access(output);}catch{importWroteFile=false;}
assert.equal(importWroteFile,false,'importing the library from a test must not execute the CLI or write scanner data');

const raw={
  generatedAt:'2026-10-03T04:04:30.000Z',connected:true,errors:[],
  sports:{lol:{events:[]},dota2:{events:[{
    id:'5:efd696a5',slug:'lgd-gaming-vs-gamerlegion-03-10',
    fixture:{title:'LGD Gaming vs GamerLegion',status:'NOT_STARTED',startTime:'2026-10-03T13:00:00+00:00',sportId:'esports_dota_2',competitors:[{name:'LGD Gaming'},{name:'GamerLegion'}]},
    markets:[
      {id:'49m1x5',name:'Map 1 - Race to kills',status:'ACTIVE',typeId:49,specifiers:[{name:'mapnr',value:'1'},{name:'xth',value:'5'}],odds:[{name:'LGD Gaming 5',value:'1.51',status:'NOT_RESULTED'},{name:'GamerLegion 5',value:'2.46',status:'NOT_RESULTED'}]},
      {id:'79m1',name:'Map 1 - First Blood',status:'ACTIVE',typeId:79,specifiers:[{name:'mapnr',value:'1'}],odds:[{name:'LGD Gaming',value:'1.49',status:'NOT_RESULTED'},{name:'GamerLegion',value:'2.51',status:'NOT_RESULTED'}]}
    ]
  }]}}
};
const out=buildGgBetObjectiveArtifact(raw);
assert.equal(out.connected,true);
assert.equal(out.usable,true);
assert.equal(out.state,'CONNECTED_USABLE');
assert.equal(out.events,1);
assert.equal(out.markets,2);
assert.equal(out.sports.dota2.exactV2.length,1);
assert.equal(out.sports.dota2.exactV2[0].bookmakers[0].key,'ggbet');
assert.equal(out.sports.dota2.exactV2[0].bookmakers[0].markets[0].baseLine,5);
console.log('GGBET_OBJECTIVE_ARTIFACT_VERIFIED 1');
