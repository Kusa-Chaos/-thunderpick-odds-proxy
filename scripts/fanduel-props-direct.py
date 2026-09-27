import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from curl_cffi import requests as cffi_requests

FILE = 'data/direct-sources-latest.json'
BASE = 'https://sbapi.nj.sportsbook.fanduel.com/api/content-managed-page'
EVENT_URL = 'https://sbapi.nj.sportsbook.fanduel.com/api/event-page'
API_KEY = 'FhMFpcPWXMeyZxOx'
SPORTS = {'nfl': 'american-football', 'nba': 'basketball', 'mlb': 'baseball'}
NOW = datetime.now(timezone.utc)
MAX_START = NOW + timedelta(days=7)

# Exact two-sided full-game player stats only. Alternate/threshold-only markets are
# intentionally excluded because they are not directly interchangeable with O/U.
STAT_PATTERNS = {
    'american-football': [
        (re.compile(r'PASSING[_ ]YARDS|Passing Yds|Passing Yards', re.I), 'passing_yards', 'Passing Yards'),
        (re.compile(r'RUSHING[_ ]YARDS|Rushing Yds|Rushing Yards', re.I), 'rushing_yards', 'Rushing Yards'),
        (re.compile(r'RECEIVING[_ ]YARDS|Receiving Yds|Receiving Yards', re.I), 'receiving_yards', 'Receiving Yards'),
        (re.compile(r'RECEPTIONS|Total Receptions', re.I), 'receptions', 'Receptions'),
        (re.compile(r'PASSING[_ ]TOUCHDOWNS|Pass(?:ing)? TDs?|Touchdown Passes', re.I), 'passing_touchdowns', 'Passing Touchdowns'),
        (re.compile(r'PASSING[_ ]ATTEMPTS|Pass Attempts', re.I), 'passing_attempts', 'Passing Attempts'),
        (re.compile(r'COMPLETIONS|Pass Completions', re.I), 'completions', 'Completions'),
        (re.compile(r'INTERCEPTIONS|Interceptions Thrown', re.I), 'interceptions', 'Interceptions'),
        (re.compile(r'RUSHING[_ ]ATTEMPTS|Rush Attempts|Carries', re.I), 'rushing_attempts', 'Rushing Attempts'),
    ],
    'basketball': [
        (re.compile(r'POINTS_REBOUNDS_ASSISTS|Points,? Rebounds (?:and|&|\+) Assists|PRA\b', re.I), 'points_rebounds_assists', 'Points + Rebounds + Assists'),
        (re.compile(r'POINTS_REBOUNDS|Points (?:and|&|\+) Rebounds', re.I), 'points_rebounds', 'Points + Rebounds'),
        (re.compile(r'POINTS_ASSISTS|Points (?:and|&|\+) Assists', re.I), 'points_assists', 'Points + Assists'),
        (re.compile(r'REBOUNDS_ASSISTS|Rebounds (?:and|&|\+) Assists', re.I), 'rebounds_assists', 'Rebounds + Assists'),
        (re.compile(r'THREE[_ ]POINTERS|3[- ]?Pointers|Three Pointers|3PT', re.I), 'three_pointers', 'Three Pointers'),
        (re.compile(r'REBOUNDS|Total Rebounds', re.I), 'rebounds', 'Rebounds'),
        (re.compile(r'ASSISTS|Total Assists', re.I), 'assists', 'Assists'),
        (re.compile(r'STEALS|Total Steals', re.I), 'steals', 'Steals'),
        (re.compile(r'BLOCKS|Total Blocks', re.I), 'blocks', 'Blocks'),
        (re.compile(r'TURNOVERS|Total Turnovers', re.I), 'turnovers', 'Turnovers'),
        (re.compile(r'POINTS|Total Points', re.I), 'points', 'Points'),
    ],
    'baseball': [
        (re.compile(r'STRIKEOUTS|Pitcher Strikeouts|Total Strikeouts', re.I), 'strikeouts', 'Strikeouts'),
        (re.compile(r'TOTAL[_ ]BASES|Total Bases', re.I), 'total_bases', 'Total Bases'),
        (re.compile(r'RBIS?|Runs Batted In', re.I), 'rbi', 'RBI'),
        (re.compile(r'WALKS|Bases on Balls|Total Walks', re.I), 'walks', 'Walks'),
        (re.compile(r'HOME[_ ]RUNS|Home Runs', re.I), 'home_runs', 'Home Runs'),
        (re.compile(r'\bHITS\b|Total Hits', re.I), 'hits', 'Hits'),
        (re.compile(r'\bRUNS\b|Runs Scored', re.I), 'runs', 'Runs'),
    ],
}

