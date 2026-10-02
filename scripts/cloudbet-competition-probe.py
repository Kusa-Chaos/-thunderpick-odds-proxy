import importlib.util, json, urllib.parse

spec=importlib.util.spec_from_file_location('cb','scripts/cloudbet-direct.py')
cb=importlib.util.module_from_spec(spec); spec.loader.exec_module(cb)
key=cb.load_key()
sport_keys,_,inventory=cb.resolve_sport_api_keys(key)

def competition_rows(body):
    if not isinstance(body,dict): return []
    root=body.get('sport') if isinstance(body.get('sport'),dict) else body
    out=[]
    for cat in root.get('categories',[]) or []:
        for comp in (cat or {}).get('competitions',[]) or []:
            if isinstance(comp,dict) and comp.get('key') and (comp.get('eventCount') or 0)>0: out.append(comp)
    for comp in root.get('competitions',[]) or []:
        if isinstance(comp,dict) and comp.get('key') and (comp.get('eventCount') or 0)>0: out.append(comp)
    seen=set(); dedup=[]
    for comp in out:
        if comp['key'] not in seen: seen.add(comp['key']); dedup.append(comp)
    return dedup

def event_from_comp(body):
    if not isinstance(body,dict): return None
    events=body.get('events') or (body.get('competition') or {}).get('events') or []
    return events[0] if isinstance(events,list) and events else None

results=[]
for canon,config in cb.SPORT_CONFIG.items():
    slug=sport_keys.get(canon) or config.get('fallbackSport')
    row={'sport':canon,'sportApiKey':slug,'catalog':inventory.get(canon)}
    try:
        sport=cb.request_json(f"{cb.BASE}/sports/{urllib.parse.quote(slug,safe='-')}",key)
        comps=competition_rows(sport); row['activeCompetitions']=len(comps)
        if not comps:
            row['state']='NO_COMPETITIONS'; results.append(row); continue
        comp=comps[0]; row['competitionKey']=comp.get('key'); row['competitionEventCount']=comp.get('eventCount')
        comp_body=cb.request_json(f"{cb.BASE}/competitions/{urllib.parse.quote(str(comp.get('key')),safe='-')}",key)
        event=event_from_comp(comp_body)
        if not event or not event.get('id'):
            row['state']='NO_EVENT_IN_COMPETITION'; results.append(row); continue
        row['eventId']=event.get('id')
        detail=cb.request_json(f"{cb.BASE}/events/{event.get('id')}",key)
        event_detail=detail.get('event') if isinstance(detail,dict) and isinstance(detail.get('event'),dict) else detail
        markets=(event_detail or {}).get('markets') or {}
        row['marketKeys']=list(markets.keys())[:20]
        enabled=0
        for market in markets.values():
            for sub in ((market or {}).get('submarkets') or {}).values():
                for sel in ((sub or {}).get('selections') or []):
                    try: price=float(sel.get('price'))
                    except Exception: price=0
                    if str(sel.get('status') or '').upper()=='SELECTION_ENABLED' and price>1: enabled+=1
        row['enabledPricedSelections']=enabled; row['state']='OK'
    except Exception as e:
        row['state']='ERROR'; row['error']=cb.sanitize_error(e)
    results.append(row)
print(json.dumps(results,separators=(',',':')))
