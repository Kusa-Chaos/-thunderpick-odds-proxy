import json
from curl_cffi import requests

OUT={}

def get(url,params=None,headers=None):
    r=requests.get(url,params=params,headers=headers or {},impersonate='chrome120',timeout=20)
    return {'status':r.status_code,'text':r.text,'headers':dict(r.headers)}

# BetMGM: discover current access id and list grouping names.
try:
    cfg=get('https://www.nj.betmgm.com/en/api/clientconfig',headers={'x-bwin-browser-url':'https://www.nj.betmgm.com/en/sports','X-From-Product':'host-app'})
    row={'configStatus':cfg['status'],'groups':{},'errors':[]}
    access=None
    if cfg['status']==200:
        data=json.loads(cfg['text'])
        grouping=(data.get('msPreloader') or {}).get('groupingUrl','')
        if 'x-bwin-accessid=' in grouping:
            access=grouping.split('x-bwin-accessid=',1)[1].split('&',1)[0]
    row['accessFound']=bool(access)
    if access:
        gr=get('https://sports.nj.betmgm.com/cds-api/offer-grouping/grid-view/all',params={'x-bwin-accessid':access,'lang':'en-us','country':'US','usercountry':'US'})
        row['gridStatus']=gr['status']
        if gr['status']==200:
            items=json.loads(gr['text'])
            for item in items:
                sid=str(item.get('sportId'))
                if sid not in {'7','11','23'}: continue
                groups=[]
                for g in item.get('groups',[]):
                    name=str(g.get('name',''))
                    if any(k in name.lower() for k in ['player','prop','passing','receiv','rush','point','rebound','assist','strikeout','hit','base','rbi']):
                        groups.append({'name':name,'id':g.get('id')})
                row['groups'][sid]=groups
            # Probe up to 4 interesting groups per sport for option market names.
            comps={'7':'6004','11':'35','23':'75'}
            sports={'7':'nba','11':'nfl','23':'mlb'}
            row['samples']={}
            for sid,groups in row['groups'].items():
                arr=[]
                for g in groups[:4]:
                    q=get('https://sports.nj.betmgm.com/cds-api/bettingoffer/fixtures',params={
                        'x-bwin-accessid':access,'lang':'en-us','country':'US','userCountry':'US','offerMapping':'Filtered',
                        'sportIds':sid,'competitionIds':comps[sid],'fixtureTypes':'Standard','sortBy':'StartDate','offerCategories':'Gridable','gridGroupId':g['id']})
                    sample={'group':g,'status':q['status'],'fixtures':0,'marketNames':[]}
                    if q['status']==200:
                        body=json.loads(q['text']);fixtures=body.get('fixtures',[]);sample['fixtures']=len(fixtures)
                        names=[]
                        for f in fixtures[:4]:
                            for m in f.get('optionMarkets',[]):
                                n=(m.get('name') or {}).get('value','')
                                if n and n not in names:names.append(n)
                        sample['marketNames']=names[:25]
                    arr.append(sample)
                row['samples'][sports[sid]]=arr
    OUT['betmgm']=row
except Exception as e:
    OUT['betmgm']={'error':f'{type(e).__name__}: {e}'}

# Caesars: schedule endpoint; inspect market names for player-like content if already embedded.
try:
    defs={
      'nfl':('americanfootball','007d7c61-07a7-4e18-bb40-15104b6eac92'),
      'nba':('basketball','5806c896-4eec-4de1-874f-afed93114b8c'),
      'mlb':('baseball','04f90892-3afa-4e84-acce-5b89f151063d')}
    cr={}
    for label,(sid,cid) in defs.items():
        q=get(f'https://api.americanwagering.com/regions/us/locations/nj/brands/czr/sb/v3/sports/{sid}/events/schedule',params={'competitionIds':cid},headers={'Accept':'application/json'})
        x={'status':q['status'],'events':0,'playerLikeMarkets':[],'allMarketCount':0}
        if q['status']==200:
            body=json.loads(q['text']);comps=body.get('competitions',[]);events=(comps[0].get('events',[]) if comps else []);x['events']=len(events)
            names=[]
            for ev in events[:10]:
                for m in ev.get('markets',[]):
                    x['allMarketCount']+=1
                    n=str(m.get('displayName') or m.get('name') or '').strip('| ')
                    if any(k in n.lower() for k in ['player','passing','receiv','rush','reception','point','rebound','assist','strikeout','total bases','rbi']) and n not in names:
                        names.append(n)
            x['playerLikeMarkets']=names[:40]
        cr[label]=x
    OUT['caesars']=cr
except Exception as e:
    OUT['caesars']={'error':f'{type(e).__name__}: {e}'}

print('BETMGM_CAESARS_PROP_PROBE',json.dumps(OUT,separators=(',',':')))
