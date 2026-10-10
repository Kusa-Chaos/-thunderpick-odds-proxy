import os
import pathlib
import shutil
import subprocess
import tempfile

root=pathlib.Path(tempfile.mkdtemp(prefix="tp-pinnwire-boto3-"))
source=pathlib.Path(__file__).resolve().parent
try:
 (root/"scripts").mkdir()
 (root/"bin").mkdir()
 (root/"stub").mkdir()
 (root/"data").mkdir()
 subprocess.run(["git","init","-q"],cwd=root,check=True)
 for name in ["pinnwire-aws-direct.py","collect-pinnwire-aws.sh"]:
  shutil.copyfile(source/name,root/"scripts"/name)
 (root/"scripts"/"pinnwire-direct.mjs").write_text("")
 (root/"scripts"/"pinnwire-bridge.mjs").write_text("")
 (root/"stub"/"boto3.py").write_text('''import os
class Client:
 def get_parameter(self,Name,WithDecryption):
  assert Name=="/thunderpick/pinnwire-api-key" and WithDecryption is True
  if not os.environ.get("MOCK_AWS_KEY"):raise RuntimeError("missing key")
  return {"Parameter":{"Value":os.environ["MOCK_AWS_KEY"]}}
def client(service_name,region_name):
 assert service_name=="ssm" and region_name=="us-east-2"
 return Client()
''')
 node=root/"bin"/"node"
 node.write_text('''#!/bin/sh
if [ "$1" = "scripts/pinnwire-direct.mjs" ];then
  echo direct >> "$TEST_MARKER"
  [ "$PINNWIRE_API_KEY" = "INTEGRATION_TEST_KEY" ] || exit 8
  if [ "$MOCK_DIRECT_STATE" = "bad" ];then
    printf '{"providerHealth":{"pinnwire":{"ok":false,"status":429,"acceptedEvents":0}}}' > data/direct-sources-latest.json
  else
    printf '{"providerHealth":{"pinnwire":{"ok":true,"status":200,"acceptedEvents":7,"acceptedMarkets":50}}}' > data/direct-sources-latest.json
  fi
elif [ "$1" = "scripts/pinnwire-bridge.mjs" ];then
  echo fallback-import >> "$TEST_MARKER"
fi
''')
 node.chmod(0o755)
 fallback=root/"scripts"/"refresh-pinnwire-source-artifact.sh"
 fallback.write_text('#!/bin/sh\necho fallback-refresh >> "$TEST_MARKER"\n')
 fallback.chmod(0o755)
 def check(key,state):
  marker=root/"marker"
  marker.write_text("")
  env={
   **os.environ,
   "PATH":str(root/"bin")+":"+os.environ["PATH"],
   "PYTHONPATH":str(root/"stub"),
   "TEST_MARKER":str(marker),
   "MOCK_AWS_KEY":key,
   "MOCK_DIRECT_STATE":state,
  }
  p=subprocess.run(
   ["bash",str(root/"scripts"/"collect-pinnwire-aws.sh")],
   cwd=root,env=env,text=True,capture_output=True,timeout=15,
  )
  assert p.returncode==0,(p.returncode,p.stdout,p.stderr)
  assert "INTEGRATION_TEST_KEY" not in p.stdout
  return p.stdout,marker.read_text().splitlines()
 healthy,steps=check("INTEGRATION_TEST_KEY","ok")
 assert steps==["direct"],steps
 assert "PINNWIRE_AWS_DIRECT_CONNECTED" in healthy
 no_key,steps=check("","ok")
 assert steps==["fallback-refresh","fallback-import"],steps
 bad_quote,steps=check("INTEGRATION_TEST_KEY","bad")
 assert steps==["direct","fallback-refresh","fallback-import"],steps
 assert "PINNWIRE_AWS_DIRECT_CONNECTED" not in bad_quote
 print("PINNWIRE_BOTO3_DIRECT_FALLBACK_VERIFIED")
finally:
 shutil.rmtree(root)
