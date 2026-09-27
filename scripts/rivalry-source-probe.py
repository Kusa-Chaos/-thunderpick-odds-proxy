import json
from curl_cffi import requests

BASE='https://api.rivalry.com/api/v1'
out={'games':{},'matches':{},'errors':[]}

def get(path,params=None):
    r=requests.get(BASE+path,params=params,headers={'Accept':'application/json','User-Agent':'Mozilla/5.0'},impersonate='chrome120',timeout=20)
    return r

try:
    r=get('/games')
    out['games']['status']=r.status_code
    if r.status_code==200:
        j=r.json();data=j.get('data',[]);out['games']['count']=len(data);out['games']['data']=data[:50]
        ids={str(x.get('name','')).lower():x.get('id') for x in data}
        targets=[]
        for name,gid in ids.items():
            if any(k in name for k in ['counter','dota','league of legends','valorant']):targets.append((name,gid))
        for name,gid in targets:
            q=get('/matches',{'game_id':gid})
            row={'status':q.status_code,'count':0,'marketNames':{},'samples':[]}
            if q.status_code==200:
                body=q.json();matches=body.get('data',[]);row['count']=len(matches)
                counts={}
                for m in matches:
                    for market in m.get('markets',[]) or []:
                        mn=str(market.get('name',''));counts[mn]=counts.get(mn,0)+1
                    if len(row['samples'])<5:
                        row['samples'].append({
                            'id':m.get('id'),'scheduled_at':m.get('scheduled_at'),
                            'competitors':[x.get('name') for x in m.get('competitors',[])],
                            'markets':[{'name':mk.get('name'),'outcomes':[{'odds':o.get('odds'),'competitor':(o.get('competitor') or {}).get('name'),'name':o.get('name')} for o in (mk.get('outcomes') or [])[:6]]} for mk in (m.get('markets') or [])[:12]]
                        })
                row['marketNames']=counts
            else: row['body']=q.text[:300]
            out['matches'][name]=row
except Exception as e:
    out['errors'].append(f'{type(e).__name__}: {e}')

print('RIVALRY_SOURCE_PROBE',json.dumps(out,separators=(',',':')))
