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
    event?.away,
    event?.name,
    event?.tournament
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
    text.includes('simulation') ||
    text.includes('madden nfl')
  );
}

function getEventId(event, index, page) {
  return String(
    event?.eventId ??
    event?.id ??
    event?._id ??
    `${page}-${index}-${event?.home || ''}-${event?.away || ''}-${event?.startTime || ''}`
  );
}

function compactEvent(event) {
  return {
    eventId:
      event?.eventId ??
      event?.id ??
      event?._id ??
      null,
    startTime:
      event?.startTime ??
      event?.start ??
      event?.date ??
      null,
    status:
      event?.status ??
      event?.state ??
      null,
    live:
      event?.live ??
      event?.isLive ??
      null,
    league:
      event?.league ??
      event?.tournament ??
      event?.competition ??
      null,
    home:
      event?.home ??
      event?.homeTeam ??
      event?.participant1 ??
      null,
    away:
      event?.away ??
      event?.awayTeam ??
      event?.participant2 ??
      null,
    moreInfo: event?.moreInfo ?? null,
    markets:
      event?.markets ??
      event?.odds ??
      event?.betOffers ??
      null
  };
}

function toText(payload) {
  const lines = [];

  lines.push('THUNDERPICK SCAN FEED');
  lines.push(`source=${payload.source}`);
  lines.push(`proxyFetchedAt=${payload.proxyFetchedAt}`);
  lines.push(`sport=${payload.sport}`);
  lines.push(`mode=${payload.mode}`);
  lines.push(`pagesFetched=${payload.pagesFetched}`);
  lines.push(`rawEvents=${payload.rawEventCount}`);
  lines.push(`virtualExcluded=${payload.virtualExcluded}`);
  lines.push(`uniqueReturned=${payload.returnedEventCount}`);
  lines.push(`terminalReason=${payload.terminalReason}`);
  lines.push(`rateLimited=${payload.rateLimited}`);
  lines.push('');

  payload.events.forEach((event, index) => {
    lines.push(`EVENT ${index + 1}`);
    lines.push(`eventId=${event.eventId ?? ''}`);
    lines.push(`startTime=${event.startTime ?? ''}`);
    lines.push(`status=${event.status ?? ''}`);
    lines.push(`live=${event.live ?? ''}`);
    lines.push(`league=${event.league ?? ''}`);
    lines.push(`home=${event.home ?? ''}`);
    lines.push(`away=${event.away ?? ''}`);

    if (event.moreInfo) {
      lines.push(`moreInfo=${JSON.stringify(event.moreInfo)}`);
    }

    if (event.markets) {
      lines.push(`markets=${JSON.stringify(event.markets)}`);
    }

    lines.push('');
  });

  return lines.join('\n');
}

async function fetchPulsePage({
  apiKey,
  sport,
  mode,
  eventId,
  page,
  limit
}) {
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
    const error = new Error('PulseScore returned non-JSON');
    error.status = 502;
    throw error;
  }

  return {
    ok: upstream.ok,
    status: upstream.status,
    data
  };
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

  const realOnly =
    String(req.query.realOnly || '0') === '1';

  const scanAll =
    String(req.query.scanAll || '0') === '1';

  const textMode =
    String(req.query.format || '').toLowerCase() === 'text';

  const maxPages = clamp(
    req.query.maxPages,
    1,
    40,
    20
  );

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    // Preserve original single-page/event behavior
    if (!scanAll || eventId) {
      const result = await fetchPulsePage({
        apiKey,
        sport,
        mode,
        eventId,
        page,
        limit
      });

      if (!result.ok) {
        return res.status(result.status).json({
          error: 'PulseScore request failed',
          upstreamStatus: result.status,
          upstream: result.data
        });
      }

      const data = result.data;

      let virtualExcluded = 0;

      const rawEventCount = Array.isArray(data.events)
        ? data.events.length
        : eventId
          ? 1
          : 0;

      if (
        sport === 'esports' &&
        realOnly &&
        Array.isArray(data.events)
      ) {
        data.events = data.events.filter((event) => {
          const virtual = isVirtualEsport(event);
          if (virtual) virtualExcluded += 1;
          return !virtual;
        });
      }

      return res.status(200).json({
        ...data,
        proxyFetchedAt: new Date().toISOString(),
        source: 'LIVE THUNDERPICK FEED via PulseScore',
        rawEventCount,
        virtualExcluded,
        returnedEventCount: Array.isArray(data.events)
          ? data.events.length
          : rawEventCount
      });
    }

    // Scanner aggregation mode
    const uniqueEvents = new Map();

    let totalRaw = 0;
    let virtualExcluded = 0;
    let pagesFetched = 0;
    let terminalReason = 'maxPages reached';
    let rateLimited = false;
    let previousIds = null;

    for (let currentPage = 1; currentPage <= maxPages; currentPage++) {
      const result = await fetchPulsePage({
        apiKey,
        sport,
        mode,
        eventId: null,
        page: currentPage,
        limit
      });

      if (result.status === 429) {
        rateLimited = true;
        terminalReason =
          `429 rate limit reached before page ${currentPage}`;
        break;
      }

      if (!result.ok) {
        terminalReason =
          `upstream error ${result.status} on page ${currentPage}`;
        break;
      }

      pagesFetched += 1;

      const events = Array.isArray(result.data?.events)
        ? result.data.events
        : [];

      totalRaw += events.length;

      if (events.length === 0) {
        terminalReason =
          `empty page ${currentPage}`;
        break;
      }

      const currentIds = events.map((event, index) =>
        getEventId(event, index, currentPage)
      );

      if (
        previousIds &&
        currentIds.length === previousIds.length &&
        currentIds.every((id, i) => id === previousIds[i])
      ) {
        terminalReason =
          `page ${currentPage} repeated previous page`;
        break;
      }

      previousIds = currentIds;

      for (let i = 0; i < events.length; i++) {
        const event = events[i];

        if (
          sport === 'esports' &&
          realOnly &&
          isVirtualEsport(event)
        ) {
          virtualExcluded += 1;
          continue;
        }

        const id = getEventId(
          event,
          i,
          currentPage
        );

        if (!uniqueEvents.has(id)) {
          uniqueEvents.set(
            id,
            compactEvent(event)
          );
        }
      }

      if (events.length < limit) {
        terminalReason =
          `short final page ${currentPage}: ${events.length}/${limit}`;
        break;
      }
    }

    const events = [...uniqueEvents.values()];

    const payload = {
      source: 'LIVE THUNDERPICK FEED via PulseScore',
      proxyFetchedAt: new Date().toISOString(),
      sport,
      mode,
      pagesFetched,
      rawEventCount: totalRaw,
      virtualExcluded,
      returnedEventCount: events.length,
      terminalReason,
      rateLimited,
      events
    };

    if (textMode) {
      res.setHeader(
        'Content-Type',
        'text/plain; charset=utf-8'
      );

      return res
        .status(200)
        .send(toText(payload));
    }

    return res
      .status(200)
      .json(payload);

  } catch (error) {
    return res.status(
      error?.status || 502
    ).json({
      error: 'Proxy request failed',
      message:
        error?.message || 'Unknown error'
    });
  }
};
