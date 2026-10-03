import hashlib
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import http.cookiejar
from datetime import datetime, timezone

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36'
DISCOVERY = {
    'lol': 'https://gg.bet/en-is/next-to-go?hoursAhead=48&sportId=esports_league_of_legends',
    'dota2': 'https://gg.bet/en-is/next-to-go?hoursAhead=48&sportId=esports_dota_2',
}
OBJECTIVE_RE = re.compile(
    r'race to kills|first blood|destroy first tower|first tower|first baron|kill first baron|first dragon|kill first dragon|kill first roshan|first roshan|first barrack|first barracks|total kills|total towers|total barons|total dragons|total roshans|total barracks',
    re.I,
)
EXCLUDE_RE = re.compile(
    r'win map.*total kills|total kills odd\s*/\s*even|kills handicap|kill maker|ultra kill|first dragon type|baron type|both teams',
    re.I,
)
BETTING_DATA_QUERY = 'query GetBettingData { bettingData { token endpoint: publicServiceUrl } }'
EVENT_QUERY = '''query GGObjectiveMatch($slug: String!) {
  match: sportEventBySlug(slug: $slug) {
    id
    slug
    fixture {
      title
      status
      startTime
      sportId
      competitors { id: masterId name homeAway }
    }
    markets(statuses: [ACTIVE]) {
      id
      name
      status
      typeId
      priority
      settlementRules
      specifiers { name value }
      meta { name value }
      odds { id name value isActive status competitorIds }
    }
  }
}'''


def extract_slugs(page_html):
    return sorted(set(re.findall(r'/esports/match/([a-z0-9-]+)', page_html or '', re.I)))


def is_objective_market(name):
    text = str(name or '')
    return bool(OBJECTIVE_RE.search(text)) and not bool(EXCLUDE_RE.search(text))


def sport_key(value):
    key = str(value or '').lower()
    if key == 'esports_league_of_legends':
        return 'lol'
    if key == 'esports_dota_2':
        return 'dota2'
    return None


def _persisted_payload(operation_name, query, variables=None, include_query=False):
    item = {
        'operationName': operation_name,
        'variables': variables or {},
        'extensions': {
            'persistedQuery': {
                'version': 1,
                'sha256Hash': hashlib.sha256(query.encode()).hexdigest(),
            }
        },
    }
    if include_query:
        item['query'] = query
    return [item]


def _new_opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)), jar


def _fetch_text(opener, url):
    req = urllib.request.Request(url, headers={
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/json',
        'Accept-Language': 'en-US,en;q=0.9',
    })
    with opener.open(req, timeout=30) as response:
        return response.status, response.read().decode('utf-8', 'replace')


