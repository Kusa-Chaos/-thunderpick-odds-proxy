import assert from 'node:assert/strict';
import {bridgeOddsPapiSnapshot} from './oddspapi-aws-shadow-bridge.mjs';

const now=Date.parse('2026-10-11T10:40:00Z');
const time='2026-10-11T10:38:00Z';
const mk=(key='h2h',overrides={})=>({
 key,name:key==='map_winner'?'Map 1 Winner':'Match Winner',
 scope:{map:key==='map_winner'?1:null,round:null},line:null,last_update:time,quoteTimestampVerified:true,quoteTimestampSource:'outcome.changedAt',
 outcomes:[{name:'Alpha',price:1.9},{name:'Beta',price:1.9}],...overrides
});
const market=mk();
const bookmaker=(family,markets=[market])=>({key:'oddspapi-'+family,title:family,sourceFamily:family,markets});
const event={id:'oddspapi-direct:fix1',home_team:'Alpha',away_team:'Beta',
 commence_time:'2026-10-11T15:00:00Z',live:false,bookmakers:[
  bookmaker('bet365'),bookmaker('bet365',[mk('map_winner')]),
  bookmaker('roobet',[mk('map_winner')]),bookmaker('unibet-kambi')
 ]};
const shadow={generatedAt:time,mode:'SHADOW_ONLY',productionEligible:false,state:'COLLECTED',sourceMode:'AUTHORIZED_FIXTURE_QUOTE_TIMESTAMPS_VERIFIED',upstreamTimestampVerified:true,
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
assert.equal(stale.health.state,'IDLE_NO_FRESH_QUOTA_GATED_QUOTES');
assert.equal(stale.health.ok,true,'expired optional prices must not mark nine-sport scanner unhealthy');
assert.equal(stale.health.usable,false,'expired data may never enter betting calculations');
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
const invalidOrigin=bridgeOddsPapiSnapshot({direct:old,shadow:{...shadow,sourceMode:'collection-time'},nowMs:now});
assert.equal(invalidOrigin.health.state,'UNVERIFIED_UPSTREAM_QUOTE_TIMESTAMPS');
const quoteStale=bridgeOddsPapiSnapshot({direct:old,shadow:{...shadow,sports:{lol:{exactV2:[
 {...event,bookmakers:[bookmaker('bet365',[mk('h2h',{last_update:'2026-10-11T09:45:00Z'})])]}
]}}},nowMs:now});
assert.equal(quoteStale.health.markets,0,'quote older than 40m at AWS scan is invalid despite fresh snapshot');
const quoteUnverified=bridgeOddsPapiSnapshot({direct:old,shadow:{...shadow,sports:{lol:{exactV2:[
 {...event,bookmakers:[bookmaker('bet365',[mk('h2h',{quoteTimestampVerified:false})])]}
]}}},nowMs:now});
assert.equal(quoteUnverified.health.markets,0,'collection-time substitutions are never accepted');
console.log('ODDSPAPI_AWS_SHADOW_BRIDGE_VERIFIED');
