#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(git rev-parse --show-toplevel)"
key="$(aws ssm get-parameter \
  --region us-east-2 \
  --name /thunderpick/pinnwire-api-key \
  --with-decryption \
  --query Parameter.Value \
  --output text 2>/dev/null || true)"
if [[ -n "$key" && "$key" != "None" ]]; then
  if PINNWIRE_API_KEY="$key" node scripts/pinnwire-direct.mjs; then
    if python3 - <<'PY'
import json
try:
 d=json.load(open('data/direct-sources-latest.json'))
 h=d.get('providerHealth',{}).get('pinnwire',{})
 assert h.get('ok') is True and h.get('status')==200 and h.get('acceptedEvents',0)>0
except Exception:
 raise SystemExit(1)
PY
    then
      unset key
      echo 'PINNWIRE_AWS_DIRECT_CONNECTED'
      exit 0
    fi
  fi
  echo 'PINNWIRE_AWS_DIRECT_UNUSABLE_FALLBACK'
else
  echo 'PINNWIRE_AWS_KEY_UNAVAILABLE_FALLBACK'
fi
unset key
if [[ -f scripts/refresh-pinnwire-source-artifact.sh ]]; then
  bash scripts/refresh-pinnwire-source-artifact.sh || echo 'WARN pinnwire refresh unavailable'
fi
if [[ -f scripts/pinnwire-bridge.mjs ]]; then
  node scripts/pinnwire-bridge.mjs import || echo 'WARN pinnwire import unavailable'
fi
