import json
import re
from datetime import datetime, timezone
from urllib.parse import quote
from curl_cffi import requests as cffi_requests

FILE='data/direct-sources-latest.json'
LEAGUES={
    'basketball': 42648,
    'baseball': 84240,
}
LEAGUE_URL='https://sportsbook-nash.draftkings.com/api/sportscontent/dkusnj/v1/leagues/{league}'
SUBCAT_URL='https://sportsbook-nash.draftkings.com/api/sportscontent/dkusnj/v1/leagues/{league}/categories/{category}/subcategories/{subcategory}'

NBA_PATTERNS=[
    (re.compile(r'Points\s*[,+&]\s*Rebounds\s*[,+&]\s*Assists|Points\s*Rebounds\s*Assists|PRA',re.I),'points_rebounds_assists','Points + Rebounds + Assists'),
    (re.compile(r'Points\s*[+&]\s*Rebounds',re.I),'points_rebounds','Points + Rebounds'),
    (re.compile(r'Points\s*[+&]\s*Assists',re.I),'points_assists','Points + Assists'),
    (re.compile(r'Rebounds\s*[+&]\s*Assists',re.I),'rebounds_assists','Rebounds + Assists'),
    (re.compile(r'3[- ]?Pointers?(?: Made)?|Three[- ]?Pointers?(?: Made)?',re.I),'three_pointers','Three Pointers'),
    (re.compile(r'Rebounds?',re.I),'rebounds','Rebounds'),
    (re.compile(r'Assists?',re.I),'assists','Assists'),
    (re.compile(r'Steals?',re.I),'steals','Steals'),
    (re.compile(r'Blocks?',re.I),'blocks','Blocks'),
    (re.compile(r'Turnovers?',re.I),'turnovers','Turnovers'),
    (re.compile(r'Points?',re.I),'points','Points'),
]
MLB_PATTERNS=[
    (re.compile(r'Strikeouts?(?: Thrown)?',re.I),'strikeouts','Strikeouts'),
    (re.compile(r'Total Bases|Bases Recorded',re.I),'total_bases','Total Bases'),
    (re.compile(r'RBIs?|Runs Batted In',re.I),'rbi','RBI'),
    (re.compile(r'Walks?|Bases on Balls',re.I),'walks','Walks'),
    (re.compile(r'Hits?',re.I),'hits','Hits'),
    (re.compile(r'Runs Scored',re.I),'runs','Runs'),
]
PATTERNS={'basketball':NBA_PATTERNS,'baseball':MLB_PATTERNS}
EXCLUDE_SCOPE=re.compile(r'1Q|2Q|3Q|4Q|Quarter|1st Half|First Half|2nd Half|Second Half|Inning|First 5|F5|Drive|Longest|Alt\b|Milestone|Race To|Double Double|Triple Double',re.I)
GENERIC_PLAYER=re.compile(r'^(?:player|total|over under|o/u|points|rebounds|assists|hits|strikeouts|rbi|walks|total bases|runs)\s*$',re.I)

def dec(a):
    if a is None:return None
    try:n=int(str(a).replace('−','-').replace('+',''))
    except:return None
    if n>0:return 1+n/100
    if n<0:return 1+100/abs(n)
    return None

def get_json(url):
    r=cffi_requests.get(url,impersonate='chrome120',timeout=20,headers={'Accept':'application/json'})
    r.raise_for_status();return r.json()

def stat_from(sport,text):
    for rx,stat,label in PATTERNS[sport]:
        if rx.search(text): return stat,label,rx
    return None

def clean_player(market_name,rx):
    s=rx.sub(' ',str(market_name or ''))
    s=re.sub(r'\bO/U\b|\bOver/Under\b|\bTotal\b|\bPlayer\b',' ',s,flags=re.I)
    s=re.sub(r'\s+-\s+.*$',' ',s)
    s=re.sub(r'^\s*(?:Over|Under)\s+',' ',s,flags=re.I)
    s=re.sub(r'\s+',' ',s).strip(' -:')
    if not s or GENERIC_PLAYER.match(s): return None
    return s

def parse_pair(name):
    s=str(name or '')
    if ' @ ' in s:
        away,home=[x.strip() for x in s.split(' @ ',1)];return home,away
    if ' vs ' in s.lower():
        parts=re.split(r'\s+vs\.?\s+',s,maxsplit=1,flags=re.I)
        if len(parts)==2:return parts[0].strip(),parts[1].strip()
    return None

with open(FILE,'r',encoding='utf-8') as f: out=json.load(f)
health={'ok':False,'status':None,'acceptedEvents':0,'marketCount':0,'playerPropMarkets':0,'bySport':{},'errors':[],'fetchedAt':datetime.now(timezone.utc).isoformat()}

