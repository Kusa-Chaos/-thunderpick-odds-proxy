import assert from 'node:assert/strict';
import {readOddsPapiEntitlement,canonicalBookmakerFamily} from './third-source-eligibility.mjs';
const active={api_key:'EXAMPLE_REDACTED',current_subscription_id:'current',subscriptions:[
 {subscription_id:'old',is_active:false,sport_ids:[18],request_limit:100,request_count:15,bookmakers:{rivalry:{}}},
 {subscription_id:'current',is_active:true,sport_ids:[16,17,18,61],request_limit:40,request_count:14,bookmakers:{'bet365':{},'1xbet':{},'stake':{},'ggbet':{},'unibet':{},'pinnacle':{},'rivalry':{},'betano':{}}}
]};
const x=readOddsPapiEntitlement(active);
assert.equal(x.state,'ESPORTS_ELIGIBLE');
assert.deepEqual(x.sports,['cs2','dota2','lol','valorant']);
assert.equal(x.remaining,26);
assert.deepEqual(x.candidateFamilies,['1xbet','bet365','betano','rivalry','unibet-kambi']);
assert.equal(x.hasPinnacle,true);
assert(!JSON.stringify(x).includes('EXAMPLE_REDACTED'));
assert.equal(readOddsPapiEntitlement({...active,subscriptions:[{subscription_id:'current',is_active:true,sport_ids:[10,14],request_limit:40,request_count:14,bookmakers:{'bet365':{}}}]}).state,'ESPORTS_NOT_AUTHORIZED');
assert.equal(readOddsPapiEntitlement({...active,subscriptions:[{subscription_id:'current',is_active:true,sport_ids:[18],request_limit:40,request_count:40,bookmakers:{'bet365':{}}}]}).state,'QUOTA_EXHAUSTED');
assert.equal(readOddsPapiEntitlement({...active,subscriptions:[{subscription_id:'current',is_active:true,sport_ids:[18],request_limit:null,request_count:1,bookmakers:{'bet365':{}}}]}).state,'QUOTA_UNVERIFIED');
assert.equal(readOddsPapiEntitlement({subscriptions:[]}).state,'NO_ACTIVE_SUBSCRIPTION');
for(const [name,fam] of [['PinnWire','pinnacle'],['Stake (Oddin)','stake-oddin'],['Unibet','unibet-kambi'],['1xBet','1xbet'],['Bet365','bet365'],['Betano','betano'],['Rivalry','rivalry']])assert.equal(canonicalBookmakerFamily(name),fam);
assert.equal(canonicalBookmakerFamily('HLTV.com'),null,'media sites are not independent books');
assert.equal(canonicalBookmakerFamily('OddsPapi'),null,'API vendors are not independent books');
console.log('THIRD_SOURCE_ACCOUNT_ELIGIBILITY_TEST_PASSED');