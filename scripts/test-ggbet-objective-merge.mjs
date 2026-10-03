import assert from 'node:assert/strict';
import {mergeGgBetObjectiveArtifact} from './ggbet-objective-merge.mjs';

const base={generatedAt:'2026-10-03T04:00:00.000Z',providerHealth:{},sports:{lol:{exactV2:[]},dota2:{exactV2:[]}}};
const fresh={
  generatedAt:'2026-10-03T04:04:30.000Z',
  state:'CONNECTED_USABLE',connected:true,usable:true,errors:[],
  sports:{
    lol:{exactV2:[{id:'ggbet:lol:1',home_team:'T1',away_team:'Gen.G',bookmakers:[{key:'ggbet',title:'GG.BET',markets:[{key:'objective',name:'Map 1 - Race to 5 Kills',scope:{map:1},line:5,outcomes:[{name:'T1',price:1.82},{name:'Gen.G',price:1.94}]}]}]}]},
    dota2:{exactV2:[]}
  }
};
const merged=mergeGgBetObjectiveArtifact(base,fresh,{nowMs:Date.parse('2026-10-03T04:05:00.000Z'),maxAgeMs:10*60*1000});
assert.equal(merged.providerHealth.ggbetObjective.usable,true);
assert.equal(merged.providerHealth.ggbetObjective.events,1);
assert.equal(merged.sports.lol.exactV2.length,1);
assert.equal(merged.sports.lol.exactV2[0].bookmakers[0].key,'ggbet');

const stale={...fresh,generatedAt:'2026-10-03T03:30:00.000Z'};
const rejected=mergeGgBetObjectiveArtifact(base,stale,{nowMs:Date.parse('2026-10-03T04:05:00.000Z'),maxAgeMs:10*60*1000});
assert.equal(rejected.providerHealth.ggbetObjective.usable,false);
assert.equal(rejected.providerHealth.ggbetObjective.state,'STALE');
assert.equal(rejected.sports.lol.exactV2.length,0);

const broken={...fresh,usable:false,state:'ERROR',errors:['graphql failed']};
const failed=mergeGgBetObjectiveArtifact(base,broken,{nowMs:Date.parse('2026-10-03T04:05:00.000Z'),maxAgeMs:10*60*1000});
assert.equal(failed.providerHealth.ggbetObjective.usable,false);
assert.equal(failed.sports.lol.exactV2.length,0);

console.log('GGBET_OBJECTIVE_MERGE_VERIFIED 3');
