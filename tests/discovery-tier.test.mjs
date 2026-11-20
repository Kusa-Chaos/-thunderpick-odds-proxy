import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDiscoveryTier} from '../scripts/discovery-tier.mjs';

test('one outside family remains informational even with large estimated EV', () => {
  assert.equal(classifyDiscoveryTier({outside:[{book:'polymarket'}],estimatedEV:2.5,identityComplete:true}), 'INFORMATIONAL');
});
test('duplicate adapter prices count as one bookmaker family', () => {
  assert.equal(classifyDiscoveryTier({outside:[{book:'pinnwire'},{book:'pinnacle'}],estimatedEV:0.2,identityComplete:true}), 'INFORMATIONAL');
});
test('two distinct outside families are screening, never watch', () => {
  assert.equal(classifyDiscoveryTier({outside:[{book:'polymarket'},{book:'kalshi'}],estimatedEV:0.02,identityComplete:true}), 'SCREENING');
});
test('incomplete exact identity cannot become screening', () => {
  assert.equal(classifyDiscoveryTier({outside:[{book:'polymarket'},{book:'kalshi'}],estimatedEV:0.02,identityComplete:false}), 'INFORMATIONAL');
});
test('discovery rows cannot auto-promote to WATCH or ACTION with many outside prices', () => {
  assert.equal(classifyDiscoveryTier({outside:[{book:'polymarket'},{book:'kalshi'},{book:'stake'},{book:'betway'},{book:'fanduel'}],estimatedEV:0.4,identityComplete:true}), 'SCREENING');
});
