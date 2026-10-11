import assert from 'node:assert/strict';
import {decideOddsPapiRefresh,attachOddsPapiRefreshHistory,eligibleEsportsMatches} from './oddspapi-refresh-policy.mjs';
const now=Date.parse('2026-10-11T17:25:00Z');
const event=(name,startTime)=>({name,startTime,isLive:false});
const inventory={sports:{lol:{data:{data:[
 event('KT Rolster vs Vitality','2026-10-11T18:50:00Z'),
 event('MOUZ vs NRG','2026-10-11T18:10:00Z'),
 event('TES vs IG','2026-10-11T19:00:00Z'),
 event('eSoccer FC vs eSoccer XI','2026-10-11T18:00:00Z')
]}},dota2:{data:{data:[]}},cs2:{data:{data:[]}},valorant:{data:{data:[]}}}};
const original={generatedAt:'2026-10-11T10:28:56Z',counts:{requests:5},
 entitlement:{remaining:165}};
const events=eligibleEsportsMatches(inventory,now);
assert.deepEqual(events.map(x=>x.name),['KT Rolster vs Vitality']);
const due=decideOddsPapiRefresh({previous:original,inventory,nowMs:now});
assert.equal(due.shouldRefresh,true);
assert.equal(due.urgentEvent,true);
assert.equal(due.estimatedRemaining,160);
const justRan={...original,generatedAt:'2026-10-11T16:20:00Z'};
assert.equal(decideOddsPapiRefresh({previous:justRan,inventory,nowMs:now}).reason,'COOLDOWN_TO_AVOID_EXCESS_REQUESTS');
const onceUsed={...original,refreshHistory:[{at:'2026-10-11T10:28:56Z',requests:5}]};
assert.equal(decideOddsPapiRefresh({previous:onceUsed,inventory,nowMs:now}).shouldRefresh,true,'urgent upcoming event permits a second run with high available quota');
const twiceUsed={...original,refreshHistory:[{at:'2026-10-11T09:00:00Z',requests:5},{at:'2026-10-11T13:00:00Z',requests:5}]};
assert.equal(decideOddsPapiRefresh({previous:twiceUsed,inventory,nowMs:now}).reason,'ONE_PREMATCH_RECOVERY_AFTER_EARLY_TESTS','one extra allowed only for first genuine pre-match window with ample quota');
const limited={...original,entitlement:{remaining:70}};
assert.equal(decideOddsPapiRefresh({previous:limited,inventory,nowMs:now}).reason,'DAILY_REQUEST_CAP','one daily refresh only when remaining quota is low');
assert.equal(decideOddsPapiRefresh({previous:{...original,entitlement:{remaining:28}},inventory,nowMs:now}).reason,'MONTHLY_QUOTA_RESERVED');
assert.equal(decideOddsPapiRefresh({previous:original,inventory:{sports:{}},nowMs:now}).reason,'NO_MATCHING_UPCOMING_ESPORTS_EVENTS');
const snap={generatedAt:'2026-10-11T17:25:10Z',counts:{requests:4}};
const attached=attachOddsPapiRefreshHistory(snap,original,now);
assert.equal(attached.refreshHistory.length,2);
assert.equal(attached.refreshHistory[1].requests,4);
assert.equal(attached.refreshPolicy.mode,'quota-gated-hourly-preflight');
const misalignedNow=Date.parse('2026-10-11T16:25:00Z');
const newInventory=JSON.parse(JSON.stringify(inventory));newInventory.generatedAt='2026-10-11T15:43:08Z';
newInventory.sports.cs2={data:{data:[event('Team Lynx vs Pandaric VAPE','2026-10-11T17:00:00Z')]}};
const offCyclePrevious={generatedAt:'2026-10-11T15:59:52Z',counts:{requests:4},
 entitlement:{remaining:159},
 refreshHistory:[{at:'2026-10-11T10:28:56Z',requests:4},{at:'2026-10-11T15:59:52Z',requests:4}]};
const recovery=decideOddsPapiRefresh({previous:offCyclePrevious,inventory:newInventory,nowMs:misalignedNow});
assert.equal(recovery.shouldRefresh,true,'one near-term manually misaligned snapshot can refresh once to align with :40');
assert.equal(recovery.reason,'ONE_TIME_COLLECTOR_ALIGNMENT_REPAIR');
const alreadyUsed=decideOddsPapiRefresh({previous:{
 ...offCyclePrevious,refreshHistory:[...offCyclePrevious.refreshHistory,{at:'2026-10-11T16:26:00Z',requests:4}]
},inventory:newInventory,nowMs:Date.parse('2026-10-11T17:25:00Z')});
assert.equal(alreadyUsed.shouldRefresh,false,'never allow unbounded alignment repairs');
const consumedInventory={...newInventory,generatedAt:'2026-10-11T16:02:00Z'};
assert.equal(decideOddsPapiRefresh({previous:offCyclePrevious,inventory:consumedInventory,nowMs:misalignedNow}).shouldRefresh,false,'do not re-spend quota when a scanner already consumed the manual snapshot');
const nearFloor={...offCyclePrevious,entitlement:{remaining:98}};
assert.equal(decideOddsPapiRefresh({previous:nearFloor,inventory:newInventory,nowMs:misalignedNow}).shouldRefresh,false,'alignment cannot exhaust scarce monthly quota');

// Real incident: the 4:48 PM Pacific screenshot showed no fresh prices
// because early manual tests exhausted the ordinary cap many hours before
// the match. Do not spend more until the same match approaches kickoff.
const incidentNow=Date.parse('2026-10-11T23:48:00Z');
const incidentInventory={sports:{lol:{data:{data:[event('KT Rolster vs Team Vitality','2026-10-12T06:00:00Z')]}}}};
const threeEarly={generatedAt:'2026-10-11T21:11:35Z',entitlement:{remaining:147},counts:{requests:3},
 refreshHistory:[{at:'2026-10-11T10:28:56Z',requests:4},
 {at:'2026-10-11T15:59:52Z',requests:4},{at:'2026-10-11T21:11:35Z',requests:3}]};
const avoidWaste=decideOddsPapiRefresh({previous:threeEarly,inventory:incidentInventory,nowMs:incidentNow});
assert.equal(avoidWaste.shouldRefresh,false);
assert.equal(avoidWaste.reason,'WAITING_FOR_NEAR_MATCH_NO_API_SPEND');
const beforeMatch=decideOddsPapiRefresh({previous:threeEarly,inventory:incidentInventory,nowMs:Date.parse('2026-10-12T04:10:00Z')});
assert.equal(beforeMatch.shouldRefresh,true,'one pre-match refresh is reserved despite three earlier test samples');
assert.equal(beforeMatch.reason,'ONE_PREMATCH_RECOVERY_AFTER_EARLY_TESTS');
assert.equal(beforeMatch.eventWindowPreviousRuns,0);
const alreadyNear={...threeEarly,refreshHistory:[...threeEarly.refreshHistory,{at:'2026-10-12T04:10:00Z',requests:3}]};
assert.equal(decideOddsPapiRefresh({previous:alreadyNear,inventory:incidentInventory,nowMs:Date.parse('2026-10-12T05:10:00Z')}).shouldRefresh,false,'never repeat expensive pre-match recovery within same window');
const insufficientQuota={...threeEarly,entitlement:{remaining:65}};
assert.equal(decideOddsPapiRefresh({previous:insufficientQuota,inventory:incidentInventory,nowMs:Date.parse('2026-10-12T04:10:00Z')}).shouldRefresh,false,'preserve quota at low balance');
console.log('ODDSPAPI_REFRESH_POLICY_VERIFIED');
