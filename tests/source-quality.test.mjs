import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeQuoteTimestamp,
  filterFreshConsensusQuotes,
  orientNamedTwoWayPrices,
} from '../scripts/source-quality.mjs';

const NOW = Date.parse('2026-09-30T19:40:00Z');

test('safeQuoteTimestamp never treats cutoffAt as a quote update time', () => {
  const fallback = '2026-09-30T19:39:00Z';
  const ts = safeQuoteTimestamp({ cutoffAt: '2026-10-01T00:10:00Z' }, fallback);
  assert.equal(ts, Date.parse(fallback));
});

test('future quote timestamp is excluded from ACTION source count', () => {
  const quotes = [
    { sourceFamily: 'pinnacle', pB: 0.68, lastUpdate: '2026-09-30T21:10:00Z' },
    { sourceFamily: 'bovada', pB: 0.42, lastUpdate: '2026-09-30T19:39:00Z' },
    { sourceFamily: 'fanduel', pB: 0.421, lastUpdate: '2026-09-30T19:39:30Z' },
  ];
  const out = filterFreshConsensusQuotes(quotes, { side: 'b', now: NOW });
  assert.deepEqual(out.accepted.map(x => x.sourceFamily).sort(), ['bovada', 'fanduel']);
  assert.equal(out.rejected.find(x => x.quote.sourceFamily === 'pinnacle')?.reason, 'future-timestamp');
});

test('stale quote timestamp is excluded from ACTION source count', () => {
  const quotes = [
    { sourceFamily: 'pinnacle', pA: 0.50, lastUpdate: '2026-09-30T16:00:00Z' },
    { sourceFamily: 'bovada', pA: 0.49, lastUpdate: '2026-09-30T19:39:00Z' },
    { sourceFamily: 'fanduel', pA: 0.51, lastUpdate: '2026-09-30T19:39:30Z' },
  ];
  const out = filterFreshConsensusQuotes(quotes, { side: 'a', now: NOW, maxAgeMs: 2 * 3600e3 });
  assert.deepEqual(out.accepted.map(x => x.sourceFamily).sort(), ['bovada', 'fanduel']);
  assert.equal(out.rejected.find(x => x.quote.sourceFamily === 'pinnacle')?.reason, 'stale-timestamp');
});

test('provider fetchedAt may supply freshness when quote update time is absent', () => {
  const quotes = [
    { sourceFamily: 'bovada', pA: 0.49 },
    { sourceFamily: 'fanduel', pA: 0.51 },
  ];
  const out = filterFreshConsensusQuotes(quotes, {
    side: 'a',
    now: NOW,
    providerFetchedAt: {
      bovada: '2026-09-30T19:38:00Z',
      fanduel: '2026-09-30T19:38:30Z',
    },
  });
  assert.equal(out.accepted.length, 2);
  assert.equal(out.rejected.length, 0);
});

test('two-way decimal prices derive vig-free probabilities before WATCH freshness filtering', () => {
  const quotes = [
    { sourceFamily: 'pinnacle', a: 1.77, b: 2.19, lastUpdate: '2026-10-01T02:00:00Z' },
    { sourceFamily: 'bovada', a: 1.78, b: 2.07 },
    { sourceFamily: 'fanduel', a: 1.79, b: 2.08 },
  ];
  const out = filterFreshConsensusQuotes(quotes, {
    side: 'b',
    now: NOW,
    providerFetchedAt: {
      pinnacle: '2026-09-30T19:39:00Z',
      bovada: '2026-09-30T19:39:00Z',
      fanduel: '2026-09-30T19:39:00Z',
    },
  });
  assert.deepEqual(out.accepted.map(x => x.sourceFamily).sort(), ['bovada', 'fanduel']);
  assert.equal(out.rejected.find(x => x.quote.sourceFamily === 'pinnacle')?.reason, 'future-timestamp');
  assert.ok(out.accepted.every(x => x.pA > 0 && x.pA < 1 && x.pB > 0 && x.pB < 1));
});

test('large three-source probability outlier is quarantined before ACTION promotion', () => {
  const quotes = [
    { sourceFamily: 'pinnacle', pB: 0.686, lastUpdate: '2026-09-30T19:39:00Z' },
    { sourceFamily: 'bovada', pB: 0.420, lastUpdate: '2026-09-30T19:39:00Z' },
    { sourceFamily: 'fanduel', pB: 0.421, lastUpdate: '2026-09-30T19:39:00Z' },
  ];
  const out = filterFreshConsensusQuotes(quotes, { side: 'b', now: NOW, maxDeviation: 0.12 });
  assert.deepEqual(out.accepted.map(x => x.sourceFamily).sort(), ['bovada', 'fanduel']);
  assert.equal(out.rejected.find(x => x.quote.sourceFamily === 'pinnacle')?.reason, 'probability-outlier');
});

test('coherent three-source probabilities remain eligible', () => {
  const quotes = [
    { sourceFamily: 'pinnacle', pA: 0.48, lastUpdate: '2026-09-30T19:39:00Z' },
    { sourceFamily: 'bovada', pA: 0.50, lastUpdate: '2026-09-30T19:39:00Z' },
    { sourceFamily: 'fanduel', pA: 0.51, lastUpdate: '2026-09-30T19:39:00Z' },
  ];
  const out = filterFreshConsensusQuotes(quotes, { side: 'a', now: NOW, maxDeviation: 0.12 });
  assert.equal(out.accepted.length, 3);
  assert.equal(out.rejected.length, 0);
});

test('ambiguous two-way outcomes are not positionally assigned to home and away', () => {
  const prices = [{ price: -150 }, { price: +130 }];
  const participants = [{ id: 1, name: 'Home Team' }, { id: 2, name: 'Away Team' }];
  const oriented = orientNamedTwoWayPrices(prices, participants, { home: participants[0], away: participants[1] });
  assert.equal(oriented, null);
});

test('participant ids can safely orient two-way outcomes', () => {
  const prices = [
    { participantId: 2, price: +130 },
    { participantId: 1, price: -150 },
  ];
  const participants = [{ id: 1, name: 'Home Team' }, { id: 2, name: 'Away Team' }];
  const oriented = orientNamedTwoWayPrices(prices, participants, { home: participants[0], away: participants[1] });
  assert.deepEqual(oriented.map(x => x.name), ['Away Team', 'Home Team']);
});
