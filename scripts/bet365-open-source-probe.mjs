import { chromium } from "playwright";
import fs from "node:fs/promises";

const URL = process.env.BET365_URL || "https://www.bet365.com/#/IP/B1";
const HEADLESS = process.env.BET365_HEADLESS === "1";
const RUN_MS = Number(process.env.BET365_RUN_MS || 90000);
const OUT = process.env.BET365_OUT || "data/bet365-open-source-probe-latest.json";

const state = {
  source: "bet365-open-source-websocket",
  mode: "experimental-read-only",
  url: URL,
  startedAt: new Date().toISOString(),
  websocketCount: 0,
  frames: 0,
  ovInPlayFrames: 0,
  sampleSports: {},
  events: [],
  errors: []
};

function fields(s) {
  const o = {};
  for (const p of s.split(";")) {
    const i = p.indexOf("=");
    if (i > 0) o[p.slice(0, i)] = p.slice(i + 1);
  }
  return o;
}

function parseOvInPlay(payload) {
  if (typeof payload !== "string" || !payload.includes("OVInPlay")) return;
  state.ovInPlayFrames++;
  for (const block of payload.split("|CL;").slice(1)) {
    const cl = fields(block.split("|")[0]);
    const sportId = cl.ID || cl.CD;
    if (!sportId) continue;
    state.sampleSports[sportId] = (state.sampleSports[sportId] || 0) + 1;
    for (const ev of block.split("|EV;").slice(1)) {
      const head = fields(ev.split("|")[0]);
      const ma = ev.includes("|MA;") ? fields(ev.split("|MA;")[1].split("|")[0]) : {};
      const id = head.ID || ma.ID;
      const name = head.NA || ma.NA;
      if (id || name) state.events.push({ sportId, id: id || null, name: name || null, score: ma.SS || head.SS || null });
    }
  }
  const seen = new Set();
  state.events = state.events.filter(x => {
    const k = x.id || x.sportId + "|" + x.name;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 5000);
}

const browser = await chromium.launch({ headless: HEADLESS });
const context = await browser.newContext({
  locale: "en-US",
  viewport: { width: 1440, height: 1000 }
});
const page = await context.newPage();

page.on("websocket", ws => {
  state.websocketCount++;
  ws.on("framereceived", evt => {
    state.frames++;
    try {
      const p = typeof evt.payload === "string" ? evt.payload : evt.payload?.toString?.();
      parseOvInPlay(p);
    } catch (e) {
      state.errors.push("frame: " + String(e));
    }
  });
});

page.on("pageerror", e => state.errors.push("page: " + String(e)));

try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(RUN_MS);
} catch (e) {
  state.errors.push("navigation: " + String(e));
} finally {
  state.finishedAt = new Date().toISOString();
  state.eventCount = state.events.length;
  await fs.mkdir(OUT.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(state, null, 2));
  console.log(JSON.stringify({
    source: state.source,
    websocketCount: state.websocketCount,
    frames: state.frames,
    ovInPlayFrames: state.ovInPlayFrames,
    eventCount: state.eventCount,
    sports: state.sampleSports,
    errors: state.errors
  }, null, 2));
  await browser.close();
}
