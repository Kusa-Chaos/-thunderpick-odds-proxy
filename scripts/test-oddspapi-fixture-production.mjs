import assert from 'node:assert/strict';
import {collectOddsPapiTournamentShadow} from './oddspapi-tournament-shadow-collector.mjs';
import {prepareVerifiedFixtureShadow} from './oddspapi-fixture-shadow-promotion.mjs';
import {bridgeOddsPapiSnapshot} from './oddspapi-aws-shadow-bridge.mjs';

const nowIso='2026-10-11T17:00:00Z',now=Date.parse(nowIso);
const fixture={fixtureId:'fixture-77',sportId:18,tournamentId:515,statusId:0,
 hasOdds:true,participant1Name:'Alpha',participant2Name:'Beta',startTime:'2026-10-11T19:00:00Z'};
const inventory={sports:{lol:{data:{data:[{name:'Alpha vs Beta',startTime:fixture.startTime}]}}}};
const account={current_subscription_id:'x',subscriptions:[{subscription_id:'x',is_active:true,sport_ids:[18],
 request_count:10,request_limit:500,bookmakers:{bet365:{},betano:{},roobet:{},unibet:{},'1xbet':{}}}]};
const market={marketId:55,sportId:18,marketName:'Winner',marketType:'moneyline',period:'result',
 outcomes:[{outcomeId:1,outcomeName:'1'},{outcomeId:2,outcomeName:'2'}]};
const player=(price,changedAt='2026-10-11T16:52:00Z')=>({players:{'0':{active:true,price,changedAt}}});
const bm=(one,two)=>({bookmakerIsActive:true,suspended:false,
 markets:{55:{marketActive:true,outcomes:{1:player(one),2:player(two)}}}});
const raw={...fixture,bookmakerOdds:{bet365:bm(1.9,2.1),betano:bm(1.85,2.13),roobet:bm(1.88,2.08)}};
const called=[];
async function get(path){
 called.push(path);
 if(path==='/account')return account;
 if(path==='/markets')return [market];
 if(path==='/fixtures')return [fixture];
 if(path==='/odds')return raw;
 throw Error('NOT_ALLOWED '+path);
}
const shadow=await collectOddsPapiTournamentShadow({get,inventory,nowIso,maxBillableCalls:5,strategy:'fixture'});
assert.equal(shadow.state,'COLLECTED',JSON.stringify(shadow));
assert.deepEqual(called,['/account','/markets','/fixtures','/odds']);
assert.equal(shadow.counts.requests,3);
assert.equal(shadow.counts.books,3);
assert.equal(shadow.counts.markets,3);
assert.equal(shadow.source,'OddsPapi /v4/odds (verified exact fixture)');
assert(!called.includes('/odds-by-tournaments'),'unsupported endpoint not called');
const prepared=prepareVerifiedFixtureShadow(shadow,{at:nowIso});
assert.equal(prepared.sourceMode,'AUTHORIZED_FIXTURE_QUOTE_TIMESTAMPS_VERIFIED');
assert.equal(prepared.counts.books,3);
assert.equal(prepared.counts.events,1);
assert.equal(prepared.state,'COLLECTED');
assert.equal(prepared.productionEligible,false);
assert.equal(prepared.upstreamTimestampVerified,true);
const direct={sports:{lol:{exactV2:[{id:'ggbet-direct:existing-event'}]}}};
const imported=bridgeOddsPapiSnapshot({direct,shadow:prepared,nowMs:now+15*60000});
assert.equal(imported.health.state,'CONNECTED_EXACT_MARKETS',JSON.stringify(imported.health));
assert.equal(imported.health.markets,3);
assert.deepEqual(imported.health.families,['bet365','betano','roobet']);
assert.equal(imported.direct.sports.lol.exactV2.length,2,'existing bookmaker prices untouched');
const expired=bridgeOddsPapiSnapshot({direct,shadow:prepared,nowMs:now+42*60000});
assert.equal(expired.health.markets,0,'never reuse a >40m old snapshot');
const oldOutcomes={...raw,bookmakerOdds:{bet365:bm(1.9,2.1)}};
for(const p of Object.values(oldOutcomes.bookmakerOdds.bet365.markets[55].outcomes))p.players['0'].changedAt='2026-10-11T15:00:00Z';
const bad=await collectOddsPapiTournamentShadow({get:async(path)=>path==='/odds'?oldOutcomes:get(path),
 inventory,nowIso,strategy:'fixture'});
assert.equal(bad.state,'NO_FRESH_EXACT_QUOTE_TIMESTAMPS');
const badPrepared=prepareVerifiedFixtureShadow(bad,{at:nowIso});
assert.equal(badPrepared.counts.events,0);
assert.equal(bridgeOddsPapiSnapshot({direct,shadow:badPrepared,nowMs:now}).health.markets,0);
assert.throws(()=>prepareVerifiedFixtureShadow({...shadow,source:'OddsPapi /v4/odds-by-tournaments'},{at:nowIso}));
console.log('ODDSPAPI_FIXTURE_PRODUCTION_CHAIN_VERIFIED',JSON.stringify({calls:shadow.counts.requests,families:prepared.bookmakerFamilies,markets:imported.health.markets,staleBlocked:true,previousSourcesPreserved:true}));
