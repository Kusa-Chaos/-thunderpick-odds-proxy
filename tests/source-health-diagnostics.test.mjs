import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCompactDeliveryAudit} from '../scripts/build-compact-delivery-audit.mjs';

test('delivery audit retains upstream Polymarket and Kalshi diagnostics instead of hiding HTTP errors', () => {
 const sports=['american-football','baseball','basketball','soccer','tennis','cs2','dota2','lol','valorant'];
 const board={
  generatedAt:'2026-10-11T09:49:27.544Z',
  strictSnapshotHealthy:true,productionCoverageStatus:'OK',
  coverageAudit:Object.fromEntries(sports.map(k=>[k,{deepSelectedEvents:0,deepSuccessfulEvents:0,deepFailedEvents:0}])),
  sourceHealth:{direct:{
   kalshi:{ok:false,error:'HTTP 429',rawMarkets:59000,pages:59,acceptedEvents:10,retries:3},
   polymarket:{ok:true,status:200,state:'CONNECTED_NO_ELIGIBLE_MATCH_WINNERS',rawEvents:2000,pages:20,acceptedEvents:0,rejectedStale:7311}
  }}
 };
 const compact=buildCompactDeliveryAudit(board);
 assert.equal(compact.sourceHealth.kalshi.error,'HTTP 429');
 assert.equal(compact.sourceHealth.kalshi.pages,59);
 assert.equal(compact.sourceHealth.polymarket.rawEvents,2000);
 assert.equal(compact.sourceHealth.polymarket.state,'CONNECTED_NO_ELIGIBLE_MATCH_WINNERS');
});