for sport,league_id in LEAGUES.items():
    hs=health['bySport'][sport]={'categories':0,'selectedSubcategories':0,'requests':0,'events':0,'markets':0,'byStat':{}}
    arr=out['sports'][sport].setdefault('exactV2',[])
    arr[:]=[e for e in arr if not str(e.get('id','')).startswith(f'draftkings-traditional-direct:{sport}:')]
    try:
        league=get_json(LEAGUE_URL.format(league=league_id))
        subs=league.get('subcategories',[]) or []
        hs['categories']=len(subs)
        selected=[]
        for sc in subs:
            name=str(sc.get('name',''))
            if EXCLUDE_SCOPE.search(name): continue
            if not stat_from(sport,name): continue
            cid,sid=sc.get('categoryId'),sc.get('id')
            if cid is None or sid is None: continue
            selected.append((str(cid),str(sid),name))
        seen=set();selected=[x for x in selected if not (x[1] in seen or seen.add(x[1]))]
        hs['selectedSubcategories']=len(selected)
        events={}
        for cid,sid,subname in selected:
            try:
                hs['requests']+=1
                data=get_json(SUBCAT_URL.format(league=league_id,category=cid,subcategory=sid))
                evs={str(e.get('id')):e for e in data.get('events',[]) if e.get('id') is not None}
                sels_by_market={}
                for s in data.get('selections',[]) or []:
                    sels_by_market.setdefault(str(s.get('marketId')),[]).append(s)
                for m in data.get('markets',[]) or []:
                    mid,eid=str(m.get('id')),str(m.get('eventId'))
                    ev=evs.get(eid)
                    if not ev: continue
                    pair=parse_pair(ev.get('name'))
                    if not pair: continue
                    home,away=pair
                    mname=str(m.get('name',''))
                    if EXCLUDE_SCOPE.search(mname): continue
                    info=stat_from(sport,mname) or stat_from(sport,subname)
                    if not info: continue
                    stat,stat_label,rx=info
                    player=clean_player(mname,rx)
                    if not player: continue
                    over=under=None
                    for s in sels_by_market.get(mid,[]):
                        lab=str(s.get('label',''))
                        price=dec((s.get('displayOdds') or {}).get('american'))
                        pts=s.get('points')
                        try:pts=float(pts) if pts is not None else None
                        except:pts=None
                        if re.search(r'\bOver\b',lab,re.I): over=(price,pts)
                        elif re.search(r'\bUnder\b',lab,re.I): under=(price,pts)
                    if not over or not under or not over[0] or not under[0]: continue
                    if over[1] is None or under[1] is None or abs(over[1]-under[1])>1e-9: continue
                    line=over[1]
                    market={
                        'key':f'player_{stat}','name':f'Player {player} - {stat_label}','title':mname,
                        'description':player,'player':player,
                        'specifiers':f'player={quote(player)}|stat={stat}|threshold={line}',
                        'scope':{'map':None,'round':None,'set':None,'period':'full'},
                        'line':line,'last_update':None,
                        'outcomes':[
                            {'name':f'Over {line}','price':over[0],'point':line,'description':player,'player':player},
                            {'name':f'Under {line}','price':under[0],'point':line,'description':player,'player':player}
                        ]
                    }
                    rec=events.setdefault(eid,{'id':f'draftkings-traditional-direct:{sport}:{eid}','home_team':home,'away_team':away,'commence_time':ev.get('startEventDate'),'live':False,'markets':[]})
                    sig=(market['key'],player.lower(),line)
                    if any((x.get('key'),str(x.get('player','')).lower(),x.get('line'))==sig for x in rec['markets']): continue
                    rec['markets'].append(market);health['marketCount']+=1;health['playerPropMarkets']+=1;hs['markets']+=1;hs['byStat'][stat]=hs['byStat'].get(stat,0)+1
            except Exception as e:
                health['errors'].append(f'{sport}:{subname}: {type(e).__name__}: {e}')
        for rec in events.values():
            if not rec['markets']: continue
            mk=rec.pop('markets');rec['bookmakers']=[{'key':'draftkings-direct','title':'DraftKings Direct','markets':mk}];arr.append(rec);health['acceptedEvents']+=1;hs['events']+=1
        out['sports'][sport]['exactV2EventCount']=len(arr)
    except Exception as e:
        health['errors'].append(f'{sport}: {type(e).__name__}: {e}')

health['ok']=health['acceptedEvents']>0 and health['playerPropMarkets']>0
health['status']=200 if health['ok'] else 500
health['errors']=health['errors'][:30];health['fetchedAt']=datetime.now(timezone.utc).isoformat()
out.setdefault('providerHealth',{})['draftkingsTraditional']=health
out['generatedAt']=health['fetchedAt']
with open(FILE,'w',encoding='utf-8') as f:json.dump(out,f,indent=2)
print('DRAFTKINGS_TRADITIONAL_HEALTH',json.dumps(health,separators=(',',':')))
