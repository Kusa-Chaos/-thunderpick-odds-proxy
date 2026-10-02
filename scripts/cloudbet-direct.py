import json, os, re, subprocess, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

FILE='data/direct-sources-latest.json'
SOURCE='cloudbet-direct'
EVENT_PREFIX='cloudbet-direct:'
MARKET='Match Winner'
HEADER='X-API-Key'
BASE='https://sports-api.cloudbet.com/pub/v2/odds'
SECRET='thunderpick/cloudbet-api-key'
REGION='us-east-2'
WINDOW_DAYS=30
JWT_RE=re.compile(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+')
SPORT_CONFIG={
    'american-football':{'sport':'american_football','markets':['american_football.moneyline']},
    'baseball':{'sport':'baseball','markets':['baseball.moneyline']},
    'basketball':{'sport':'basketball','markets':['basketball.moneyline']},
    'soccer':{'sport':'soccer','markets':['soccer.match_odds']},
    'tennis':{'sport':'tennis','markets':['tennis.winner']},
    'cs2':{'sport':'counter_strike','markets':['counter_strike.winner','counter_strike.match_odds']},
    'dota2':{'sport':'dota_2','markets':['dota_2.winner']},
    'lol':{'sport':'league_of_legends','markets':['league_of_legends.winner']},
    'valorant':{'sport':'esport_valorant','markets':['esport_valorant.winner']},
}

def utcnow(): return datetime.now(timezone.utc).isoformat()

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

def request_events(config,key,include_markets=True):
    now=int(time.time())
    params=[
        ('sport',config['sport']),
        ('live','false'),
        ('players','false'),
        ('limit','10000'),
        ('from',str(now)),
        ('to',str(now+WINDOW_DAYS*86400)),
    ]
    if include_markets:
        params.extend(('markets',m) for m in config.get('markets',[]))
    qs=urllib.parse.urlencode(params)
    req=urllib.request.Request(f'{BASE}/events?{qs}',headers={'Accept':'application/json',HEADER:key,'User-Agent':'thunderpick-cloudbet/1.0'})
    try:
        with urllib.request.urlopen(req,timeout=30) as r:
            body=json.load(r)
    except urllib.error.HTTPError as e:
        try: detail=e.read().decode('utf-8','replace')
        except Exception: detail=''
        raise RuntimeError(f'CLOUDBET_HTTP_{e.code}:{sanitize_error(detail)}') from e
    if isinstance(body,list): return body
    if isinstance(body,dict):
        events=body.get('events') or body.get('data') or []
        return events if isinstance(events,list) else []
    return []

def market_priority(key):
    k=str(key or '').lower()
    if re.search(r'\.moneyline$',k): return 0
    if re.search(r'\.winner$',k): return 1
    if re.search(r'\.match_odds$',k): return 2
    if re.search(r'\.1x2$',k): return 3
    return 99

def fulltime_scope(subkey):
    s=str(subkey or '').lower()
    if any(x in s for x in ('map=','round=','set=','game=','period=1h','period=2h','period=q','quarter')): return False
    return s=='' or 'period=default' in s or 'period=ft' in s or 'period=ot' in s

def team_name(value):
    if isinstance(value,dict): return value.get('name') or value.get('key')
    return value

def normalize_event(event,canon_sport):
    if not isinstance(event,dict): return None
    status=str(event.get('status') or '').upper()
    if 'LIVE' in status or status in {'RESULTED','ENDED','CANCELLED'}: return None
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
            outcomes=[]
            seen=set()
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
    for canon in SPORT_CONFIG:
        bucket=sports.setdefault(canon,{'exactV2':[]})
        existing=bucket.setdefault('exactV2',[])
        bucket['exactV2']=[e for e in existing if not str(e.get('id','')).startswith(EVENT_PREFIX)]
    try:
        key=load_key()
    except Exception as e:
        health['cloudbet']={'ok':False,'connected':False,'usable':False,'source':SOURCE,'events':0,'rawEvents':0,'unfilteredRawEvents':0,'rawEventsBySport':{},'unfilteredRawEventsBySport':{},'normalizedRejectedBySport':{},'state':'SECRET_UNAVAILABLE','error':sanitize_error(e),'fetchedAt':utcnow()}
        write_out(out); print(json.dumps(health['cloudbet'])); return
    counts={}; raw_counts={}; unfiltered_counts={}; rejected_counts={}; errors=[]; fetched=0; total=0
    for canon,config in SPORT_CONFIG.items():
        try:
            events=request_events(config,key,True); fetched+=1; raw_counts[canon]=len(events); added=0
            for event in events:
                row=normalize_event(event,canon)
                if row:
                    sports[canon]['exactV2'].append(row); added+=1; total+=1
            counts[canon]=added; rejected_counts[canon]=max(0,len(events)-added)
            if len(events)==0:
                try: unfiltered_counts[canon]=len(request_events(config,key,False))
                except Exception as e: unfiltered_counts[canon]=0; errors.append(f'{canon}-unfiltered:{sanitize_error(e)}')
            else:
                unfiltered_counts[canon]=len(events)
        except Exception as e:
            counts[canon]=0; raw_counts[canon]=0; unfiltered_counts[canon]=0; rejected_counts[canon]=0; errors.append(f'{canon}:{sanitize_error(e)}')
    connected=fetched>0
    usable=total>0
    raw_total=sum(raw_counts.values())
    unfiltered_total=sum(unfiltered_counts.values())
    health['cloudbet']={'ok':connected,'connected':connected,'usable':usable,'source':SOURCE,'events':total,'rawEvents':raw_total,'unfilteredRawEvents':unfiltered_total,'sportsFetched':fetched,'bySport':counts,'rawEventsBySport':raw_counts,'unfilteredRawEventsBySport':unfiltered_counts,'normalizedRejectedBySport':rejected_counts,'errors':errors[:18],'windowDays':WINDOW_DAYS,'fetchedAt':utcnow()}
    write_out(out); print(json.dumps(health['cloudbet']))

if __name__=='__main__': main()
