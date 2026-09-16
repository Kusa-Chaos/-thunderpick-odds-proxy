import fs from 'node:fs/promises';
import path from 'node:path';

const API_KEY = (process.env.OWLS_API_KEY || '').trim();
if (!API_KEY) throw new Error('OWLS_API_KEY missing');

const sports = ['cs2','dota2','lol','valorant'];
const base = 'https://api.owlsinsight.com/api/v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: r.status, ok: r.ok, body };
}

const out = { generatedAt: new Date().toISOString(), sports: {} };
for (const sport of sports) {
  console.log(`Testing ${sport} unified odds...`);
  const odds = await get(`${base}/${sport}/odds`);
  await sleep(3200);
  console.log(`Testing ${sport} Thunderpick EV...`);
  const ev = await get(`${base}/${sport}/ev?min_ev=0.25&book=thunderpick`);
  await sleep(3200);
  out.sports[sport] = {
    oddsStatus: odds.status,
    oddsMeta: odds.body?.meta || null,
    oddsDataPreview: odds.body?.data ? JSON.stringify(odds.body.data).slice(0, 12000) : null,
    evStatus: ev.status,
    evMeta: ev.body?.meta || null,
    evData: ev.body?.data || null,
    evRaw: ev.body?.data ? null : ev.body
  };
}

await fs.mkdir(path.join(process.cwd(),'data'), { recursive:true });
await fs.writeFile(path.join(process.cwd(),'data','owls-v1-test.json'), JSON.stringify(out,null,2));
console.log('Saved data/owls-v1-test.json');
