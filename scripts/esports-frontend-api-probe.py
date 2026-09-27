import json,re,urllib.parse
from curl_cffi import requests

SITES={
 'ggbet':'https://gg.bet/en/esports',
 'rainbet':'https://rainbet.com/sportsbook',
}
out={}
URL_RX=re.compile(r'https?://[^\"\'\\\s<>]+')
API_RX=re.compile(r'[\"\']([^\"\']*(?:api|sports|event|match|odds|market)[^\"\']*)[\"\']',re.I)
SCRIPT_RX=re.compile(r'<script[^>]+src=[\"\']([^\"\']+)[\"\']',re.I)

def fetch(url):
    return requests.get(url,impersonate='chrome120',headers={'User-Agent':'Mozilla/5.0','Accept':'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'},timeout=20,allow_redirects=True)

for name,url in SITES.items():
    row={'pageStatus':None,'finalUrl':None,'htmlLen':0,'scripts':[],'candidates':[],'errors':[]}
    try:
        r=fetch(url);row['pageStatus']=r.status_code;row['finalUrl']=r.url;row['htmlLen']=len(r.text)
        if r.status_code!=200:
            row['body']=r.text[:300];out[name]=row;continue
        scripts=[]
        for s in SCRIPT_RX.findall(r.text):
            u=urllib.parse.urljoin(r.url,s)
            if u not in scripts:scripts.append(u)
        row['scripts']=scripts[:30]
        cands=set()
        for u in scripts[:15]:
            try:
                q=fetch(u)
                if q.status_code!=200 or len(q.text)>8_000_000:continue
                txt=q.text
                for x in URL_RX.findall(txt):
                    if any(k in x.lower() for k in ['api','sport','event','match','odds','market']):cands.add(x[:500])
                for m in API_RX.finditer(txt):
                    x=m.group(1)
                    if 3<len(x)<500 and not x.startswith('data:'):cands.add(x)
            except Exception as e:
                row['errors'].append(f'{u[:100]}: {type(e).__name__}: {e}')
        row['candidates']=sorted(cands)[:150]
    except Exception as e:
        row['errors'].append(f'{type(e).__name__}: {e}')
    out[name]=row
print('ESPORTS_FRONTEND_API_PROBE',json.dumps(out,separators=(',',':')))
