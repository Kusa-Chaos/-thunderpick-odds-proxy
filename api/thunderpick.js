const ALLOWED_SPORTS = new Set([
  'soccer',
  'basketball',
  'tennis',
  'table-tennis',
  'cricket',
  'american-football',
  'australian-rules',
  'badminton',
  'baseball',
  'darts',
  'esports',
  'ice-hockey',
  'martial-arts',
  'rugby',
  'volleyball'
]);

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function isVirtualEsport(event) {
  const text = [
    event?.moreInfo?.esport,
    event?.league,
    event?.home,
    event?.away
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    text.includes('esoccer') ||
    text.includes('ebasketball') ||
    text.includes('esim') ||
    text.includes('virtual') ||
    text.includes('simulated') ||
    text.includes('simulation')
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  const apiKey =
    process.env.PULSESCORE_API_KEY ||
    process.env.PULSESCORE_KEY ||
    process.env.PULSE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'PulseScore API key is not configured on Vercel'
    });
  }

  const sport = String(req.query.sport || '').toLowerCase();

  if (!ALLOWED_SPORTS.has(sport)) {
    return res.status(400).json({
      error: 'Unsupported sport',
      allowedSports: [...ALLOWED_SPORTS]
    });
  }

  const mode = String(req.query.mode || 'upcoming').toLowerCase();
  const eventId = req.query.eventId
    ? String(req.query.eventId)
    : null;

  const page = clamp(req.query.page, 1, 1000, 1);
  const limit = clamp(req.query.limit, 1, 30, 30);

  let path;

  if (eventId && mode === 'live') {
    path = `/live-events/events/${encodeURIComponent(eventId)}`;
  } else if (eventId) {
    path =
      `/${encodeURIComponent(sport)}/events/` +
      encodeURIComponent(eventId);
  } else if (mode === 'live') {
    path =
      `/live-events?sport=${encodeURIComponent(sport)}` +
      `&page=${page}&limit=${limit}`;
  } else {
    path =
      `/${encodeURIComponent(sport)}/events` +
      `?page=${page}&limit=${limit}`;
  }

  const url =
    `https://api.pulsescore.net/api/thunderpick${path}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        'X-Secret': apiKey,
        'Accept-Encoding': 'gzip',
        Accept: 'application/json'
      }
    });

    const raw = await upstream.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: 'PulseScore returned a non-JSON response',
        upstreamStatus: upstream.status
      });
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: 'PulseScore request failed',
        upstreamStatus: upstream.status,
        upstream: data
      });
    }

    let virtualExcluded = 0;
    const rawEventCount = Array.isArray(data.events)
      ? data.events.length
      : 0;

    if (
      sport === 'esports' &&
      String(req.query.realOnly || '0') === '1' &&
      Array.isArray(data.events)
    ) {
      const realEvents = data.events.filter((event) => {
        const virtual = isVirtualEsport(event);
        if (virtual) virtualExcluded += 1;
        return !virtual;
      });

      data.events = realEvents;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    return res.status(200).json({
      ...data,
      proxyFetchedAt: new Date().toISOString(),
      source: 'LIVE THUNDERPICK FEED via PulseScore',
      rawEventCount,
      virtualExcluded,
      returnedEventCount: Array.isArray(data.events)
        ? data.events.length
        : 0
    });
  } catch (error) {
    return res.status(502).json({
      error: 'Proxy request failed',
      message: error?.message || 'Unknown error'
    });
  }
};