def _next_env(body):
    match = re.search(r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', body or '', re.I | re.S)
    if not match:
        return None
    root = json.loads(html.unescape(match.group(1)))
    wanted = {'PUBLIC_CMS_GQL_CLIENT_ENDPOINT', 'BETTING_APP_ID_HEADER', 'BETTING_ACCESS_TOKEN'}
    stack = [root]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            if wanted.issubset(value.keys()):
                return value
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    return None


def _resolve(raw, page_url):
    host = urllib.parse.urlparse(page_url).netloc
    value = str(raw or '').replace('{host}', host)
    if value.startswith('//'):
        return 'https:' + value
    if value.startswith('/'):
        return urllib.parse.urljoin(page_url, value)
    return value


def _post_json(opener, url, headers, query, variables=None):
    payload = json.dumps({'query': query, 'variables': variables or {}}).encode()
    req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
    try:
        with opener.open(req, timeout=35) as response:
            text = response.read().decode('utf-8', 'replace')
            return response.status, json.loads(text)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode('utf-8', 'replace')
        raise RuntimeError(f'HTTP {exc.code} {url} {body[:300]}') from exc


def _post_persisted_json(opener, url, headers, operation_name, query, variables=None):
    def send(include_query):
        payload = json.dumps(_persisted_payload(operation_name, query, variables, include_query=include_query)).encode()
        req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
        try:
            with opener.open(req, timeout=35) as response:
                text = response.read().decode('utf-8', 'replace')
                decoded = json.loads(text)
                if not isinstance(decoded, list) or not decoded:
                    raise RuntimeError('GG.BET batched GraphQL response was not a non-empty array')
                return response.status, decoded[0]
        except urllib.error.HTTPError as exc:
            body = exc.read().decode('utf-8', 'replace')
            raise RuntimeError(f'HTTP {exc.code} {url} {body[:300]}') from exc

    status, payload = send(False)
    errors = payload.get('errors') or [] if isinstance(payload, dict) else []
    persisted_missing = any(
        str((e.get('extensions') or {}).get('code') or '').upper() == 'PERSISTED_QUERY_NOT_FOUND'
        or str(e.get('message') or '').replace(' ', '').lower() == 'persistedquerynotfound'
        for e in errors if isinstance(e, dict)
    )
    if persisted_missing:
        return send(True)
    return status, payload


def _client_headers(env, referer, auth_token=None, batching=False):
    headers = {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Origin': 'https://gg.bet',
        'Referer': referer,
        'X-Gc-Locale': 'en',
        'X-Requested-With': 'XMLHttpRequest',
        'X-App-Id': str(env.get('BETTING_APP_ID_HEADER') or ''),
        'X-App-Access-Token': str(env.get('BETTING_ACCESS_TOKEN') or ''),
    }
    if auth_token:
        headers['X-Auth-Token'] = auth_token
    if batching:
        headers['X-Batching'] = 'true'
    return headers


def _bootstrap(opener, env, page_url):
    cms = _resolve(env.get('PUBLIC_CMS_GQL_CLIENT_ENDPOINT'), page_url)
    status, payload = _post_json(opener, cms, _client_headers(env, page_url), BETTING_DATA_QUERY)
    data = (payload.get('data') or {}).get('bettingData') or {}
    endpoint = _resolve(data.get('endpoint'), page_url)
    token = data.get('token')
    if status != 200 or not endpoint or not token:
        raise RuntimeError('GG.BET betting bootstrap missing endpoint/token')
    return endpoint.rstrip('/') + '/graphql', token


def _fetch_event(opener, betting_url, token, env, slug):
    status, payload = _post_persisted_json(
        opener,
        betting_url,
        _client_headers(env, f'https://gg.bet/esports/match/{slug}', token, batching=True),
        'GGObjectiveMatch',
        EVENT_QUERY,
        {'slug': slug},
    )
    if status != 200 or payload.get('errors'):
        raise RuntimeError(f'GG.BET event query failed for {slug}: {payload.get("errors")}')
    match = (payload.get('data') or {}).get('match')
    if not match:
        return None
    sport = sport_key((match.get('fixture') or {}).get('sportId'))
    if not sport:
        return None
    fixture_status = str((match.get('fixture') or {}).get('status') or '').upper()
    if fixture_status in {'FINISHED', 'ENDED', 'CANCELLED', 'CANCELED'}:
        return None
    match['markets'] = [m for m in (match.get('markets') or []) if str(m.get('status') or '').upper() == 'ACTIVE' and is_objective_market(m.get('name'))]
    return sport, match


def lambda_handler(event, context):
    generated_at = datetime.now(timezone.utc).isoformat()
    out = {
        'generatedAt': generated_at,
        'connected': False,
        'sports': {'lol': {'events': []}, 'dota2': {'events': []}},
        'errors': [],
        'discovery': {'lol': 0, 'dota2': 0},
        'fetched': {'selected': 0, 'successful': 0, 'failed': 0, 'objectiveMarkets': 0},
    }
    try:
        opener, _ = _new_opener()
        pages = {}
        env = None
        for sport, url in DISCOVERY.items():
            status, body = _fetch_text(opener, url)
            if status != 200:
                raise RuntimeError(f'GG.BET discovery {sport} HTTP {status}')
            pages[sport] = body
            if env is None:
                env = _next_env(body)
        if env is None:
            _, home = _fetch_text(opener, 'https://gg.bet/')
            env = _next_env(home)
        if env is None:
            raise RuntimeError('GG.BET __NEXT_DATA__ public environment not found')
        betting_url, token = _bootstrap(opener, env, DISCOVERY['lol'])
        out['connected'] = True
        selections = []
        for sport, body in pages.items():
            slugs = extract_slugs(body)
            out['discovery'][sport] = len(slugs)
            for slug in slugs:
                selections.append((sport, slug))
        seen = set()
        selections = [(s, slug) for s, slug in selections if not (slug in seen or seen.add(slug))]
        out['fetched']['selected'] = len(selections)
        for expected_sport, slug in selections:
            fetched = None
            last_error = None
            for attempt in range(2):
                try:
                    fetched = _fetch_event(opener, betting_url, token, env, slug)
                    last_error = None
                    break
                except Exception as exc:
                    last_error = exc
                    if attempt == 0:
                        time.sleep(0.2)
            if last_error is not None:
                out['fetched']['failed'] += 1
                out['errors'].append(f'{slug}: {last_error}')
                continue
            if not fetched:
                continue
            sport, match = fetched
            if sport != expected_sport:
                out['errors'].append(f'{slug}: sport mismatch {expected_sport}->{sport}')
                out['fetched']['failed'] += 1
                continue
            out['fetched']['successful'] += 1
            objective_count = len(match.get('markets') or [])
            out['fetched']['objectiveMarkets'] += objective_count
            if objective_count:
                out['sports'][sport]['events'].append(match)
    except Exception as exc:
        out['errors'].append(str(exc))
    out['errors'] = list(dict.fromkeys(out['errors']))[:20]
    return out
