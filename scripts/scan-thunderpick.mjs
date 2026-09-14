import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const START_URLS = [
  { group: 'esports', name: 'master', url: 'https://thunderpick.io/esports' },
  { group: 'sports', name: 'master', url: 'https://thunderpick.io/sports' }
];

const SYNTHETIC = /(e-?soccer|e-?basketball|madden|efootball|virtual|simulation|simulated|random match|creator)/i;
const REAL_ESPORT = /(cs2|counter-strike|league of legends|\blol\b|dota|valorant|rainbow six|rocket league|call of duty|overwatch|pubg|apex|mobile legends|mlbb|wild rift|arena of valor|starcraft|warcraft)/i;

function looksLikeEventUrl(href) {
  try {
    const u = new URL(href);
    return u.hostname === 'thunderpick.io' && /\/\d+\/[^/]+\/\d+\/?$/.test(u.pathname);
  } catch { return false; }
}

async function expand(page) {
  for (let r = 0; r < 10; r++) {
    const buttons = page.getByText('Show more', { exact: true });
    const n = await buttons.count().catch(() => 0);
    let clicks = 0;
    for (let i = 0; i < Math.min(n, 20); i++) {
      const b = buttons.nth(i);
      if (await b.isVisible().catch(() => false)) {
        await b.click({ timeout: 1200 }).catch(() => {});
        clicks++;
        await page.waitForTimeout(150);
      }
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(clicks ? 700 : 350);
  }
}

async function readPage(page, url) {
  const started = Date.now();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    const finalUrl = page.url();
    const firstText = await page.locator('body').innerText().catch(() => '');
    const blocked = /betting-not-allowed|not available in your country|betting.*not allowed/i.test(finalUrl + '\n' + firstText);
    if (!blocked) await expand(page);
    const data = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href]')].map(a => {
        let node = a;
        let context = (a.innerText || '').trim();
        for (let i = 0; i < 5 && node?.parentElement; i++) {
          node = node.parentElement;
          const t = (node.innerText || '').trim();
          if (t.length >= 20 && t.length <= 1500) context = t;
          if (t.length > 1500) break;
        }
        return { href: a.href, text: (a.innerText || '').trim(), context };
      });
      return { title: document.title, body: document.body?.innerText || '', links };
    });
    return {
      ok: !blocked,
      blocked,
      status: resp?.status() ?? null,
      url,
      finalUrl,
      title: data.title,
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      body: data.body.slice(0, 50000),
      links: data.links
    };
  } catch (e) {
    return { ok: false, blocked: false, url, fetchedAt: new Date().toISOString(), durationMs: Date.now()-started, error: String(e?.message || e), body: '', links: [] };
  }
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const context = await browser.newContext({
  locale: 'en-US',
  timezoneId: 'America/New_York',
  viewport: { width: 1440, height: 1400 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
});
const page = await context.newPage();

const masters = [];
const eventMap = new Map();

for (const target of START_URLS) {
  console.log(`MASTER ${target.group}: ${target.url}`);
  const result = await readPage(page, target.url);
  masters.push({ ...target, ...result });
  for (const l of result.links || []) {
    if (!looksLikeEventUrl(l.href)) continue;
    const ctx = (l.context || '').replace(/\s+/g,' ').trim();
    const synthetic = SYNTHETIC.test(ctx + ' ' + l.href);
    if (!eventMap.has(l.href)) eventMap.set(l.href, { url: l.href, context: ctx, synthetic, discoveredFrom: [target.group] });
    else eventMap.get(l.href).discoveredFrom.push(target.group);
  }
}

let events = [...eventMap.values()].filter(e => !e.synthetic);
// Genuine esports first, then other esports, then sports. Keep the run bounded.
events.sort((a,b) => {
  const ae = a.url.includes('/esports/');
  const be = b.url.includes('/esports/');
  if (ae !== be) return ae ? -1 : 1;
  const ar = REAL_ESPORT.test(a.context + ' ' + a.url);
  const br = REAL_ESPORT.test(b.context + ' ' + b.url);
  if (ar !== br) return ar ? -1 : 1;
  return a.url.localeCompare(b.url);
});

const MAX_EVENTS = Number(process.env.MAX_EVENTS || 220);
events = events.slice(0, MAX_EVENTS);
const details = [];

for (let i = 0; i < events.length; i++) {
  const e = events[i];
  console.log(`EVENT ${i+1}/${events.length}: ${e.url}`);
  const result = await readPage(page, e.url);
  details.push({ ...e, ...result, links: undefined });
  await page.waitForTimeout(250);
}

await browser.close();

const output = {
  generatedAt: new Date().toISOString(),
  source: 'Thunderpick rendered by Playwright on GitHub Actions',
  masterSummary: masters.map(m => ({ group:m.group, ok:m.ok, blocked:m.blocked, status:m.status, finalUrl:m.finalUrl, title:m.title, fetchedAt:m.fetchedAt, durationMs:m.durationMs, bodyPreview:m.body?.slice(0,12000) })),
  discoveredEventCount: eventMap.size,
  scannedEventCount: details.length,
  eventDetails: details.map(d => ({
    url:d.url,
    discoveredFrom:d.discoveredFrom,
    context:d.context,
    ok:d.ok,
    blocked:d.blocked,
    status:d.status,
    finalUrl:d.finalUrl,
    title:d.title,
    fetchedAt:d.fetchedAt,
    durationMs:d.durationMs,
    body:d.body?.slice(0,30000),
    error:d.error || null
  }))
};

await fs.mkdir(path.join(process.cwd(),'data'), { recursive:true });
await fs.writeFile(path.join(process.cwd(),'data','latest.json'), JSON.stringify(output,null,2));
console.log(`DONE discovered=${output.discoveredEventCount} scanned=${output.scannedEventCount}`);
