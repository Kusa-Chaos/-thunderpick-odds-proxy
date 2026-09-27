import json
import re
from datetime import datetime, timezone
from curl_cffi import requests as cffi_requests

FILE='data/direct-sources-latest.json'
BASE='https://sbapi.nj.sportsbook.fanduel.com/api/content-managed-page'
API_KEY='FhMFpcPWXMeyZxOx'
SPORTS={'nfl':'american-football','nba':'basketball','mlb':'baseball'}

def dec(v):
    if v is None:return None
    try:n=int(str(v).replace('−','-').replace('+',''))
    except:return None
    if n>0:return 1+n/100
    if n<0:return 1+100/abs(n)
    return None

def clean_team(v): return re.sub(r'\s*\([^)]*\)\s*$','',str(v or '')).strip()
def pair(ev):
    name=str(ev.get('name',''))
    if ' @ ' not in name:return None
    away,home=name.split(' @ ',1)
    return clean_team(home),clean_team(away)
def american(r): return dec((((r.get('winRunnerOdds') or {}).get('americanDisplayOdds') or {}).get('americanOdds')))
def get_page(page):
    r=cffi_requests.get(BASE,params={'page':'CUSTOM','customPageId':page,'_ak':API_KEY},impersonate='chrome120',headers={'Accept':'application/json'},timeout=20)
    r.raise_for_status();return r.json()

def runner_for(runners,team):
    t=team.lower()
    for r in runners:
        n=str(r.get('runnerName','')).lower()
        if n==t or n in t or t in n:return r
    return None

with open(FILE,'r',encoding='utf-8') as f: out=json.load(f)
health={'ok':False,'status':None,'acceptedEvents':0,'marketCount':0,'bySport':{},'errors':[],'fetchedAt':datetime.now(timezone.utc).isoformat()}
for page,sport in SPORTS.items():
    hs=health['bySport'][sport]={'events':0,'markets':0,'h2h':0,'spreads':0,'totals':0}
    try:
        data=get_page(page);atts=data.get('attachments',{});events={str(k):v for k,v in (atts.get('events') or {}).items()};markets=list((atts.get('markets') or {}).values())
        by_event={}
        for m in markets:
            eid=str(m.get('eventId',''));ev=events.get(eid);p=pair(ev or {})
            if not ev or not p:continue
            home,away=p;runners=m.get('runners') or [];mname=str(m.get('marketName',''))
            market=None
            if mname=='Moneyline':
                hr=runner_for(runners,home);ar=runner_for(runners,away);ho=american(hr or {});ao=american(ar or {})
                if ho and ao:market={'key':'h2h','name':'Match Winner','title':'Moneyline','scope':{'map':None,'round':None,'set':None,'period':'full'},'line':None,'last_update':None,'outcomes':[{'name':home,'price':ho},{'name':away,'price':ao}]};hs['h2h']+=1
            elif mname in {'Spread','Run Line'}:
                hr=runner_for(runners,home);ar=runner_for(runners,away)
                if hr and ar:
                    ho,ao=american(hr),american(ar);hp=hr.get('handicap');ap=ar.get('handicap')
                    try:hp=float(hp);ap=float(ap)
                    except:hp=ap=None
                    if ho and ao and hp is not None and ap is not None and abs(hp+ap)<1e-6:market={'key':'spreads','name':mname,'title':mname,'scope':{'map':None,'round':None,'set':None,'period':'full'},'line':abs(hp),'last_update':None,'outcomes':[{'name':home,'price':ho,'point':hp},{'name':away,'price':ao,'point':ap}]};hs['spreads']+=1
            elif mname in {'Total Points','Total Runs','Total'}:
                over=next((r for r in runners if 'over' in str(r.get('runnerName','')).lower()),None);under=next((r for r in runners if 'under' in str(r.get('runnerName','')).lower()),None)
                if over and under:
                    oo,uo=american(over),american(under);op=over.get('handicap');up=under.get('handicap')
                    try:op=float(op);up=float(up)
                    except:op=up=None
                    if oo and uo and op is not None and up is not None and abs(op-up)<1e-6:market={'key':'totals','name':mname,'title':mname,'scope':{'map':None,'round':None,'set':None,'period':'full'},'line':op,'last_update':None,'outcomes':[{'name':f'Over {op}','price':oo,'point':op},{'name':f'Under {op}','price':uo,'point':op}]};hs['totals']+=1
            if not market:continue
            rec=by_event.setdefault(eid,{'id':f'fanduel-direct:{sport}:{eid}','home_team':home,'away_team':away,'commence_time':ev.get('openDate'),'live':False,'markets':[]})
            rec['markets'].append(market);health['marketCount']+=1;hs['markets']+=1
        arr=out['sports'][sport].setdefault('exactV2',[]);arr[:]=[e for e in arr if not str(e.get('id','')).startswith(f'fanduel-direct:{sport}:')]
        for rec in by_event.values():
            if not rec['markets']:continue
            mk=rec.pop('markets');rec['bookmakers']=[{'key':'fanduel-direct','title':'FanDuel Direct','markets':mk}];arr.append(rec);health['acceptedEvents']+=1;hs['events']+=1
        out['sports'][sport]['exactV2EventCount']=len(arr)
    except Exception as e: health['errors'].append(f'{sport}: {type(e).__name__}: {e}')
health['ok']=health['acceptedEvents']>0;health['status']=200 if health['ok'] else 500;health['errors']=health['errors'][:20];health['fetchedAt']=datetime.now(timezone.utc).isoformat()
out.setdefault('providerHealth',{})['fanduel']=health;out['generatedAt']=health['fetchedAt']
with open(FILE,'w',encoding='utf-8') as f:json.dump(out,f,indent=2)
print('FANDUEL_DIRECT_HEALTH',json.dumps(health,separators=(',',':')))
