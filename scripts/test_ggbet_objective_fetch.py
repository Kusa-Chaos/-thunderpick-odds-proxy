import importlib.util
import io
import json
from pathlib import Path

p=Path('scripts/ggbet-objective-fetch.py')
spec=importlib.util.spec_from_file_location('ggbet_objective_fetch',p)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class FakePayload:
    def __init__(self,obj): self.obj=obj
    def read(self): return json.dumps(self.obj).encode()

class FakeClient:
    def invoke(self,**kwargs):
        assert kwargs['FunctionName']=='thunderpick-ggbet-objective-collector'
        assert kwargs['InvocationType']=='RequestResponse'
        return {'StatusCode':200,'Payload':FakePayload({'generatedAt':'2026-10-03T05:00:00+00:00','connected':True,'sports':{'lol':{'events':[{'id':'x'}]},'dota2':{'events':[]}},'errors':[]})}

out=mod.fetch_payload(FakeClient())
assert out['connected'] is True
assert out['errors']==[]
assert len(out['sports']['lol']['events'])==1
print('GGBET_OBJECTIVE_FETCH_VERIFIED')
