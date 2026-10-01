import json, os, subprocess, urllib.request
from datetime import datetime, timezone

FILE='data/direct-sources-latest.json'
SOURCE='cloudbet-direct'
EVENT_PREFIX='cloudbet-direct:'
MARKET='Match Winner'
HEADER='X-API-Key'
BASE='https://sports-api.cloudbet.com/pub/v2/odds'
SECRET='thunderpick/cloudbet-api-key'

def load_key():
    key=os.environ.get('CLOUDBET_API_KEY','').strip()
    if key:
        return key
    p=subprocess.run(['aws','secretsmanager','get-secret-value','--region','us-east-2','--secret-id',SECRET,'--query','SecretString','--output','text'],check=True,capture_output=True,text=True)
    return p.stdout.strip()

def request_json(path,key):
    req=urllib.request.Request(BASE+path,headers={'Accept':'application/json',HEADER:key})
    with urllib.request.urlopen(req,timeout=30) as r:
        return json.load(r)

def normalize(feed):
    exactV2=[]
    sports=feed.get('sports',[]) if isinstance(feed,dict) else []
    for sport in sports:
        for event in sport.get('events',[]) if isinstance(sport,dict) else []:
            eid=event.get('id') or event.get('key')
            home=event.get('home') or event.get('homeTeam')
            away=event.get('away') or event.get('awayTeam')
            outcomes=[]
            for item in event.get('outcomes',[]) or []:
                name=item.get('name') or item.get('selection')
                raw=item.get('price') or item.get('decimalPrice')
                try: price=float(raw)
                except Exception: continue
                if name and price>1:
                    outcomes.append({'name':str(name),'price':price})
            if eid and home and away and len(outcomes)>=2:
                exactV2.append({'id':EVENT_PREFIX+str(eid),'sport':sport.get('key') or sport.get('name'),'homeTeam':home,'awayTeam':away,'startTime':event.get('startTime'),'live':False,'bookmakers':[{'key':SOURCE,'title':'Cloudbet','markets':[{'key':'h2h','name':MARKET,'scope':'prematch','outcomes':outcomes}]}]})
    return exactV2

def main():
    key=load_key()
    feed=request_json('/sports',key)
    fresh=normalize(feed)
    with open(FILE) as f:
        out=json.load(f)
    existing=out.setdefault('exactV2',[])
    existing[:]=[e for e in existing if not str(e.get('id','')).startswith(EVENT_PREFIX)]
    existing.extend(fresh)
    out.setdefault('providerHealth',{})['cloudbet']={'ok':True,'source':SOURCE,'events':len(fresh)}
    out['generatedAt']=datetime.now(timezone.utc).isoformat()
    with open(FILE,'w') as f:
        json.dump(out,f,indent=2)
    print(json.dumps({'ok':True,'source':SOURCE,'events':len(fresh)}))

if __name__=='__main__':
    main()
