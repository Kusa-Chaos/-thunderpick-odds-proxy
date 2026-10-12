import assert from 'node:assert/strict';
import {inspectPublicMarkup} from './betway-objective-shadow-probe.mjs';
const input=[
 '"101":{"id":101,"started":false,"name":"KT Rolster - Team Vitality","subcategoryName":"League of Legends","startsAt":"2026-10-12T06:00:00Z"}',
 '"102":{"id":102,"started":true,"name":"Alpha - Beta","subcategoryName":"Dota 2","startsAt":"2026-10-12T07:00:00Z"}',
 '"marketCName":"first-blood"',
 '"marketCName":"total-kills"',
 '"marketCName":"match-winner"',
 '"name":{"default":"Map 1 First Blood"},"marketCName":"first-blood","eventId":101',
 '"name":{"default":"Map 1 Total Kills"},"marketCName":"total-kills","eventId":101'
].join(',');
const result=inspectPublicMarkup(input);
assert.equal(result.events.length,1);
assert.equal(result.events[0].id,'101');
assert.equal(result.objectiveCategoryHits.length,2);
assert.equal(result.objectiveMarketObjects.length,2);
assert(result.objectiveMarketObjects.every(x=>x.eventId==='101'));
assert(!result.objectiveCategoryHits.some(x=>x.name==='match winner'));
console.log('BETWAY_OBJECTIVE_PUBLIC_SHADOW_QUALIFICATION_TEST_VERIFIED');
