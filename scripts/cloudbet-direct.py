import json, os, re, urllib.request
from datetime import datetime, timezone

FILE='data/direct-sources-latest.json'
SOURCE='cloudbet-direct'
EVENT_PREFIX='cloudbet-direct:'
MARKET='Match Winner'
HEADER='X-API-Key'
BASE='https://sports-api.cloudbet.com/pub/v2/odds'
SECRET='thunderpick/cloudbet-api-key'
REGION='us-east-2'
JWT_RE=re.compile(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+')

def load_key():
    key=os.environ.get('CLOUDBET_API_KEY','').strip()
    if key: return key
    try: import boto3
    except ImportError as e: raise RuntimeError('BOTO3_MISSING') from e
    value=boto3.client('secretsmanager',region_name=REGION).get_secret_value(SecretId=SECRET).get('SecretString','').strip()
    if not value: raise RuntimeError('SECRET_LOAD_FAILED')
    try:
        parsed=json.loads(value)
        if isinstance(parsed,dict):
            candidate=str(parsed.get('CLOUDBET_API_KEY') or parsed.get('apiKey') or parsed.get('key') or '').strip()
            if candidate: return candidate
    except Exception: pass
    matches=JWT_RE.findall(value)
    if len(matches)==1: return matches[0]
    raise RuntimeError('SECRET_PARSE_FAILED')

def request_json(path,key):
    req=urllib.request.Request(BASE+path,headers={'Accept':'application/json',HEADER:key})
    with urllib.request.urlopen(req,timeout=30) as r: return json.load(r)

def normalize(feed):
    exactV2=[]
    sports=feed.get('sports',[]) if isinstance(feed,dict) else []
    for sport in sports:
        for event in sport.get('events',[]) if isinstance(sport,dict) else []:
            eid=event.get('id') or event.get('key'); home=event.get('home') or event.get('homeTeam'); away=event.get('away') or event.get('awayTeam'); outcomes=[]
            for item in event.get('outcomes',[]) or []:
                name=item.get('name') or item.get('selection'); raw=item.get('price') or item.get('decimalPrice')
                try: price=float(raw)
                except Exception: continue
                if name and price>1: outcomes.append({'name':str(name),'price':price})
            if eid and home and away and len(outcomes)>=2:
                exactV2.append({'id':EVENT_PREFIX+str(eid),'sport':sport.get('key') or sport.get('name'),'homeTeam':home,'awayTeam':away,'startTime':event.get('startTime'),'live':False,'bookmakers':[{'key':SOURCE,'title':'Cloudbet','markets':[{'key':'h2h','name':MARKET,'scope':'prematch','outcomes':outcomes}]}]})
    return exactV2

def main():
    key=load_key(); feed=request_json('/sports',key); fresh=normalize(feed)
    with open(FILE) as f: out=json.load(f)
    existing=out.setdefault('exactV2',[]); existing[:]=[e for e in existing if not str(e.get('id','')).startswith(EVENT_PREFIX)]; existing.extend(fresh)
    out.setdefault('providerHealth',{})['cloudbet']={'ok':True,'source':SOURCE,'events':len(fresh)}; out['generatedAt']=datetime.now(timezone.utc).isoformat()
    with open(FILE,'w') as f: json.dump(out,f,indent=2)
    print(json.dumps({'ok':True,'source':SOURCE,'events':len(fresh)}))

if __name__=='__main__': main()