EXCLUDE = re.compile(
    r'Alternate|\bAlt\b|Drive|Quarter|\b1Q\b|\b2Q\b|\b3Q\b|\b4Q\b|'
    r'1st Half|First Half|2nd Half|Second Half|Longest|Anytime|First Touchdown|'
    r'Last Touchdown|To Score|Touchdown Scorer|Double Result|Race To|Milestone|'
    r'\d+\+',
    re.I
)

def dec(v):
    if v is None:
        return None
    try:
        n = int(str(v).replace('−', '-').replace('+', ''))
    except Exception:
        return None
    if n > 0:
        return 1 + n / 100
    if n < 0:
        return 1 + 100 / abs(n)
    return None

def parse_iso(v):
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace('Z', '+00:00'))
        if not dt.tzinfo:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None

def clean_team(v):
    return re.sub(r'\s*\([^)]*\)\s*$', '', str(v or '')).strip()

def pair(ev):
    name = str(ev.get('name', ''))
    if ' @ ' not in name:
        return None
    away, home = name.split(' @ ', 1)
    return clean_team(home), clean_team(away)

def american(r):
    return dec((((r.get('winRunnerOdds') or {}).get('americanDisplayOdds') or {}).get('americanOdds')))

def request_json(url, params):
    r = cffi_requests.get(
        url,
        params=params,
        impersonate='chrome120',
        headers={'Accept': 'application/json'},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()

def get_board(page):
    return request_json(BASE, {'page': 'CUSTOM', 'customPageId': page, '_ak': API_KEY})

def get_event(eid):
    return request_json(EVENT_URL, {'eventId': eid, 'tab': 'popular', '_ak': API_KEY})

def event_is_live(ev):
    for key in ('inPlay', 'isLive', 'live'):
        if ev.get(key) is True:
            return True
    state = str(ev.get('eventStatus') or ev.get('status') or '').lower()
    return state in {'live', 'inplay', 'in-play', 'started'}

def eligible_event(ev):
    if event_is_live(ev):
        return False
    dt = parse_iso(ev.get('openDate'))
    return bool(dt and dt >= NOW - timedelta(minutes=5) and dt <= MAX_START and pair(ev))

def get_stat(sport, market):
    mt = str(market.get('marketType') or '')
    name = str(market.get('marketName') or '')
    text = f'{mt} {name}'
    if EXCLUDE.search(text):
        return None
    for rx, stat, label in STAT_PATTERNS.get(sport, []):
        if rx.search(text):
            return stat, label
    return None

def side(r):
    typ = str(((r.get('result') or {}).get('type')) or '').upper()
    name = str(r.get('runnerName') or '')
    if typ == 'OVER' or re.search(r'\bOver\b', name, re.I):
        return 'over'
    if typ == 'UNDER' or re.search(r'\bUnder\b', name, re.I):
        return 'under'
    return None

def player_from_market(market, over, under):
    candidates = []
    for r in (over, under):
        name = str(r.get('runnerName') or '').strip()
        name = re.sub(r'\s+(?:Over|Under)(?:\s.*)?$', '', name, flags=re.I).strip(' -')
        if name and name.lower() not in {'over', 'under'}:
            candidates.append(name)
    if candidates and all(c.lower() == candidates[0].lower() for c in candidates):
        return candidates[0]

    name = str(market.get('marketName') or '').strip()
    if ' - ' in name:
        left = name.split(' - ', 1)[0].strip()
        if left and not EXCLUDE.search(left):
            return left
    return None

def normalize_prop(sport, market):
    info = get_stat(sport, market)
    if not info:
        return None
    stat, stat_label = info
    runners = [
        r for r in (market.get('runners') or [])
        if r.get('runnerStatus') in (None, 'ACTIVE') and r.get('isPlayerSelection') is True
    ]
    over = next((r for r in runners if side(r) == 'over'), None)
    under = next((r for r in runners if side(r) == 'under'), None)
    if not over or not under:
        return None
    try:
        lo = float(over.get('handicap'))
        lu = float(under.get('handicap'))
    except Exception:
        return None
    if abs(lo - lu) > 1e-9:
        return None
    line = lo
    oo, uo = american(over), american(under)
    if not (oo and uo and 1.01 < oo < 20 and 1.01 < uo < 20):
        return None
    inv = 1 / oo + 1 / uo
    if inv < 0.90 or inv > 1.15:
        return None
    player = player_from_market(market, over, under)
    if not player:
        return None

    return {
        'key': f'player_{stat}',
        'name': f'Player {player} - {stat_label}',
        'title': str(market.get('marketName') or stat_label),
        'description': player,
        'player': player,
        'specifiers': f'player={quote(player)}|stat={stat}|threshold={line}',
        'scope': {'map': None, 'round': None, 'set': None, 'period': 'full'},
        'line': line,
        'last_update': None,
        'outcomes': [
            {'name': f'Over {line}', 'price': oo, 'point': line, 'description': player, 'player': player},
            {'name': f'Under {line}', 'price': uo, 'point': line, 'description': player, 'player': player},
        ],
    }

with open(FILE, 'r', encoding='utf-8') as f:
    out = json.load(f)

health = {
    'ok': False,
    'status': None,
    'acceptedEvents': 0,
    'eventPageRequests': 0,
    'eventPageErrors': 0,
    'marketCount': 0,
    'playerPropMarkets': 0,
    'bySport': {},
    'byStat': {},
    'errors': [],
    'fetchedAt': NOW.isoformat(),
}

for page, sport in SPORTS.items():
    hs = health['bySport'][sport] = {
        'boardEvents': 0,
        'eligibleEvents': 0,
        'eventPages': 0,
        'eventsWithProps': 0,
        'playerProps': 0,
        'byStat': {},
    }
    try:
        board = get_board(page)
        events = {
            str(k): v for k, v in (board.get('attachments', {}).get('events', {}) or {}).items()
            if eligible_event(v)
        }
        hs['boardEvents'] = len((board.get('attachments', {}).get('events', {}) or {}))
        hs['eligibleEvents'] = len(events)

        results = {}
        with ThreadPoolExecutor(max_workers=min(8, max(1, len(events)))) as pool:
            futs = {pool.submit(get_event, eid): eid for eid in events}
            for fut in as_completed(futs):
                eid = futs[fut]
                health['eventPageRequests'] += 1
                try:
                    results[eid] = fut.result()
                    hs['eventPages'] += 1
                except Exception as exc:
                    health['eventPageErrors'] += 1
                    health['errors'].append(f'{sport}:{eid}: {type(exc).__name__}: {exc}')

        arr = out['sports'][sport].setdefault('exactV2', [])
        arr[:] = [e for e in arr if not str(e.get('id', '')).startswith(f'fanduel-props-direct:{sport}:')]

        for eid, page_data in results.items():
            ev = events.get(eid)
            p = pair(ev or {})
            if not p:
                continue
            home, away = p
            markets = []
            seen = set()
            for m in (page_data.get('attachments', {}).get('markets', {}) or {}).values():
                prop = normalize_prop(sport, m)
                if not prop:
                    continue
                sig = (prop['key'], prop['player'].lower(), prop['line'])
                if sig in seen:
                    continue
                seen.add(sig)
                markets.append(prop)
                stat = prop['key'][7:]
                health['marketCount'] += 1
                health['playerPropMarkets'] += 1
                health['byStat'][stat] = health['byStat'].get(stat, 0) + 1
                hs['playerProps'] += 1
                hs['byStat'][stat] = hs['byStat'].get(stat, 0) + 1

            if not markets:
                continue
            rec = {
                'id': f'fanduel-props-direct:{sport}:{eid}',
                'home_team': home,
                'away_team': away,
                'commence_time': ev.get('openDate'),
                'live': False,
                'bookmakers': [{'key': 'fanduel-direct', 'title': 'FanDuel Direct', 'markets': markets}],
            }
            arr.append(rec)
            health['acceptedEvents'] += 1
            hs['eventsWithProps'] += 1

        out['sports'][sport]['exactV2EventCount'] = len(arr)
    except Exception as exc:
        health['errors'].append(f'{sport}: {type(exc).__name__}: {exc}')

health['ok'] = health['acceptedEvents'] > 0 and health['playerPropMarkets'] > 0
health['status'] = 200 if health['ok'] else 500
health['errors'] = health['errors'][:30]
health['fetchedAt'] = datetime.now(timezone.utc).isoformat()
out.setdefault('providerHealth', {})['fanduelProps'] = health
out['generatedAt'] = health['fetchedAt']

with open(FILE, 'w', encoding='utf-8') as f:
    json.dump(out, f, indent=2)

print('FANDUEL_PROPS_HEALTH', json.dumps(health, separators=(',', ':')))
