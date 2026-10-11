import urllib.parse

SUPPORTED_MARKETS={
    'lol':[
        'league_of_legends.map_xth_kill',
        'league_of_legends.map_xth_tower',
        'league_of_legends.map_xth_baron',
        'league_of_legends.map_xth_dragon',
        'league_of_legends.map_total_kills',
        'league_of_legends.map_team_total_kills',
    ],
    'dota2':[
        'dota_2.map_race_to_xth_kills',
        'dota_2.map_xth_kill',
        'dota_2.map_total_kills_v2',
        'dota_2.map_team_total_kills',
    ],
}

def _parse(raw):
    q=urllib.parse.parse_qs(str(raw or ''),keep_blank_values=True)
    return {k:v[-1] for k,v in q.items() if v}

def _params(sel,subkey=''):
    out=_parse(subkey); out.update(_parse(sel.get('grouping_parameters',''))); out.update(_parse(sel.get('params',''))); return out

def _number(v):
    try: return float(v)
    except (TypeError,ValueError): return None

def _clean_num(v):
    n=_number(v)
    if n is None:return None
    return int(n) if n.is_integer() else n

def _enabled(sel):
    if str(sel.get('status') or '').upper() not in ('','SELECTION_ENABLED'):return False
    if str(sel.get('side') or 'BACK').upper()!='BACK':return False
    p=_number(sel.get('price'))
    return p is not None and p>1

def _market(name,key,map_no,line,outcomes):
    return {'key':key,'name':name,'scope':{'map':map_no},'line':line,'settlementScope':'standard','last_update':None,'outcomes':outcomes}

def normalize_objective_market(market_key,market,home,away):
    submarkets=(market or {}).get('submarkets') or {}
    rows=[]
    team_keys={
      'league_of_legends.map_xth_kill':'kill',
      'league_of_legends.map_xth_tower':'tower',
      'league_of_legends.map_xth_baron':'baron',
      'league_of_legends.map_xth_dragon':'dragon',
      'league_of_legends.map_xth_inhibitor':'inhibitor',
      'dota_2.map_race_to_xth_kills':'kill',
      'dota_2.map_xth_kill':'kill',
    }
    total_keys={
      'league_of_legends.map_total_kills':'total',
      'league_of_legends.map_team_total_kills':'team',
      'dota_2.map_total_kills_v2':'total',
      'dota_2.map_team_total_kills':'team',
    }
    for subkey,sub in submarkets.items():
        sels=[s for s in ((sub or {}).get('selections') or []) if isinstance(s,dict) and _enabled(s)]
        if market_key in team_keys:
            groups={}
            for s in sels:
                p=_params(s,subkey); mp=_clean_num(p.get('map')); xth=_clean_num(p.get('xth'))
                if mp is None or xth is None:continue
                groups.setdefault((mp,xth),{})[str(s.get('outcome') or '').lower()]=s
            for (mp,xth),g in groups.items():
                if not ('home' in g and 'away' in g):continue
                kind=team_keys[market_key]
                if kind=='kill':name=f'Map {mp} - First Blood' if xth==1 else f'Map {mp} - First to {xth} Kills'
                elif xth!=1:continue
                elif kind=='tower':name=f'Map {mp} - First Tower'
                elif kind=='baron':name=f'Map {mp} - First Baron'
                elif kind=='dragon':name=f'Map {mp} - First Dragon'
                elif kind=='inhibitor':name=f'Map {mp} - First Inhibitor'
                else:continue
                rows.append(_market(name,market_key,mp,xth if kind=='kill' and xth!=1 else None,[
                    {'name':home,'type':'home','price':float(g['home']['price'])},
                    {'name':away,'type':'away','price':float(g['away']['price'])},
                ]))
        elif market_key in total_keys:
            groups={}
            for s in sels:
                p=_params(s,subkey); mp=_clean_num(p.get('map')); total=_clean_num(p.get('total')); team=str(p.get('team') or '')
                if mp is None or total is None:continue
                if market_key.endswith('map_team_total_kills') and team not in ('home','away'):continue
                groups.setdefault((mp,total,team),{})[str(s.get('outcome') or '').lower()]=s
            for (mp,total,team),g in groups.items():
                if not ('over' in g and 'under' in g):continue
                if market_key.endswith('map_team_total_kills'):
                    target=home if team=='home' else away
                    name=f'Map {mp} - {target} Total Kills'
                else:name=f'Map {mp} - Total Kills'
                rows.append(_market(name,market_key,mp,total,[
                    {'name':'Over','type':'over','price':float(g['over']['price'])},
                    {'name':'Under','type':'under','price':float(g['under']['price'])},
                ]))
    return rows

def objective_markets_from_event(event):
    home=event.get('home'); away=event.get('away')
    if isinstance(home,dict):home=home.get('name') or home.get('key')
    if isinstance(away,dict):away=away.get('name') or away.get('key')
    if not home or not away:return []
    markets=event.get('markets') or {}
    out=[]
    for key,market in markets.items():out.extend(normalize_objective_market(key,market,str(home),str(away)))
    return out

def build_objective_event_row(event):
    home=event.get('home'); away=event.get('away')
    if isinstance(home,dict):home=home.get('name') or home.get('key')
    if isinstance(away,dict):away=away.get('name') or away.get('key')
    markets=objective_markets_from_event(event)
    eid=event.get('id') or event.get('key')
    if not eid or not home or not away or not markets:return None
    return {'id':'cloudbet-objective:'+str(eid),'home_team':str(home),'away_team':str(away),'commence_time':event.get('cutoffTime') or event.get('startTime'),'live':False,'bookmakers':[{'key':'cloudbet-objective','title':'Cloudbet','markets':markets}]}
