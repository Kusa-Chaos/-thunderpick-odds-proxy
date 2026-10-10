#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(git rev-parse --show-toplevel)"
if [[ -f scripts/pinnwire-aws-direct.py ]] && python3 scripts/pinnwire-aws-direct.py; then
  echo "PINNWIRE_AWS_DIRECT_CONNECTED"
  exit 0
fi
echo "PINNWIRE_AWS_DIRECT_UNAVAILABLE_FALLBACK"
if [[ -f scripts/refresh-pinnwire-source-artifact.sh ]]; then
  bash scripts/refresh-pinnwire-source-artifact.sh || echo "WARN pinnwire refresh unavailable"
fi
if [[ -f scripts/pinnwire-bridge.mjs ]]; then
  node scripts/pinnwire-bridge.mjs import || echo "WARN pinnwire import unavailable"
fi
