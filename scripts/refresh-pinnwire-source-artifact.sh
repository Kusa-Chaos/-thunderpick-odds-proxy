#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(git rev-parse --show-toplevel)"
if ! git fetch -q origin main; then
  echo "PINNWIRE_REFRESH_UNAVAILABLE git_fetch_failed"
  exit 0
fi
mkdir -p data
tmp=$(mktemp data/.pinnwire-refresh-XXXXXXXX.json)
trap 'rm -f "$tmp"' EXIT
if ! git show FETCH_HEAD:data/pinnwire-source-latest.json >"$tmp" 2>/dev/null; then
  echo "PINNWIRE_REFRESH_UNAVAILABLE missing_in_origin_main"
  exit 0
fi
if ! node -e '
const fs=require("node:fs");
const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
if(d.source!=="pinnwire-github-readonly-snapshot" || !Number.isFinite(Date.parse(d.generatedAt||"")) || !d.providerHealth?.pinnwire || !d.sports || typeof d.sports!=="object") process.exit(2);
' "$tmp"; then
  echo "PINNWIRE_REFRESH_UNAVAILABLE invalid_artifact"
  exit 0
fi
mv -f "$tmp" data/pinnwire-source-latest.json
echo "PINNWIRE_REFRESHED latest_origin_main"
