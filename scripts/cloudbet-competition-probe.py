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

def events_from_comp(body):
    if not isinstance(body,dict): return []
    events=body.get('events') or (body.get('competition') or {}).get('events') or []
    return events if isinstance(events,list) else []

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
        params=[]
        for market in config.get('markets',[]): params.append(('markets',market))
        qs=urllib.parse.urlencode(params)
        url=f"{cb.BASE}/competitions/{urllib.parse.quote(str(comp.get('key')),safe='-')}" + (f'?{qs}' if qs else '')
        comp_body=cb.request_json(url,key); events=events_from_comp(comp_body)
        row['bulkRawEvents']=len(events); normalized=[]
        for event in events:
            n=cb.normalize_event(event,canon)
            if n: normalized.append(n)
        row['bulkUsableMatchWinner']=len(normalized)
        row['bulkMarketKeys']=list(((events[0] if events else {}).get('markets') or {}).keys())[:12]
        row['state']='OK'
    except Exception as e:
        row['state']='ERROR'; row['error']=cb.sanitize_error(e)
    results.append(row)
print(json.dumps(results,separators=(',',':')))
