function norm(v='') {
  return String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sourceFamily(v='') {
  const x = String(v || '').toLowerCase();
  if (x.includes('unibet') || x.includes('kambi')) return 'unibet-kambi';
  if (x.includes('stake') || x.includes('oddin')) return 'stake-oddin';
  if (x.includes('draftkings')) return 'draftkings';
  if (x.includes('fanduel')) return 'fanduel';
  if (x.includes('caesars')) return 'caesars';
  if (x.includes('betmgm')) return 'betmgm';
  if (x.includes('bovada')) return 'bovada';
  if (x.includes('pinnacle')) return 'pinnacle';
  if (x.includes('betway')) return 'betway';
  if (x.includes('kalshi')) return 'kalshi';
  if (x.includes('polymarket')) return 'polymarket';
  return x.replace(/[^a-z0-9]/g, '') || 'unknown';
}

function decimal(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n > 1 && n < 100) return n;
  if (n >= 100) return 1 + n / 100;
  if (n <= -100) return 1 + 100 / Math.abs(n);
  return null;
}

function withTwoWayProbabilities(q = {}) {
  const haveA = Number(q.pA) > 0 && Number(q.pA) < 1;
  const haveB = Number(q.pB) > 0 && Number(q.pB) < 1;
  if (haveA && haveB) return q;
  const a = decimal(q.a), b = decimal(q.b);
  if (!(a > 1 && b > 1)) return q;
  const ia = 1 / a, ib = 1 / b, z = ia + ib;
  if (!(z > 0)) return q;
  return { ...q, a, b, pA: ia / z, pB: ib / z };
}

export function safeQuoteTimestamp(quote = {}, providerFallback = null) {
  // Deliberately exclude event/market cutoff times. cutoffAt is when betting closes,
  // not when the price was observed, and may legitimately be in the future.
  for (const v of [quote.updatedAt, quote.lastUpdate, quote.last_update, quote.fetchedAt, providerFallback]) {
    if (v == null || v === '') continue;
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

export function orientNamedTwoWayPrices(prices = [], participants = [], pair = {}) {
  if (!Array.isArray(prices) || prices.length !== 2) return null;
  const byId = new Map((participants || []).filter(Boolean).map(p => [String(p.id), p.name]));
  const homeName = pair?.home?.name || pair?.home || null;
  const awayName = pair?.away?.name || pair?.away || null;
  if (!homeName || !awayName) return null;
  const homeNorm = norm(homeName), awayNorm = norm(awayName);
  const rows = [];

  for (const p of prices) {
    const price = decimal(p?.price ?? p?.odds ?? p?.decimalOdds);
    if (!(price > 1 && Number.isFinite(price))) return null;
    const participantId = p?.participantId ?? p?.participant?.id;
    let name = participantId != null ? byId.get(String(participantId)) : null;
    const explicitName = p?.participantName || p?.participant?.name || p?.name || null;
    if (!name && explicitName) {
      const n = norm(explicitName);
      if (n === homeNorm) name = homeName;
      else if (n === awayNorm) name = awayName;
    }
    if (!name) {
      const designation = String(p?.designation || p?.alignment || '').toLowerCase();
      if (/^(home|team1|side1)$/.test(designation)) name = homeName;
      else if (/^(away|team2|side2)$/.test(designation)) name = awayName;
    }
    if (!name) return null;
    rows.push({
      name: String(name),
      price,
      point: Number.isFinite(Number(p?.point ?? p?.points ?? p?.handicap ?? p?.total)) ? Number(p?.point ?? p?.points ?? p?.handicap ?? p?.total) : undefined,
    });
  }

  const names = rows.map(r => norm(r.name));
  if (new Set(names).size !== 2 || !names.includes(homeNorm) || !names.includes(awayNorm)) return null;
  return rows;
}

function median(values = []) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function filterFreshConsensusQuotes(quotes = [], options = {}) {
  const {
    side = 'a',
    now = Date.now(),
    providerFetchedAt = {},
    maxAgeMs = 2 * 3600e3,
    maxFutureMs = 5 * 60e3,
    maxDeviation = 0.12,
  } = options;
  const probKey = String(side).toLowerCase() === 'b' ? 'pB' : 'pA';
  const fresh = [];
  const rejected = [];
  const seen = new Set();

  for (const q0 of quotes || []) {
    const fam = sourceFamily(q0?.sourceFamily || q0?.book || q0?.title || q0?.source || q0?.provider || q0?.name || '');
    if (!fam || seen.has(fam)) continue;
    seen.add(fam);
    const q = withTwoWayProbabilities({ ...q0, sourceFamily: fam });
    const fallback = providerFetchedAt?.[fam] ?? null;
    const ts = safeQuoteTimestamp(q, fallback);
    if (ts == null) {
      rejected.push({ quote: q, reason: 'missing-timestamp' });
      continue;
    }
    if (ts > now + maxFutureMs) {
      rejected.push({ quote: q, reason: 'future-timestamp', timestamp: ts });
      continue;
    }
    if (ts < now - maxAgeMs) {
      rejected.push({ quote: q, reason: 'stale-timestamp', timestamp: ts });
      continue;
    }
    const p = Number(q?.[probKey]);
    if (!(p > 0 && p < 1)) {
      rejected.push({ quote: q, reason: 'missing-probability', timestamp: ts });
      continue;
    }
    fresh.push({ ...q, qualityTimestamp: new Date(ts).toISOString() });
  }

  if (fresh.length < 3) return { accepted: fresh, rejected };
  const med = median(fresh.map(q => Number(q[probKey])));
  const accepted = [];
  for (const q of fresh) {
    if (Math.abs(Number(q[probKey]) - med) > maxDeviation) rejected.push({ quote: q, reason: 'probability-outlier' });
    else accepted.push(q);
  }
  return { accepted, rejected, medianProbability: med };
}
