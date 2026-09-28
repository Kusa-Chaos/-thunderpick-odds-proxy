import fs from 'node:fs/promises';

const readJson = async (path, fallback = {}) => {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch { return fallback; }
};

const board = await readJson('data/simple-opportunity-latest.json', {});
const audit = await readJson('data/production-coverage-audit-latest.json', {});
const rows = Array.isArray(board.rows) ? board.rows : [];

const actions = rows.filter(r => r.tier === 'ACTION');
const watches = rows.filter(r => r.tier === 'WATCH');
const screening = rows.filter(r => r.tier === 'SCREENING')
  .sort((a,b) => (b.estimatedEV ?? -99) - (a.estimatedEV ?? -99) || (b.independentSources ?? 0) - (a.independentSources ?? 0))
  .slice(0, 12);

function displayRow(r) {
  const outside = Array.isArray(r.outside) ? r.outside.map(o => ({
    sourceFamily: o.sourceFamily ?? null,
    book: o.book ?? o.title ?? o.source ?? o.provider ?? o.name ?? null,
    price: o.price ?? o.odds ?? o.decimal ?? null,
    lastUpdate: o.lastUpdate ?? o.fetchedAt ?? null
  })) : [];
  const bestOutside = outside.reduce((best,o) => {
    const p = Number(o.price);
    return Number.isFinite(p) && (best == null || p > best) ? p : best;
  }, null);
  return {
    tier: r.tier,
    sport: r.sport,
    eventId: r.eventId ?? null,
    match: r.match ?? null,
    target: r.target ?? null,
    side: r.side ?? null,
    market: r.market ?? null,
    marketKey: r.marketKey ?? null,
    line: r.line ?? null,
    scope: r.scope ?? null,
    state: r.state ?? null,
    settlementScope: r.settlementScope ?? null,
    identity: r.identity ?? null,
    identityKey: r.identityKey ?? null,
    identityComplete: r.identityComplete === true,
    thunderpick: r.thunderpick ?? null,
    outside,
    bestOutside,
    independentSources: r.independentSources ?? 0,
    estimatedEV: r.estimatedEV ?? null,
    startTime: r.startTime ?? null,
    blocker: r.blocker ?? null
  };
}

const identityErrors = rows.filter(r => (r.tier === 'ACTION' || r.tier === 'WATCH') && r.identityComplete !== true).length;
const priceErrors = rows.filter(r => (r.tier === 'ACTION' || r.tier === 'WATCH' || r.tier === 'SCREENING') && !Number.isFinite(Number(r.thunderpick))).length;

const out = {
  generatedAt: board.generatedAt ?? null,
  builtAt: new Date().toISOString(),
  mode: 'compact-results-delivery-v1',
  counts: board.counts ?? {},
  parseErrors: { identity: identityErrors, price: priceErrors },
  sourceHealth: board.sourceHealth ?? null,
  coverageAudit: board.coverageAudit ?? {},
  productionCoverageStatus: audit.status ?? null,
  productionCoverageFailures: audit.failures ?? [],
  actionRows: actions.map(displayRow),
  watchRows: watches.map(displayRow),
  screeningRows: screening.map(displayRow)
};

await fs.writeFile('data/simple-opportunity-display-latest.json', JSON.stringify(out, null, 2));
console.log('RESULTS_DISPLAY', {generatedAt:out.generatedAt, action:out.actionRows.length, watch:out.watchRows.length, screening:out.screeningRows.length, parseErrors:out.parseErrors});