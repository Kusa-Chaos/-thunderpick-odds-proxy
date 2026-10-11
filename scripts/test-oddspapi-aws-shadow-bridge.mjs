import assert from 'node:assert/strict';
import {bridgeOddsPapiSnapshot} from './oddspapi-aws-shadow-bridge.mjs';

const now=Date.parse('2026-10-11T10:40:00Z');
const time='2026-10-11T10:38:00Z';
const mk=(key='h2h',overrides={})=>({
 key,name:key==='map_winner'?'Map 1 Winner':'Match Winner',
 scope:{map:key==='map_winner'?1:null,round:null},line:null,last_update:time,
 outcomes:[{name:'Alpha',price:1.9},{name:'Beta',price:1.9}],...overrides
});
const market=mk();
const bookmaker=(family,markets=[market])=>({key:'oddspapi-'+family,title:family,sourceFamily:family,markets});
const event={id:'oddspapi-direct:fix1',home_team:'Alpha',away_team:'Beta',
 commence_time:'2026-10-11T15:00:00Z',live:false,bookmakers:[
  bookmaker('bet365'),bookmaker('bet365',[mk('map_winner')]),
  bookmaker('roobet',[mk('map_winner')]),bookmaker('unibet-kambi')
 ]};
const shadow={generatedAt:time,mode:'SHADOW_ONLY',productionEligible:false,state:'COLLECTED',
 entitlement:{state:'ESPORTS_ELIGIBLE'},sports:{lol:{exactV2:[event]}}};
const old={sports:{lol:{exactV2:[{id:'oddspapi-direct:stale'},{id:'cloudbet-direct:ok'}]}},providerHealth:{stake:{ok:true}}};
const {direct,health}=bridgeOddsPapiSnapshot({direct:old,shadow,nowMs:now});
assert.equal(health.state,'CONNECTED_EXACT_MARKETS');
assert.deepEqual(health.families,['bet365','roobet','unibet-kambi']);
assert.equal(health.events,1);assert.equal(health.markets,3);
assert.equal(direct.sports.lol.exactV2.length,2);
assert.equal(direct.sports.lol.exactV2[1].bookmakers.length,3,'same bookmaker cannot count twice');
assert.deepEqual(direct.providerHealth.stake,{ok:true});
const stale=bridgeOddsPapiSnapshot({direct,shadow:{...shadow,generatedAt:'2026-10-11T09:50:00Z'},nowMs:now});
assert.equal(stale.health.state,'STALE_OR_FUTURE_SHADOW');
assert.equal(stale.direct.sports.lol.exactV2.length,1,'old snapshot must be removed');
const wrong=bridgeOddsPapiSnapshot({direct:old,shadow:{...shadow,sports:{lol:{exactV2:[
 {...event,bookmakers:[bookmaker('bet365',[mk('map_winner',{scope:{map:null}})])]}
]}}},nowMs:now});
assert.equal(wrong.health.markets,0,'missing map index must reject odds');
const badPrice=bridgeOddsPapiSnapshot({direct:old,shadow:{...shadow,sports:{lol:{exactV2:[
 {...event,bookmakers:[bookmaker('bet365',[mk('h2h',{outcomes:[{name:'Alpha',price:0},{name:'Beta',price:1.9}]})])]}
]}}},nowMs:now});
assert.equal(badPrice.health.markets,0,'disabled/zero-price quote cannot be accepted');
assert.equal(bridgeOddsPapiSnapshot({direct:old,shadow:{...shadow,entitlement:{state:'QUOTA_EXHAUSTED'}},nowMs:now}).health.state,'ENTITLEMENT_NOT_VERIFIED');
assert.equal(bridgeOddsPapiSnapshot({direct:old,shadow:{...shadow,productionEligible:true},nowMs:now}).health.state,'INVALID_SHADOW_ORIGIN');
console.log('ODDSPAPI_AWS_SHADOW_BRIDGE_VERIFIED');
