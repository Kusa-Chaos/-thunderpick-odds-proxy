import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const START_URLS = [
  { group: 'esports', url: 'https://thunderpick.io/esports' },
  { group: 'sports', url: 'https://thunderpick.io/sports' }
];
const PROBES = [
  'https://thunderpick.io/sports/american-football/us/nfl/389/carolina-panthers-vs-chicago-bears/2138772',
  'https://thunderpick.io/esports/cs2-betting/thunderpick-world-championship-2026-global-qualifier/10521/hotu-vs-bbl-esports/2648238',
  'https://thunderpick.io/esports/cs2-betting/fissure-playground-3/10205/legacy-vs-g2/2646779'
];

function isEventUrl(href) {
  try {
    const u = new URL(href);
    return u.hostname === 'thunderpick.io' && /\/\d+\/[^/]+\/\d+\/?$/.test(u.pathname);
  } catch { return false; }
}

async function read(page, url) {
  const started = Date.now();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
    const finalUrl = page.url();
    const data = await page.evaluate(() => ({
      title: document.title,
      body: document.body?.innerText || '',
      links: [...document.querySelectorAll('a[href]')].map(a => a.href)
    }));
    const blocked = /betting-not-allowed|not available in your country|betting.*not allowed/i.test(finalUrl + '\n' + data.body);
    return {
      url,
      finalUrl,
      status: response?.status() ?? null,
      ok: !blocked,
      blocked,
      title: data.title,
      durationMs: Date.now() - started,
      body: data.body.slice(0, 40000),
      eventLinks: [...new Set(data.links.filter(isEventUrl))].slice(0, 100)
    };
  } catch (e) {
    return { url, ok:false, blocked:false, durationMs:Date.now()-started, error:String(e?.message || e), body:'', eventLinks:[] };
  }
}

const browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
const context = await browser.newContext({ locale:'en-US', timezoneId:'America/New_York', viewport:{width:1440,height:1200} });
const page = await context.newPage();
const network = [];
page.on('response', async response => {
  const ct = (response.headers()['content-type'] || '').toLowerCase();
  if (!ct.includes('json')) return;
  const url = response.url();
  if (!/thunderpick|odds|event|market|sport/i.test(url)) return;
  try {
    const text = await response.text();
    network.push({ url, status:response.status(), contentType:ct, preview:text.slice(0,12000) });
  } catch {}
});

const masters = [];
for (const target of START_URLS) masters.push({ group:target.group, ...(await read(page, target.url)) });

const discovered = [...new Set(masters.flatMap(m => m.eventLinks || []))];
const probeUrls = [...new Set([...discovered.slice(0,3), ...PROBES])].slice(0,6);
const probes = [];
for (const url of probeUrls) probes.push(await read(page, url));

await browser.close();
const output = {
  generatedAt:new Date().toISOString(),
  source:'Thunderpick rendered by Playwright on GitHub Actions',
  masters,
  discoveredEventLinks:discovered,
  probes,
  networkResponses:network.slice(-100)
};
await fs.mkdir(path.join(process.cwd(),'data'), { recursive:true });
await fs.writeFile(path.join(process.cwd(),'data','latest.json'), JSON.stringify(output,null,2));
console.log(JSON.stringify({ masters:masters.map(m=>({group:m.group,ok:m.ok,blocked:m.blocked,status:m.status,finalUrl:m.finalUrl,events:m.eventLinks?.length,error:m.error})), probes:probes.map(p=>({url:p.url,ok:p.ok,blocked:p.blocked,status:p.status,finalUrl:p.finalUrl,error:p.error})), network:network.length }, null, 2));
