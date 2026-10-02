import concurrent.futures
import json, os, re, subprocess, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

FILE='data/direct-sources-latest.json'
SOURCE='cloudbet-direct'
EVENT_PREFIX='cloudbet-direct:'
MARKET='Match Winner'
BASE='https://sports-api.cloudbet.com/pub/v2/odds'
SECRET='thunderpick/cloudbet-api-key'
REGION='us-east-2'
JWT_RE=re.compile(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+')
SPORT_KEYS={
    'american-football':'american-football',
    'baseball':'baseball',
    'basketball':'basketball',
    'soccer':'soccer',
    'tennis':'tennis',
    'cs2':'counter-strike',
    'dota2':'dota-2',
    'lol':'league-of-legends',
    'valorant':'esport-valorant',
}
PRIMARY_MARKETS={
    'american-football':['american_football.moneyline'],
    'baseball':['baseball.moneyline'],
    'basketball':['basketball.moneyline'],
    'soccer':['soccer.matchOdds'],
    'tennis':['tennis.winner'],
    'cs2':['counter_strike.winner'],
    'dota2':['dota_2.winner'],
    'lol':['league_of_legends.winner'],
    'valorant':['esport_valorant.winner'],
}

def utcnow(): return datetime.now(timezone.utc).isoformat()

def number(v):
    try: return float(v)
    except Exception: return 0.0

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

def request_json(path,key):
    last=None
    for mode in ('x-api-key','bearer'):
        headers={'Accept':'application/json','Content-Type':'application/json','User-Agent':'thunderpick-cloudbet/1.2'}
        if mode=='x-api-key': headers['X-API-Key']=key
        else: headers['Authorization']=f'Bearer {key}'
        req=urllib.request.Request(BASE+path,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body=e.read(240).decode('utf-8','replace')
            last=RuntimeError(f'HTTP {e.code}: {body}')
            if e.code not in (400,401,403): raise last
        except Exception as e:
            last=e
    raise last or RuntimeError('CLOUDBET_REQUEST_FAILED')

def sport_payload(sport_key,key):
    return request_json(f'/sports/{urllib.parse.quote(sport_key,safe="")}',key)

def competition_payload(competition_key,markets,key):
    query=urllib.parse.urlencode([('markets',m) for m in markets])
    return request_json(f'/competitions/{urllib.parse.quote(competition_key,safe="")}?{query}',key)

def competitions_from_sport(body):
    out=[]
    if not isinstance(body,dict): return out
    for category in body.get('categories') or []:
        if not isinstance(category,dict): continue
        for comp in category.get('competitions') or []:
            if isinstance(comp,dict) and comp.get('key') and number(comp.get('eventCount'))>0:
                out.append(comp)
    return out

def events_from_payload(body):
    if isinstance(body,list): return body
    if isinstance(body,dict):
        events=body.get('events') or body.get('data') or []
        return events if isinstance(events,list) else []
    return []

def is_prematch_event(event):
    status=str((event or {}).get('status') or '').upper()
    return 'LIVE' not in status and status not in {'RESULTED','ENDED','CANCELLED'}

def market_priority(key):
    k=str(key or '').lower()
    compact=k.replace('_','')
    if k.endswith('.moneyline'): return 0
    if k.endswith('.winner'): return 1
    if compact.endswith('.matchodds'): return 2
    if k.endswith('.1x2'): return 3
    return 99

def fulltime_scope(subkey):
    s=str(subkey or '').lower()
    if any(x in s for x in ('map=','round=','set=','game=','period=1h','period=2h','period=q','quarter')): return False
    return s=='' or 'period=default' in s or 'period=ft' in s or 'period=ot' in s

def team_name(value):
    if isinstance(value,dict): return value.get('name') or value.get('key')
    return value

def normalize_event(event,canon_sport):
    if not isinstance(event,dict) or not is_prematch_event(event): return None
    eid=event.get('id') or event.get('key')
    home=team_name(event.get('home')); away=team_name(event.get('away'))
    if not eid or not home or not away: return None
    markets=event.get('markets') or {}
    if not isinstance(markets,dict): return None
    for market_key in sorted(markets.keys(),key=market_priority):
        if market_priority(market_key)>=99: continue
        market=markets.get(market_key) or {}
        submarkets=market.get('submarkets') or {}
        if not isinstance(submarkets,dict): continue
        for subkey,sub in submarkets.items():
            if not fulltime_scope(subkey): continue
            selections=(sub or {}).get('selections') or []
            outcomes=[]; seen=set()
            for sel in selections:
                if not isinstance(sel,dict): continue
                if str(sel.get('status') or '').upper() not in ('','SELECTION_ENABLED'): continue
                if str(sel.get('side') or 'BACK').upper()!='BACK': continue
                raw=sel.get('price')
                try: price=float(raw)
                except Exception: continue
                if price<=1: continue
                outcome=str(sel.get('outcome') or '').lower().replace('outcome=','').strip()
                name=home if outcome=='home' else away if outcome=='away' else 'Draw' if outcome in ('draw','tie') else None
                if not name or name in seen: continue
                seen.add(name); outcomes.append({'name':name,'price':price})
            if len(outcomes) not in (2,3): continue
            return {
                'id':EVENT_PREFIX+str(eid),
                'home_team':str(home),
                'away_team':str(away),
                'commence_time':event.get('cutoffTime') or event.get('startTime'),
                'live':False,
                'bookmakers':[{'key':SOURCE,'title':'Cloudbet','markets':[{'key':'h2h','name':MARKET,'scope':{'map':None,'round':None},'last_update':None,'outcomes':outcomes}]}],
            }
    return None

def read_out():
    with open(FILE) as f: return json.load(f)

def write_out(out):
    out['generatedAt']=utcnow()
    with open(FILE,'w') as f: json.dump(out,f,indent=2)

def sanitize_error(e):
    text=JWT_RE.sub('[REDACTED]',str(e or ''))
    return text[:240]

def main():
    out=read_out(); sports=out.setdefault('sports',{}); health=out.setdefault('providerHealth',{})
    for canon in SPORT_KEYS:
        bucket=sports.setdefault(canon,{'exactV2':[]})
        existing=bucket.setdefault('exactV2',[])
        bucket['exactV2']=[e for e in existing if not str(e.get('id','')).startswith(EVENT_PREFIX)]
    try:
        key=load_key()
    except Exception as e:
        health['cloudbet']={'ok':False,'source':SOURCE,'events':0,'state':'SECRET_UNAVAILABLE','error':sanitize_error(e),'fetchedAt':utcnow()}
        write_out(out); print(json.dumps(health['cloudbet'])); return

    jobs=[]; errors=[]; sports_fetched=0
    for canon,sport_key in SPORT_KEYS.items():
        try:
            body=sport_payload(sport_key,key); sports_fetched+=1
            for comp in competitions_from_sport(body):
                jobs.append((canon,comp['key']))
        except Exception as e:
            errors.append(f'{canon}:sport:{sanitize_error(e)}')

    def fetch_job(job):
        canon,comp_key=job
        try:
            payload=competition_payload(comp_key,PRIMARY_MARKETS[canon],key)
            events=events_from_payload(payload)
            rows=[]
            for event in events:
                row=normalize_event(event,canon)
                if row: rows.append(row)
            return canon,comp_key,len(events),rows,None
        except Exception as e:
            return canon,comp_key,0,[],sanitize_error(e)

    counts={canon:0 for canon in SPORT_KEYS}; raw_events=0; competition_successes=0
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        for canon,comp_key,event_count,rows,error in pool.map(fetch_job,jobs):
            raw_events+=event_count
            if error:
                errors.append(f'{canon}:{comp_key}:{error}')
                continue
            competition_successes+=1
            for row in rows:
                sports[canon]['exactV2'].append(row)
            counts[canon]+=len(rows)

    total=sum(counts.values())
    ok=sports_fetched>0 and competition_successes>0 and total>0
    health['cloudbet']={
        'ok':ok,
        'source':SOURCE,
        'events':total,
        'sportsFetched':sports_fetched,
        'competitionRequests':len(jobs),
        'competitionSuccesses':competition_successes,
        'rawEvents':raw_events,
        'bySport':counts,
        'marketFilters':PRIMARY_MARKETS,
        'errors':errors[:20],
        'fetchedAt':utcnow(),
    }
    write_out(out); print(json.dumps(health['cloudbet']))

if __name__=='__main__': main()
