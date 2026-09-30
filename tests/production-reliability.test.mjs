import test from 'node:test';
import assert from 'node:assert/strict';
import { boardAgeMinutes, validatePublication, REQUIRED_SPORTS } from '../scripts/production-reliability.mjs';

const coverage = Object.fromEntries(REQUIRED_SPORTS.map(s => [s,{deepSelectedEvents:2,deepSuccessfulEvents:2,deepFailedEvents:0}]));
const now = Date.parse('2026-09-30T02:00:00Z');
const generatedAt = '2026-09-30T01:55:00Z';
const full = {generatedAt,counts:{ACTION:1,WATCH:2},coverageAudit:coverage};
const compact = {generatedAt,counts:{ACTION:1,WATCH:2},actionRows:[{}],watchRows:[{},{}]};
const audit = {status:'OK',failures:[]};

test('board age is calculated from generatedAt', () => assert.equal(boardAgeMinutes(generatedAt, now),5));
test('valid publication passes', () => assert.equal(validatePublication({full,compact,audit,nowMs:now}).ok,true));
test('compact/full mismatch fails closed', () => {
  const bad={...compact,counts:{...compact.counts,WATCH:1}};
  const r=validatePublication({full,compact:bad,audit,nowMs:now});
  assert.equal(r.ok,false); assert.ok(r.errors.some(e=>e.includes('WATCH count mismatch')));
});
test('deep failure blocks publication', () => {
  const badCoverage={...coverage,cs2:{deepSelectedEvents:2,deepSuccessfulEvents:1,deepFailedEvents:1}};
  const r=validatePublication({full:{...full,coverageAudit:badCoverage},compact,audit,nowMs:now});
  assert.equal(r.ok,false); assert.ok(r.errors.some(e=>e.includes('cs2')));
});
test('stale board blocks publication', () => {
  const r=validatePublication({full,compact,audit,nowMs:Date.parse('2026-09-30T02:06:00Z')});
  assert.equal(r.ok,false); assert.ok(r.errors.includes('BOARD TOO OLD FOR PUBLICATION'));
});

test('collector errors block publication even when collector says ok', () => {
  const badAudit={status:'OK',failures:[],degraded:['collector degraded: pinnacle (HTTP 403)']};
  const r=validatePublication({full,compact,audit:badAudit,nowMs:now});
  assert.equal(r.ok,false);
  assert.ok(r.errors.includes('PRODUCTION COVERAGE DEGRADED'));
});

test('required zero-inventory family cannot be treated healthy without explicit enumeration proof', () => {
  const badAudit={status:'OK',failures:[],degraded:[],familyStatus:{team_total:{status:'NO_MARKETS_AVAILABLE',inventory:0,enumerated:false}}};
  const r=validatePublication({full,compact,audit:badAudit,nowMs:now});
  assert.equal(r.ok,false);
  assert.ok(r.errors.some(e=>e.includes('team_total')));
});
