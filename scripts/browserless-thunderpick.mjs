import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.BROWSERLESS_TOKEN;
if (!TOKEN) throw new Error('BROWSERLESS_TOKEN is required');

const START_URL = 'https://thunderpick.io/esports';
const SECOND_URL = 'https://thunderpick.io/sports';
const BLOCKED_RE = /(sorry, you have been blocked|attention required!|betting-not-allowed|not available in your country|betting.*not allowed)/i;
const SYNTHETIC_RE = /(e-?soccer|e-?basketball|madden|efootball|virtual|simulation|simulated|random match|creator)/i;

function appendToken(ws) {
  return `${ws}${ws.includes('?') ? '&' : '?'}token=${encodeURIComponent(TOKEN)}`;
}

function isEventUrl(href) {
  try {
    const u = new URL(href);
    return u.hostname === 'thunderpick.io' && /\/\d+\/[^/]+\/\d+\/?$/.test(u.pathname);
  } catch { return false; }
}

async function snapshot(page, label) {
  await page.waitForTimeout(1200);
  const result = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    text: document.body?.innerText || '',
    links: [...document.querySelectorAll('a[href]')].map(a => ({ href:a.href, text:(a.innerText || '').trim() }))
  }));
  const eventLinks = [];
  const seen = new Set();
  for (const l of result.links) {
    if (!isEventUrl(l.href) || seen.has(l.href)) continue;
    seen.add(l.href);
    if (SYNTHETIC_RE.test(`${l.text} ${l.href}`)) continue;
    eventLinks.push(l.href);
  }
  return {
    label,
    fetchedAt:new Date().toISOString(),
    title:result.title,
    url:result.url,
    blocked:BLOCKED_RE.test(`${result.title}\n${result.text}\n${result.url}`),
    text:result.text.slice(0,60000),
    eventLinks:eventLinks.slice(0,500)
  };
}

const unblockUrl = `https://production-sfo.browserless.io/unblock?token=${encodeURIComponent(TOKEN)}&proxy=residential&proxyCountry=us`;
const unblockResponse = await fetch(unblockUrl, {
  method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({ url:START_URL, browserWSEndpoint:true, ttl:60000 })
});
if (!unblockResponse.ok) throw new Error(`Browserless unblock HTTP ${unblockResponse.status}: ${await unblockResponse.text()}`);
const unblock = await unblockResponse.json();
if (!unblock.browserWSEndpoint) throw new Error(`Browserless did not return browserWSEndpoint: ${JSON.stringify(unblock).slice(0,1000)}`);

const browser = await chromium.connectOverCDP(appendToken(unblock.browserWSEndpoint));
const context = browser.contexts()[0];
const pages = context.pages();
const page = pages[0] || await context.newPage();

// Keep residential bandwidth low after the initial Cloudflare-unblock navigation.
await page.route('**/*', route => {
  const type = route.request().resourceType();
  if (['image','media','font'].includes(type)) return route.abort();
  return route.continue();
});

const network = [];
page.on('response', async response => {
  const ct = (response.headers()['content-type'] || '').toLowerCase();
  const u = response.url();
  if (!ct.includes('json') && !/api|graphql|event|market|odds|sport/i.test(u)) return;
  try {
    const text = await response.text();
    network.push({ url:u, status:response.status(), contentType:ct, bodyPreview:text.slice(0,20000) });
  } catch {}
});

const snapshots = [];
snapshots.push(await snapshot(page, 'esports-unblocked'));

await page.goto(SECOND_URL, { waitUntil:'domcontentloaded', timeout:30000 });
snapshots.push(await snapshot(page, 'sports'));

// Reload esports after response listeners are attached so we can discover hidden JSON/XHR feeds.
await page.goto(START_URL, { waitUntil:'domcontentloaded', timeout:30000 });
snapshots.push(await snapshot(page, 'esports-network-capture'));

const discoveredEvents = [...new Set(snapshots.flatMap(s => s.eventLinks || []))];
const exact = [];
for (const url of discoveredEvents.slice(0,3)) {
  try {
    await page.goto(url, { waitUntil:'domcontentloaded', timeout:30000 });
    exact.push(await snapshot(page, `exact-${exact.length+1}`));
  } catch (e) {
    exact.push({ url, error:String(e?.message || e) });
  }
}

await browser.close();

const output = {
  generatedAt:new Date().toISOString(),
  source:'Browserless /unblock + US residential proxy + GitHub Actions',
  snapshots,
  discoveredEventCount:discoveredEvents.length,
  discoveredEvents:discoveredEvents.slice(0,1000),
  exact,
  networkResponses:network.slice(-200)
};

await fs.mkdir(path.join(process.cwd(),'data'), {recursive:true});
await fs.writeFile(path.join(process.cwd(),'data','browserless-latest.json'), JSON.stringify(output,null,2));
console.log(JSON.stringify({
  generatedAt:output.generatedAt,
  snapshots:snapshots.map(s => ({label:s.label,title:s.title,url:s.url,blocked:s.blocked,eventLinks:s.eventLinks.length})),
  exact:exact.map(e => ({url:e.url,title:e.title,blocked:e.blocked,error:e.error})),
  networkResponses:network.length
}, null, 2));
