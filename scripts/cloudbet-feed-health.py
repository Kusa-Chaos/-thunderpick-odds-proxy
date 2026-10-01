import json, os, subprocess, urllib.request

SECRET_NAME='thunderpick/cloudbet-api-key'

def load_key():
    key=os.environ.get('CLOUDBET_API_KEY','').strip()
    if key:
        return key
    proc=subprocess.run(['aws','secretsmanager','get-secret-value','--region','us-east-2','--secret-id',SECRET_NAME,'--query','SecretString','--output','text'],check=True,capture_output=True,text=True)
    return proc.stdout.strip()

key=load_key()
if not key:
    raise RuntimeError('Cloudbet API key unavailable')
req=urllib.request.Request('https://sports-api.cloudbet.com/pub/v2/odds/sports',headers={'Accept':'application/json','X-API-Key':key})
with urllib.request.urlopen(req,timeout=30) as r:
    data=json.load(r)
print(json.dumps({'ok':True,'sports':len(data.get('sports',[]))}))
