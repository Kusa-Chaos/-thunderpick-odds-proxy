import fs from 'node:fs/promises';
import path from 'node:path';

const API_KEY = (process.env.OWLS_API_KEY || '').replace(/\s+/g, '');
if (!API_KEY) throw new Error('OWLS_API_KEY missing');

const base = 'https://api.owlsinsight.com';
const probes = [
  ['stake-cs2', '/api/v2/stake/cs2'],
  ['pinnacle-esports-leagues', '/api/v2/pinnacle/esports/leagues'],
  ['bet105-esports-leagues', '/api/v2/bet105/esports/leagues'],
  ['betus-esports-leagues', '/api/v2/betus/esports/leagues'],
  ['polymarket-cs2-leagues', '/api/v2/polymarket/cs2/leagues'],
  ['polymarket-lol-leagues', '/api/v2/polymarket/lol/leagues'],
  ['polymarket-dota2-leagues', '/api/v2/polymarket/dota2/leagues'],
  ['polymarket-valorant-leagues', '/api/v2/polymarket/valorant/leagues'],
  ['kalshi-cs2-leagues', '/api/v2/kalshi/cs2/leagues'],
  ['kalshi-lol-leagues', '/api/v2/kalshi/lol/leagues'],
  ['kalshi-dota2-leagues', '/api/v2/kalshi/dota2/leagues'],
  ['kalshi-valorant-leagues', '/api/v2/kalshi/valorant/leagues']
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(route) {
  const r = await fetch(base + route, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: r.status, ok: r.ok, body };
}

const result = { generatedAt: new Date().toISOString(), probes: {} };
for (const [name, route] of probes) {
  console.log(`PROBE ${name}`);
  try {
    const x = await get(route);
    const b = x.body;
    result.probes[name] = {
      route,
      status: x.status,
      ok: x.ok,
      count: b?.count ?? (Array.isArray(b?.data) ? b.data.length : null),
      meta: b?.meta ?? null,
      leagues: b?.leagues ?? b?.data?.leagues ?? null,
      dataPreview: b?.data ? JSON.stringify(b.data).slice(0, 4000) : null,
      error: x.ok ? null : b
    };
  } catch (e) {
    result.probes[name] = { route, status: null, ok: false, error: String(e?.message || e) };
  }
  await sleep(3300);
}

await fs.mkdir(path.join(process.cwd(),'data'), { recursive:true });
await fs.writeFile(path.join(process.cwd(),'data','owls-source-probe.json'), JSON.stringify(result,null,2));
console.log('Saved data/owls-source-probe.json');
