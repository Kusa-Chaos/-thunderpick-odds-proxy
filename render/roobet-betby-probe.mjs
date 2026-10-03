import http from 'node:http';

const PORT = Number(process.env.PORT || 10000);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const cases = [
  ['roobet-prematch','https://api-g-c7818b61-607.sptpub.com/api/v4/prematch/brand/2186449803775455232/en/0'],
  ['roobet-live','https://api-g-c7818b61-607.sptpub.com/api/v4/live/brand/2186449803775455232/en/0']
];

async function probe() {
  const out = [];
  for (const [name, url] of cases) {
    try {
      const r = await fetch(url, {
        headers: {
          Origin: 'https://roobet.com',
          Referer: 'https://roobet.com/',
          'User-Agent': UA,
          Accept: 'application/json'
        },
        redirect: 'manual'
      });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      out.push({
        name,
        status: r.status,
        ok: r.ok,
        contentType: r.headers.get('content-type'),
        keys: json && typeof json === 'object' ? Object.keys(json) : null,
        topEventsVersions: Array.isArray(json?.top_events_versions) ? json.top_events_versions.slice(0,5) : null,
        restEventsVersions: Array.isArray(json?.rest_events_versions) ? json.rest_events_versions.slice(0,5) : null,
        bodyHead: text.slice(0,300)
      });
    } catch (error) {
      out.push({ name, error: error?.message || String(error) });
    }
  }
  return { probe: 'roobet-betby', fetchedAt: new Date().toISOString(), results: out };
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'content-type':'application/json'});
    return res.end(JSON.stringify({ok:true}));
  }
  if (req.url !== '/' && req.url !== '/probe') {
    res.writeHead(404, {'content-type':'application/json'});
    return res.end(JSON.stringify({error:'not found'}));
  }
  const result = await probe();
  res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(result));
});

server.listen(PORT, '0.0.0.0', () => console.log(`roobet betby probe listening on ${PORT}`));
