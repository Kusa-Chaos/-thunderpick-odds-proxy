import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// GitHub secrets can accidentally include copied line breaks or surrounding spaces.
// Owls expects the API key as one continuous Bearer token, so normalize whitespace.
const API_KEY = (process.env.OWLS_API_KEY || '').replace(/\s+/g, '');
if (!API_KEY) {
  console.error('OWLS_API_KEY is not configured.');
  process.exit(2);
}

const SPORTS = [
  'american-football',
  'baseball',
  'basketball',
  'cs2',
  'dota2',
  'lol',
  'soccer',
  'tennis',
  'valorant'
];

const BASE = 'https://api.owlsinsight.com/api/v2/thunderpick';
const outDir = path.join(process.cwd(), 'data');
const outPath = path.join(outDir, 'owls-latest.json');
const metaPath = path.join(outDir, 'owls-meta.json');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readPreviousMeta() {
  try {
    return JSON.parse(await fs.readFile(metaPath, 'utf8'));
  } catch {
    return null;
  }
}

function stableHash(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function toEvents(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.events)) return payload.events;
  if (payload?.data && typeof payload.data === 'object') return Object.values(payload.data);
  return [];
}

function eventCount(payload) {
  return toEvents(payload).length;
}

function compactSelection(selection = {}) {
  return {
    name: selection.name ?? null,
    type: selection.type ?? null,
    odds: selection.odds ?? null
  };
}

function compactMarketSide(side = {}) {
  return {
    name: side.name ?? null,
    odds: side.odds ?? null
  };
}

function compactEvent(event = {}) {
  const preferredMarkets = Array.isArray(event.preferredMarkets)
    ? event.preferredMarkets
        .filter((market) => /winner/i.test(`${market?.nickName || ''} ${market?.name || ''}`))
        .slice(0, 3)
        .map((market) => ({
          name: market?.name ?? null,
          nickName: market?.nickName ?? null,
          selections: Array.isArray(market?.selections)
            ? market.selections.map(compactSelection)
            : []
        }))
    : [];

  const market = event?.market
    ? {
        home: compactMarketSide(event.market.home),
        away: compactMarketSide(event.market.away)
      }
    : null;

  return {
    id: event.id ?? null,
    name: event.name ?? null,
    startTime: event.startTime ?? null,
    isLive: Boolean(event.isLive),
    status: event.status ?? null,
    league: event?.league ? { id: event.league.id ?? null, name: event.league.name ?? null } : null,
    tournament: event?.tournament ? { id: event.tournament.id ?? null, name: event.tournament.name ?? null } : null,
    teams: {
      home: { name: event?.teams?.home?.name ?? market?.home?.name ?? null },
      away: { name: event?.teams?.away?.name ?? market?.away?.name ?? null }
    },
    market,
    preferredMarkets
  };
}

const previousMeta = await readPreviousMeta();
const snapshots = {};
const metaSports = {};
const failures = [];

for (const sport of SPORTS) {
  const url = `${BASE}/${encodeURIComponent(sport)}`;
  console.log(`Fetching Thunderpick ${sport}...`);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(30000)
    });

    const raw = await response.text();
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = { raw };
    }

    const hash = stableHash(body);
    const old = previousMeta?.sports?.[sport];
    const fetchedAt = new Date().toISOString();
    const compactEvents = toEvents(body).map(compactEvent);
    const summary = {
      ok: response.ok,
      status: response.status,
      fetchedAt,
      etag: response.headers.get('etag'),
      eventCount: compactEvents.length,
      hash,
      changedSincePrevious: old ? old.hash !== hash : true
    };

    snapshots[sport] = {
      ...summary,
      data: { data: compactEvents }
    };
    metaSports[sport] = summary;

    if (!response.ok) {
      failures.push({ sport, status: response.status });
    }
  } catch (error) {
    const record = {
      ok: false,
      status: null,
      fetchedAt: new Date().toISOString(),
      error: String(error?.message || error),
      eventCount: 0,
      hash: null,
      changedSincePrevious: false
    };
    snapshots[sport] = { ...record, data: { data: [] } };
    metaSports[sport] = record;
    failures.push({ sport, error: record.error });
  }

  // Bench allows 20 req/min. This keeps us comfortably below that ceiling.
  await sleep(3500);
}

const changedSports = SPORTS.filter((s) => snapshots[s]?.changedSincePrevious);
const generatedAt = new Date().toISOString();
const output = {
  generatedAt,
  source: 'Owls Insight Thunderpick Source API v2',
  format: 'compact-v1',
  requestCountThisRun: SPORTS.length,
  requestedSports: SPORTS,
  successfulSports: SPORTS.filter((s) => snapshots[s]?.ok),
  failedSports: failures,
  changedSports,
  sports: snapshots
};

await fs.mkdir(outDir, { recursive: true });
const serialized = JSON.stringify(output);
await fs.writeFile(outPath, serialized);

const meta = {
  generatedAt,
  source: output.source,
  format: output.format,
  snapshotBytes: Buffer.byteLength(serialized),
  requestCountThisRun: SPORTS.length,
  requestedSports: SPORTS,
  successfulSports: output.successfulSports,
  failedSports: failures,
  changedSports,
  totalEvents: SPORTS.reduce((sum, sport) => sum + (metaSports[sport]?.eventCount || 0), 0),
  sports: metaSports
};
await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

console.log(`Saved ${SPORTS.length} compact Thunderpick sport snapshots.`);
console.log(`Snapshot bytes: ${meta.snapshotBytes}`);
console.log(`Changed sports: ${changedSports.join(', ') || 'none'}`);
if (failures.length) {
  console.error(`Failures: ${JSON.stringify(failures)}`);
  process.exitCode = 1;
}
