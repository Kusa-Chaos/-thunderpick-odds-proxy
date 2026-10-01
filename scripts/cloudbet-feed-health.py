import json, os, urllib.request
key=os.environ.get('CLOUDBET_API_KEY','')
req=urllib.request.Request('https://sports-api.cloudbet.com/pub/v2/odds/sports',headers={'Accept':'application/json','X-API-Key':key})
with urllib.request.urlopen(req,timeout=30) as r:
    data=json.load(r)
print(json.dumps({'ok':True,'sports':len(data.get('sports',[]))}))
