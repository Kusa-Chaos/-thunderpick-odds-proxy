import datetime
import json
import os

FUNCTION=os.environ.get('GGBET_LAMBDA_FUNCTION','thunderpick-ggbet-objective-collector')
REGION=os.environ.get('GGBET_LAMBDA_REGION','eu-central-1')
OUT=os.environ.get('GGBET_RAW_FILE','data/ggbet-objective-raw-latest.json')


def fetch_payload(client):
    response=client.invoke(FunctionName=FUNCTION,InvocationType='RequestResponse',Payload=b'{}')
    raw=response['Payload'].read()
    if isinstance(raw,(bytes,bytearray)):
        raw=raw.decode('utf-8','replace')
    payload=json.loads(raw)
    if response.get('FunctionError'):
        raise RuntimeError(f"Lambda FunctionError: {response['FunctionError']}")
    return payload


def fail_closed(error):
    return {
        'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'connected':False,
        'sports':{'lol':{'events':[]},'dota2':{'events':[]}},
        'errors':[str(error)],
        'discovery':{'lol':0,'dota2':0},
        'fetched':{'selected':0,'successful':0,'failed':0,'objectiveMarkets':0},
    }


def main():
    try:
        import boto3
        client=boto3.client('lambda',region_name=REGION)
        payload=fetch_payload(client)
    except Exception as exc:
        payload=fail_closed(exc)
    os.makedirs(os.path.dirname(OUT) or '.',exist_ok=True)
    with open(OUT,'w',encoding='utf-8') as f:
        json.dump(payload,f)
    print('GGBET_LAMBDA_RAW',json.dumps({
        'generatedAt':payload.get('generatedAt'),
        'connected':payload.get('connected'),
        'discovery':payload.get('discovery'),
        'fetched':payload.get('fetched'),
        'errors':payload.get('errors'),
    }))


if __name__=='__main__':
    main()
