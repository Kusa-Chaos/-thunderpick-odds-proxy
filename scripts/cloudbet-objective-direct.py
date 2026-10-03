import concurrent.futures, json, os, re, subprocess, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta
from cloudbet_objective import SUPPORTED_MARKETS, build_objective_event_row

FILE='data/direct-sources-latest.json'
SOURCE='cloudbet-objective'
EVENT_PREFIX='cloudbet-objective:'
HEADER='X-API-Key'
BASE='https://sports-api.cloudbet.com/pub/v2/odds'
SECRET='thunderpick/cloudbet-api-key'
REGION='us-east-2'
WINDOW_DAYS=30
MAX_WORKERS=max(1,min(16,int(os.environ.get('CLOUDBET_OBJECTIVE_CONCURRENCY','8'))))
JWT_RE=re.compile(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+')
SPORT_CONFIG={
    'lol':{'sportName':'League of Legends','fallbackSport':'league-of-legends','markets':SUPPORTED_MARKETS['lol']},
    'dota2':{'sportName':'Dota 2','fallbackSport':'dota-2','markets':SUPPORTED_MARKETS['dota2']},
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
            if candidate:return candidate
    except Exception:pass
    matches=JWT_RE.findall(value)
    if len(matches)==1:return matches[0]
    if value.startswith('eyJ') and value.count('.')==2:return value
    raise RuntimeError('SECRET_PARSE_FAILED')

def load_key():
    env=os.environ.get('CLOUDBET_API_KEY','').strip()
    if env:return extract_key(env)
    try:
        import boto3
        value=boto3.client('secretsmanager',region_name=REGION).get_secret_value(SecretId=SECRET).get('SecretString','')
        return extract_key(value)
    except Exception:
        p=subprocess.run(['aws','secretsmanager','get-secret-value','--region',REGION,'--secret-id',SECRET,'--query','SecretString','--output','text'],check=True,capture_output=True,text=True,timeout=20)
        return extract_key(p.stdout)

def request_json(url,key):
    headers={'Accept':'application/json','Content-Type':'application/json',HEADER:key,'User-Agent':'thunderpick-cloudbet-objective/1.0'}
    last=None
    for attempt in range(3):
        req=urllib.request.Request(url,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
        except urllib.error.HTTPError as e:
            detail=e.read().decode('utf-8','replace')[:500]
            last=RuntimeError(f'CLOUDBET_HTTP_{e.code}:{sanitize_error(detail)}')
            if e.code in (429,500,502,503,504) and attempt<2:
                time.sleep(.75*(attempt+1));continue
            raise last from e
        except Exception as e:
            last=e
            if attempt<2:time.sleep(.5*(attempt+1));continue
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
    by_name={norm_name(r.get('name')):r for r in rows if isinstance(r,dict) and r.get('name') and r.get('key')}
    out={}
    for canon,cfg in SPORT_CONFIG.items():
        row=by_name.get(norm_name(cfg['sportName'])) or {}
        out[canon]=str(row.get('key') or cfg['fallbackSport'])
    return out

def competition_rows(body):
    if not isinstance(body,dict):return []
    root=body.get('sport') if isinstance(body.get('sport'),dict) else body
    out=[]
    for cat in root.get('categories',[]) or []:
        for comp in (cat or {}).get('competitions',[]) or []:
            if isinstance(comp,dict) and comp.get('key') and int(comp.get('eventCount') or 0)>0:out.append(comp)
    for comp in root.get('competitions',[]) or []:
        if isinstance(comp,dict) and comp.get('key') and int(comp.get('eventCount') or 0)>0:out.append(comp)
    seen=set();res=[]
    for comp in out:
        k=str(comp['key'])
        if k not in seen:seen.add(k);res.append(comp)
    return res

def request_competitions_for_sport(sport_api_key,key):
    body=request_json(f"{BASE}/sports/{urllib.parse.quote(str(sport_api_key),safe='-')}",key)
    return competition_rows(body)

def extract_events(body):
    if isinstance(body,list):return body
    if isinstance(body,dict):
        rows=body.get('events') or (body.get('competition') or {}).get('events') or body.get('data') or []
        return rows if isinstance(rows,list) else []
    return []

def request_competition(comp_key,markets,key):
    if len(set(markets))>7:raise RuntimeError('CLOUDBET_MARKET_LIMIT_EXCEEDED')
    qs=urllib.parse.urlencode([('markets',m) for m in markets])
    url=f"{BASE}/competitions/{urllib.parse.quote(str(comp_key),safe='-')}?{qs}"
    return extract_events(request_json(url,key))

def parse_time(v):
    if not v:return None
    try:return datetime.fromisoformat(str(v).replace('Z','+00:00')).astimezone(timezone.utc)
    except Exception:return None

def within_horizon(event):
    t=parse_time(event.get('cutoffTime') or event.get('startTime')) if isinstance(event,dict) else None
    if not t:return False
    now=datetime.now(timezone.utc)
    return now-timedelta(minutes=15)<=t<=now+timedelta(days=WINDOW_DAYS)

def usable_event(event):
    if not isinstance(event,dict) or not within_horizon(event):return False
    status=str(event.get('status') or '').upper()
    return 'LIVE' not in status and status not in {'RESULTED','ENDED','CANCELLED'}

def collect_sport(canon,cfg,sport_api_key,key):
    comps=request_competitions_for_sport(sport_api_key,key)
    stats={'selected':len(comps),'fetched':0,'failed':0,'rawEvents':0,'objectiveEvents':0,'objectiveMarkets':0,'byFamilyHint':{}}
    errors=[];events={}
    def fetch(comp):return str(comp.get('key')),request_competition(comp.get('key'),cfg['markets'],key)
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futs={pool.submit(fetch,c):c for c in comps}
        for fut in concurrent.futures.as_completed(futs):
            c=futs[fut]
            try:
                _,rows=fut.result();stats['fetched']+=1;stats['rawEvents']+=len(rows)
                for e in rows:
                    eid=str(e.get('id') or e.get('key') or '')
                    if eid:events[eid]=e
            except Exception as e:
                stats['failed']+=1;errors.append(f"{c.get('key')}:{sanitize_error(e)}")
    out=[]
    for e in events.values():
        if not usable_event(e):continue
        row=build_objective_event_row(e)
        if row:
            out.append(row);stats['objectiveEvents']+=1
            for m in row['bookmakers'][0]['markets']:
                stats['objectiveMarkets']+=1
                name=m.get('name','')
                for hint in ('First Blood','First to ','First Tower','First Baron','First Dragon','Total Kills'):
                    if hint in name:stats['byFamilyHint'][hint]=stats['byFamilyHint'].get(hint,0)+1;break
    stats['uniqueEvents']=len(events)
    return out,stats,errors

def main():
    with open(FILE) as f:out=json.load(f)
    sports=out.setdefault('sports',{});health=out.setdefault('providerHealth',{})
    for canon in SPORT_CONFIG:
        bucket=sports.setdefault(canon,{'exactV2':[]});existing=bucket.setdefault('exactV2',[])
        bucket['exactV2']=[e for e in existing if not str(e.get('id','')).startswith(EVENT_PREFIX)]
    try:key=load_key()
    except Exception as e:
        health['cloudbetObjective']={'ok':False,'connected':False,'usable':False,'source':SOURCE,'state':'SECRET_UNAVAILABLE','error':sanitize_error(e),'fetchedAt':utcnow()}
        with open(FILE,'w') as f:json.dump(out,f,indent=2)
        print(json.dumps(health['cloudbetObjective']));return
    try:sport_keys=resolve_sport_api_keys(key)
    except Exception as e:
        sport_keys={c:cfg['fallbackSport'] for c,cfg in SPORT_CONFIG.items()};resolve_error=sanitize_error(e)
    else:resolve_error=None
    total_events=0;total_markets=0;by_sport={};errors=[]
    for canon,cfg in SPORT_CONFIG.items():
        try:
            rows,stats,errs=collect_sport(canon,cfg,sport_keys[canon],key)
            sports[canon]['exactV2'].extend(rows);by_sport[canon]=stats;total_events+=len(rows);total_markets+=stats['objectiveMarkets'];errors.extend(f'{canon}:{x}' for x in errs)
        except Exception as e:
            by_sport[canon]={'selected':0,'fetched':0,'failed':1,'rawEvents':0,'objectiveEvents':0,'objectiveMarkets':0,'byFamilyHint':{}};errors.append(f'{canon}:{sanitize_error(e)}')
    if resolve_error:errors.insert(0,'sports:'+resolve_error)
    health['cloudbetObjective']={'ok':True,'connected':True,'usable':total_markets>0,'state':'CONNECTED_USABLE' if total_markets>0 else 'CONNECTED_NO_OBJECTIVE_MARKETS','source':SOURCE,'events':total_events,'markets':total_markets,'bySport':by_sport,'requestedMarkets':{k:v['markets'] for k,v in SPORT_CONFIG.items()},'errors':errors[:30],'fetchedAt':utcnow()}
    out['generatedAt']=utcnow()
    with open(FILE,'w') as f:json.dump(out,f,indent=2)
    print(json.dumps(health['cloudbetObjective']))

if __name__=='__main__':main()
