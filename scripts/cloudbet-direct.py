import concurrent.futures, json, os, re, subprocess, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta

FILE='data/direct-sources-latest.json'
SOURCE='cloudbet-direct'
EVENT_PREFIX='cloudbet-direct:'
MARKET='Match Winner'
HEADER='X-API-Key'
BASE='https://sports-api.cloudbet.com/pub/v2/odds'
SECRET='thunderpick/cloudbet-api-key'
REGION='us-east-2'
WINDOW_DAYS=30
MAX_WORKERS=max(1,min(16,int(os.environ.get('CLOUDBET_CONCURRENCY','12'))))
JWT_RE=re.compile(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+')
SPORT_CONFIG={
    'american-football':{'sportName':'American Football','fallbackSport':'american-football','markets':['american_football.moneyline']},
    'baseball':{'sportName':'Baseball','fallbackSport':'baseball','markets':['baseball.moneyline']},
    'basketball':{'sportName':'Basketball','fallbackSport':'basketball','markets':['basketball.moneyline']},
    'soccer':{'sportName':'Soccer','fallbackSport':'soccer','markets':['soccer.match_odds']},
    'tennis':{'sportName':'Tennis','fallbackSport':'tennis','markets':['tennis.winner']},
    'cs2':{'sportName':'Counter-Strike','fallbackSport':'counter-strike','markets':['counter_strike.winner','counter_strike.match_odds']},
    'dota2':{'sportName':'Dota 2','fallbackSport':'dota-2','markets':['dota_2.winner']},
    'lol':{'sportName':'League of Legends','fallbackSport':'league-of-legends','markets':['league_of_legends.winner']},
    'valorant':{'sportName':'Valorant','fallbackSport':'valorant','markets':['esport_valorant.winner']},
}

def utcnow(): return datetime.now(timezone.utc).isoformat()
def norm_name(v): return re.sub(r'[^a-z0-9]','',str(v or '').lower())
def sanitize_error(e): return JWT_RE.sub('[REDACTED]',str(e or ''))[:300]

def extract_key(value):
    value=str(value or '').strip()
    if not value: raise RuntimeError('SECRET_LOAD_FAILED')
    try:
        parsed=json.loads(value)
        if isinstance(parsed,dict):
            candidate=str(parsed.get('CLOUDBET_API_KEY') or parsed.get('apiKey') or parsed.get('key') or '').strip()
            if candidate: return candidate
    except Exception: pass
    matches=JWT_RE.findall(value)
    if len(matches)==1: return matches[0]
    if value.startswith('eyJ') and value.count('.')==2: return value
    raise RuntimeError('SECRET_PARSE_FAILED')

def load_key():
    env=os.environ.get('CLOUDBET_API_KEY','').strip()
    if env: return extract_key(env)
    try:
        import boto3
        value=boto3.client('secretsmanager',region_name=REGION).get_secret_value(SecretId=SECRET).get('SecretString','')
        return extract_key(value)
    except Exception:
        p=subprocess.run(['aws','secretsmanager','get-secret-value','--region',REGION,'--secret-id',SECRET,'--query','SecretString','--output','text'],check=True,capture_output=True,text=True,timeout=20)
        return extract_key(p.stdout)

def request_json(url,key):
    headers={'Accept':'application/json','Content-Type':'application/json',HEADER:key,'User-Agent':'thunderpick-cloudbet/1.0'}
    last=None
    for attempt in range(3):
        req=urllib.request.Request(url,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=30) as r: return json.load(r)
        except urllib.error.HTTPError as e:
            try: detail=e.read().decode('utf-8','replace')
            except Exception: detail=''
            last=RuntimeError(f'CLOUDBET_HTTP_{e.code}:{sanitize_error(detail)}')
            if e.code in (429,500,502,503,504) and attempt<2:
                time.sleep(0.75*(attempt+1)); continue
            raise last from e
        except Exception as e:
            last=e
            if attempt<2: time.sleep(0.5*(attempt+1)); continue
            raise
    raise last or RuntimeError('CLOUDBET_REQUEST_FAILED')

def request_sports(key):
    body=request_json(f'{BASE}/sports',key)
    if isinstance(body,dict):
        rows=body.get('sports') or body.get('data') or []
        return rows if isinstance(rows,list) else []
    return body if isinstance(body,list) else []

def resolve_sport_api_keys(key):
    rows=request_sports(key)
    by_name={norm_name(row.get('name')):row for row in rows if isinstance(row,dict) and row.get('name') and row.get('key')}
    resolved={}; inventory={}
    for canon,config in SPORT_CONFIG.items():
        row=by_name.get(norm_name(config.get('sportName'))) or {}
        sportApiKey=str(row.get('key') or config.get('fallbackSport'))
        resolved[canon]=sportApiKey
        inventory[canon]={'name':row.get('name') or config.get('sportName'),'key':sportApiKey,'eventCount':row.get('eventCount'),'competitionCount':row.get('competitionCount')}
    return resolved, len(rows), inventory

def competition_rows(body):
    if not isinstance(body,dict): return []
    root=body.get('sport') if isinstance(body.get('sport'),dict) else body
    out=[]
    for cat in root.get('categories',[]) or []:
        for comp in (cat or {}).get('competitions',[]) or []:
            if isinstance(comp,dict) and comp.get('key') and int(comp.get('eventCount') or 0)>0: out.append(comp)
    for comp in root.get('competitions',[]) or []:
        if isinstance(comp,dict) and comp.get('key') and int(comp.get('eventCount') or 0)>0: out.append(comp)
    seen=set(); result=[]
    for comp in out:
        k=str(comp.get('key'))
        if k not in seen: seen.add(k); result.append(comp)
    return result

def request_competitions_for_sport(sportApiKey,key):
    body=request_json(f"{BASE}/sports/{urllib.parse.quote(str(sportApiKey),safe='-')}",key)
    return competition_rows(body)

def extract_events(body):
    if isinstance(body,list): return body
    if isinstance(body,dict):
        events=body.get('events') or (body.get('competition') or {}).get('events') or body.get('data') or []
        return events if isinstance(events,list) else []
    return []

def request_competition(comp_key,markets,key):
    params=[]
    for market in markets or []: params.append(('markets',market))
    qs=urllib.parse.urlencode(params)
    url=f"{BASE}/competitions/{urllib.parse.quote(str(comp_key),safe='-')}"+(f'?{qs}' if qs else '')
    return extract_events(request_json(url,key))

def parse_time(v):
    if not v: return None
    try: return datetime.fromisoformat(str(v).replace('Z','+00:00')).astimezone(timezone.utc)
    except Exception: return None

def within_horizon(event):
    t=parse_time(event.get('cutoffTime') or event.get('startTime')) if isinstance(event,dict) else None
    if not t: return False
    now=datetime.now(timezone.utc)
    return now-timedelta(minutes=15) <= t <= now+timedelta(days=WINDOW_DAYS)

def market_priority(key):
    k=str(key or '').lower()
    if re.search(r'\.moneyline$',k): return 0
    if re.search(r'\.winner$',k): return 1
    if re.search(r'\.match_odds$',k): return 2
    if re.search(r'\.matchodds$',k): return 3
    if re.search(r'\.1x2$',k): return 4
    return 99

def fulltime_scope(subkey):
    s=str(subkey or '').lower()
    if any(x in s for x in ('map=','round=','set=','game=','period=1h','period=2h','period=q','quarter')): return False
    return s=='' or 'period=default' in s or 'period=ft' in s or 'period=ot' in s

def team_name(value):
    if isinstance(value,dict): return value.get('name') or value.get('key')
    return value

def normalize_event(event,canon_sport):
    if not isinstance(event,dict) or not within_horizon(event): return None
    status=str(event.get('status') or '').upper()
    if 'LIVE' in status or status in {'RESULTED','ENDED','CANCELLED'}: return None
    eid=event.get('id') or event.get('key'); home=team_name(event.get('home')); away=team_name(event.get('away'))
    if not eid or not home or not away: return None
    markets=event.get('markets') or {}
    if not isinstance(markets,dict): return None
    for market_key in sorted(markets.keys(),key=market_priority):
        if market_priority(market_key)>=99: continue
        submarkets=(markets.get(market_key) or {}).get('submarkets') or {}
        if not isinstance(submarkets,dict): continue
        for subkey,sub in submarkets.items():
            if not fulltime_scope(subkey): continue
            outcomes=[]; seen=set()
            for sel in (sub or {}).get('selections') or []:
                if not isinstance(sel,dict): continue
                if str(sel.get('status') or '').upper() not in ('','SELECTION_ENABLED'): continue
                if str(sel.get('side') or 'BACK').upper()!='BACK': continue
                try: price=float(sel.get('price'))
                except Exception: continue
                if price<=1: continue
                outcome=str(sel.get('outcome') or '').lower().replace('outcome=','').strip()
                name=home if outcome=='home' else away if outcome=='away' else 'Draw' if outcome in ('draw','tie') else None
                if not name or name in seen: continue
                seen.add(name); outcomes.append({'name':name,'price':price})
            if len(outcomes) not in (2,3): continue
            return {'id':EVENT_PREFIX+str(eid),'home_team':str(home),'away_team':str(away),'commence_time':event.get('cutoffTime') or event.get('startTime'),'live':False,'bookmakers':[{'key':SOURCE,'title':'Cloudbet','markets':[{'key':'h2h','name':MARKET,'scope':{'map':None,'round':None},'last_update':None,'outcomes':outcomes}]}]}
    return None

def read_out():
    with open(FILE) as f: return json.load(f)
def write_out(out):
    out['generatedAt']=utcnow()
    with open(FILE,'w') as f: json.dump(out,f,indent=2)

def collect_sport(canon,config,sportApiKey,key):
    comps=request_competitions_for_sport(sportApiKey,key)
    stats={'selected':len(comps),'fetched':0,'failed':0,'rawEvents':0,'usableEvents':0}
    errors=[]; event_map={}
    def fetch(comp):
        return str(comp.get('key')),request_competition(comp.get('key'),config.get('markets',[]),key)
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        future_map={pool.submit(fetch,comp):comp for comp in comps}
        for fut in concurrent.futures.as_completed(future_map):
            comp=future_map[fut]
            try:
                comp_key,events=fut.result(); stats['fetched']+=1; stats['rawEvents']+=len(events)
                for event in events:
                    eid=str(event.get('id') or event.get('key') or '')
                    if eid: event_map[eid]=event
            except Exception as e:
                stats['failed']+=1; errors.append(f"{comp.get('key')}:{sanitize_error(e)}")
    rows=[]
    for event in event_map.values():
        row=normalize_event(event,canon)
        if row: rows.append(row)
    stats['usableEvents']=len(rows); stats['uniqueEvents']=len(event_map)
    return rows,stats,errors

def main():
    out=read_out(); sports=out.setdefault('sports',{}); health=out.setdefault('providerHealth',{})
    for canon in SPORT_CONFIG:
        bucket=sports.setdefault(canon,{'exactV2':[]}); existing=bucket.setdefault('exactV2',[])
        bucket['exactV2']=[e for e in existing if not str(e.get('id','')).startswith(EVENT_PREFIX)]
    try: key=load_key()
    except Exception as e:
        health['cloudbet']={'ok':False,'connected':False,'usable':False,'source':SOURCE,'events':0,'sportInventory':{},'competitionStats':{},'state':'SECRET_UNAVAILABLE','error':sanitize_error(e),'fetchedAt':utcnow()}
        write_out(out); print(json.dumps(health['cloudbet'])); return
    errors=[]
    try: sport_api_keys,sports_discovered,sport_inventory=resolve_sport_api_keys(key)
    except Exception as e:
        sport_api_keys={canon:config.get('fallbackSport') for canon,config in SPORT_CONFIG.items()}; sports_discovered=0; sport_inventory={}; errors.append(f'sports:{sanitize_error(e)}')
    counts={}; competition_stats={}; total=0; sports_ok=0
    for canon,config in SPORT_CONFIG.items():
        sportApiKey=sport_api_keys.get(canon) or config.get('fallbackSport')
        try:
            rows,stats,sport_errors=collect_sport(canon,config,sportApiKey,key); sports_ok+=1
            sports[canon]['exactV2'].extend(rows); counts[canon]=len(rows); total+=len(rows); competition_stats[canon]=stats
            errors.extend(f'{canon}:{e}' for e in sport_errors)
        except Exception as e:
            counts[canon]=0; competition_stats[canon]={'selected':0,'fetched':0,'failed':1,'rawEvents':0,'usableEvents':0}; errors.append(f'{canon}:{sanitize_error(e)}')
    connected=sports_ok>0; usable=total>0
    health['cloudbet']={'ok':connected,'connected':connected,'usable':usable,'state':'CONNECTED_USABLE' if usable else 'CONNECTED_NO_USABLE_PRICES' if connected else 'UNAVAILABLE','source':SOURCE,'apiMode':'competition-batch','events':total,'sportsFetched':sports_ok,'sportsDiscovered':sports_discovered,'sportApiKeys':sport_api_keys,'sportInventory':sport_inventory,'competitionStats':competition_stats,'bySport':counts,'errors':errors[:30],'windowDays':WINDOW_DAYS,'concurrency':MAX_WORKERS,'fetchedAt':utcnow()}
    write_out(out); print(json.dumps(health['cloudbet']))

if __name__=='__main__': main()
