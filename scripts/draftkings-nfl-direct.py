import json
import re
from datetime import datetime, timezone
from urllib.parse import quote
from curl_cffi import requests as cffi_requests

FILE = 'data/direct-sources-latest.json'
LEAGUE_ID = 88808
LEAGUE_URL = f'https://sportsbook-nash.draftkings.com/api/sportscontent/dkusnj/v1/leagues/{LEAGUE_ID}'
SUBCAT_URL = 'https://sportsbook-nash.draftkings.com/api/sportscontent/dkusnj/v1/leagues/{league}/categories/{category}/subcategories/{subcategory}'

NFL_FULL = {
    'Cardinals':'Arizona Cardinals','Falcons':'Atlanta Falcons','Ravens':'Baltimore Ravens','Bills':'Buffalo Bills',
    'Panthers':'Carolina Panthers','Bears':'Chicago Bears','Bengals':'Cincinnati Bengals','Browns':'Cleveland Browns',
    'Cowboys':'Dallas Cowboys','Broncos':'Denver Broncos','Lions':'Detroit Lions','Packers':'Green Bay Packers',
    'Texans':'Houston Texans','Colts':'Indianapolis Colts','Jaguars':'Jacksonville Jaguars','Chiefs':'Kansas City Chiefs',
    'Raiders':'Las Vegas Raiders','Chargers':'Los Angeles Chargers','Rams':'Los Angeles Rams','Dolphins':'Miami Dolphins',
    'Vikings':'Minnesota Vikings','Patriots':'New England Patriots','Saints':'New Orleans Saints','Giants':'New York Giants',
    'Jets':'New York Jets','Eagles':'Philadelphia Eagles','Steelers':'Pittsburgh Steelers','49ers':'San Francisco 49ers',
    'Seahawks':'Seattle Seahawks','Buccaneers':'Tampa Bay Buccaneers','Titans':'Tennessee Titans','Commanders':'Washington Commanders'
}

STAT_PATTERNS = [
    (re.compile(r'Passing Yards', re.I), 'passing_yards', 'Passing Yards'),
    (re.compile(r'Rushing Yards', re.I), 'rushing_yards', 'Rushing Yards'),
    (re.compile(r'Receiving Yards', re.I), 'receiving_yards', 'Receiving Yards'),
    (re.compile(r'Receptions', re.I), 'receptions', 'Receptions'),
    (re.compile(r'(?:Pass TDs|Passing Touchdowns?|Touchdown Passes)', re.I), 'passing_touchdowns', 'Passing Touchdowns'),
]
EXCLUDE_SCOPE = re.compile(r'1Q|Quarter|1st Half|First Half|2nd Half|Second Half|Drive|Longest|Alt\b', re.I)

def dec(a):
    if a is None: return None
    try: n = int(str(a).replace('−','-').replace('+',''))
    except: return None
    if n > 0: return 1 + n/100
    if n < 0: return 1 + 100/abs(n)
    return None

def canon_team(raw):
    s = str(raw or '').strip()
    for nick, full in NFL_FULL.items():
        if re.search(rf'\b{re.escape(nick)}$', s, re.I): return full
    return s

def parse_pair(name):
    if ' @ ' not in str(name): return None
    away, home = [x.strip() for x in str(name).split(' @ ',1)]
    return canon_team(home), canon_team(away)

def stat_from(text):
    for rx, stat, label in STAT_PATTERNS:
        if rx.search(text): return stat, label, rx
    return None

