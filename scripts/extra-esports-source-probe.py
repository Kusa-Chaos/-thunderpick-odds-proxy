import json, re
from datetime import datetime, timezone
from pathlib import Path
from curl_cffi import requests

OUT=Path('data/extra-esports-source-probe-latest.json')
SOURCES={
 'rainbet': ['https://rainbet.com/sportsbook'],
 'ggbet': ['https://gg.bet/en/esports','https://gg.bet/es/esports'],
 '1xbet': ['https://1xbet.com/en/esports/real'],
}
TOKENS={
 'cs2':[r'counter.?strike',r'cs\s?2',r'csgo'],
 'dota2':[r'dota\s?2'],
 'lol':[r'league of legends',r'\blol\b'],
 'valorant':[r'valorant'],
}
HEADERS={'accept':'text/html,application/xhtml+xml,application/json','user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36'}

def probe(name, urls):
    attempts=[]
    for url in urls:
        try:
            r=requests.get(url,headers=HEADERS,timeout=25,impersonate='chrome')
            text=r.text or ''
            low=text.lower()
            disciplines={k:any(re.search(p,low,re.I) for p in pats) for k,pats in TOKENS.items()}
            attempts.append({'url':url,'status':r.status_code,'bytes':len(r.content or b''),'contentType':r.headers.get('content-type'),'disciplines':disciplines,'cloudflare':('cf-ray' in {k.lower() for k in r.headers.keys()}),'blocked':r.status_code in (401,403,406,429)})
            if r.status_code==200 and len(text)>1000:
                return {'ok':True,'selectedUrl':url,'attempts':attempts,'disciplines':disciplines,'note':'Public page reachable. This is discovery only; no source-family credit until exact odds contracts are parsed.'}
        except Exception as e:
            attempts.append({'url':url,'error':str(e)})
    return {'ok':False,'attempts':attempts,'note':'No usable public response from this runner. Keep source disabled; do not count it.'}

out={'generatedAt':datetime.now(timezone.utc).isoformat(),'mode':'direct-public-probe','policy':{'aggregatorFallback':False,'countOnlyAfterExactOddsParsing':True,'sameProviderCountsOnce':True},'sources':{k:probe(k,v) for k,v in SOURCES.items()}}
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps(out,indent=2))
print(json.dumps(out,indent=2))
