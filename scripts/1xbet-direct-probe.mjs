const URLS = [
  'https://1xbet.com/en/esports/real',
  'https://1xbet.com/en/line'
];

function classify(status, text, contentType='') {
  const s = String(text || '').toLowerCase();
  if (status === 203) return 'BLOCKED_203';
  if (status === 401 || status === 403) return `BLOCKED_${status}`;
  if (/captcha|cloudflare|challenge-platform|cf-chl|verify you are human|access denied/.test(s)) return 'CAPTCHA_OR_CHALLENGE';
  if (status >= 200 && status < 300 && s.length > 500) return 'ACCESS_OK';
  return `HTTP_${status}`;
}

const results=[];
for (const url of URLS) {
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.8',
        'user-agent': 'Mozilla/5.0 (compatible; ThunderpickOddsProxy/1.0; +public-access-probe)'
      },
      signal: AbortSignal.timeout(30000)
    });
    const text = await r.text();
    const classification = classify(r.status, text, r.headers.get('content-type') || '');
    results.push({url,finalUrl:r.url,status:r.status,classification,contentType:r.headers.get('content-type'),bytes:text.length,hasEsports:/cs\s?2|dota\s?2|league of legends|valorant/i.test(text),hasOdds:/odds|coefficient|handicap|total|winner/i.test(text)});
  } catch (e) {
    results.push({url,classification:'REQUEST_ERROR',error:String(e?.message || e)});
  }
}
console.log('1XBET_DIRECT_PROBE', JSON.stringify({generatedAt:new Date().toISOString(),results}));
if (!results.some(x => x.classification === 'ACCESS_OK')) process.exitCode = 2;
