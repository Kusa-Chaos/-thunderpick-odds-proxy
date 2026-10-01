import json

FILE='data/direct-sources-latest.json'
SOURCE='cloudbet-direct'
EVENT_PREFIX='cloudbet-direct:'
MARKET='Match Winner'
HEADER='X-API-Key'

def main():
    with open(FILE) as f:
        out=json.load(f)
    out.setdefault('providerHealth',{})['cloudbet']={'ok':False,'source':SOURCE,'market':MARKET,'state':'COLLECTOR_NOT_CONNECTED'}
    with open(FILE,'w') as f:
        json.dump(out,f,indent=2)

if __name__=='__main__':
    main()