def clean_player(market_name, rx):
    s = rx.sub(' ', market_name)
    s = re.sub(r'\bO/U\b|\bOver/Under\b|\bTotal\b', ' ', s, flags=re.I)
    s = re.sub(r'\s+-\s+.*$', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip(' -')
    return s or None

def get_json(url):
    r = cffi_requests.get(url, impersonate='chrome120', timeout=20, headers={'Accept':'application/json'})
    r.raise_for_status()
    return r.json()

with open(FILE, 'r', encoding='utf-8') as f:
    out = json.load(f)
arr = out['sports']['american-football'].setdefault('exactV2', [])
arr[:] = [e for e in arr if not str(e.get('id','')).startswith('draftkings-nfl-direct:')]

health = {'ok':False,'status':None,'categories':0,'selectedSubcategories':0,'requests':0,'acceptedEvents':0,'marketCount':0,'playerPropMarkets':0,'byStat':{},'errors':[],'fetchedAt':datetime.now(timezone.utc).isoformat()}
try:
    league = get_json(LEAGUE_URL)
    categories = {str(c.get('id')): c for c in league.get('categories', [])}
    subs = league.get('subcategories', [])
    health['categories'] = len(subs)
    selected = []
    for sc in subs:
        name = str(sc.get('name',''))
        if EXCLUDE_SCOPE.search(name): continue
        if not stat_from(name): continue
        cid, sid = sc.get('categoryId'), sc.get('id')
        if cid is None or sid is None: continue
        selected.append((str(cid), str(sid), name))
    # de-dupe exact subcategory ids
    seen=set(); selected=[x for x in selected if not (x[1] in seen or seen.add(x[1]))]
    health['selectedSubcategories'] = len(selected)
    events = {}
    for cid, sid, subname in selected:
        try:
            health['requests'] += 1
            data = get_json(SUBCAT_URL.format(league=LEAGUE_ID, category=cid, subcategory=sid))
            evs = {str(e.get('id')):e for e in data.get('events',[]) if e.get('id') is not None}
            sels_by_market = {}
            for s in data.get('selections',[]): sels_by_market.setdefault(str(s.get('marketId')), []).append(s)
            for m in data.get('markets',[]):
                mid = str(m.get('id')); eid = str(m.get('eventId'))
                ev = evs.get(eid)
                if not ev: continue
                pair = parse_pair(ev.get('name'))
                if not pair: continue
                home, away = pair
                mname = str(m.get('name',''))
                if EXCLUDE_SCOPE.search(mname): continue
                info = stat_from(mname) or stat_from(subname)
                if not info: continue
                stat, stat_label, rx = info
                player = clean_player(mname, rx)
                if not player or player.lower() in {'over','under'}: continue
                over = under = None; line = None
                for s in sels_by_market.get(mid,[]):
                    lab = str(s.get('label',''))
                    price = dec((s.get('displayOdds') or {}).get('american'))
                    pts = s.get('points')
                    try: pts = float(pts) if pts is not None else None
                    except: pts = None
                    if re.search(r'\bOver\b',lab,re.I): over=(price,pts)
                    elif re.search(r'\bUnder\b',lab,re.I): under=(price,pts)
                if not over or not under or not over[0] or not under[0]: continue
                if over[1] is None or under[1] is None or abs(over[1]-under[1])>1e-9: continue
                line=over[1]
                market={
                    'key':f'player_{stat}',
                    'name':f'Player {player} - {stat_label}',
                    'title':mname,
                    'description':player,'player':player,
                    'specifiers':f'player={quote(player)}|stat={stat}|threshold={line}',
                    'scope':{'map':None,'round':None,'set':None,'period':'full'},
                    'line':line,'last_update':None,
                    'outcomes':[
                        {'name':f'Over {line}','price':over[0],'point':line,'description':player,'player':player},
                        {'name':f'Under {line}','price':under[0],'point':line,'description':player,'player':player}
                    ]
                }
                rec=events.setdefault(eid, {'id':f'draftkings-nfl-direct:{eid}','home_team':home,'away_team':away,'commence_time':ev.get('startEventDate'),'live':False,'markets':[]})
                # avoid duplicate identical prop contracts from overlapping DK subcategories
                sig=(market['key'],player.lower(),line)
                if any((x.get('key'),str(x.get('player','')).lower(),x.get('line'))==sig for x in rec['markets']): continue
                rec['markets'].append(market)
                health['marketCount'] += 1; health['playerPropMarkets'] += 1
                health['byStat'][stat]=health['byStat'].get(stat,0)+1
        except Exception as e:
            health['errors'].append(f'{subname}: {type(e).__name__}: {e}')
    for rec in events.values():
        if not rec['markets']: continue
        markets=rec.pop('markets')
        rec['bookmakers']=[{'key':'draftkings-direct','title':'DraftKings Direct','markets':markets}]
        arr.append(rec); health['acceptedEvents'] += 1
    health['ok'] = health['acceptedEvents'] > 0 and health['playerPropMarkets'] > 0
    health['status'] = 200 if health['ok'] else 500
except Exception as e:
    health['errors'].append(f'{type(e).__name__}: {e}'); health['status']=500
health['errors']=health['errors'][:20]; health['fetchedAt']=datetime.now(timezone.utc).isoformat()
out.setdefault('providerHealth',{})['draftkingsNfl']=health
out['sports']['american-football']['exactV2EventCount']=len(arr)
out['generatedAt']=health['fetchedAt']
with open(FILE,'w',encoding='utf-8') as f: json.dump(out,f,indent=2)
print('DRAFTKINGS_NFL_HEALTH',json.dumps(health,separators=(',',':')))
