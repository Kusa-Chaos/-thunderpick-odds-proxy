import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const API_KEY = process.env.OWLS_API_KEY;
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

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readPrevious() {
  try {
    return JSON.parse(await fs.readFile(outPath, 'utf8'));
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

function eventCount(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload?.data)) return payload.data.length;
  if (Array.isArray(payload?.events)) return payload.events.length;
  if (payload?.data && typeof payload.data === 'object') {
    return Object.keys(payload.data).length;
  }
  return null;
}

const previous = await readPrevious();
const snapshots = {};
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
    const old = previous?.sports?.[sport];

    snapshots[sport] = {
      ok: response.ok,
      status: response.status,
      fetchedAt: new Date().toISOString(),
      etag: response.headers.get('etag'),
      eventCount: eventCount(body),
      hash,
      changedSincePrevious: old ? old.hash !== hash : true,
      data: body
    };

    if (!response.ok) {
      failures.push({ sport, status: response.status, body });
    }
  } catch (error) {
    const record = {
      ok: false,
      status: null,
      fetchedAt: new Date().toISOString(),
      error: String(error?.message || error),
      eventCount: null,
      hash: null,
      changedSincePrevious: false,
      data: null
    };
    snapshots[sport] = record;
    failures.push({ sport, error: record.error });
  }

  // Bench allows 20 req/min. This keeps us comfortably below that ceiling.
  await sleep(3500);
}

const changedSports = SPORTS.filter((s) => snapshots[s]?.changedSincePrevious);
const output = {
  generatedAt: new Date().toISOString(),
  source: 'Owls Insight Thunderpick Source API v2',
  requestCountThisRun: SPORTS.length,
  requestedSports: SPORTS,
  successfulSports: SPORTS.filter((s) => snapshots[s]?.ok),
  failedSports: failures,
  changedSports,
  sports: snapshots
};

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(outPath, JSON.stringify(output, null, 2));

console.log(`Saved ${SPORTS.length} Thunderpick sport snapshots.`);
console.log(`Changed sports: ${changedSports.join(', ') || 'none'}`);
if (failures.length) {
  console.error(`Failures: ${JSON.stringify(failures)}`);
  process.exitCode = 1;
}
