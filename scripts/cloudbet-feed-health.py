import json, os, subprocess, sys, urllib.error, urllib.request

SECRET_NAME='thunderpick/cloudbet-api-key'

def emit(state, **extra):
    print(json.dumps({'ok': state == 'OK', 'state': state, **extra}))

def load_key():
    key=os.environ.get('CLOUDBET_API_KEY','').strip()
    if key:
        return key
    try:
        proc=subprocess.run(['aws','secretsmanager','get-secret-value','--region','us-east-2','--secret-id',SECRET_NAME,'--query','SecretString','--output','text'],check=True,capture_output=True,text=True)
        return proc.stdout.strip()
    except Exception:
        emit('SECRET_LOAD_FAILED')
        sys.exit(2)

key=load_key()
if not key:
    emit('SECRET_LOAD_FAILED')
    sys.exit(2)
req=urllib.request.Request('https://sports-api.cloudbet.com/pub/v2/odds/sports',headers={'Accept':'application/json','X-API-Key':key})
try:
    with urllib.request.urlopen(req,timeout=30) as r:
        data=json.load(r)
    emit('OK', sports=len(data.get('sports',[])))
except urllib.error.HTTPError as e:
    if e.code == 401: emit('HTTP_401')
    elif e.code == 403: emit('HTTP_403')
    elif e.code == 404: emit('HTTP_404')
    else: emit('HTTP_ERROR', status=int(e.code))
    sys.exit(3)
except Exception:
    emit('NETWORK_ERROR')
    sys.exit(4)
