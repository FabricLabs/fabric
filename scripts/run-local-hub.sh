#!/usr/bin/env bash
# Run @fabric/hub from a sibling clone with Fabric state under this repo (safe for sandboxes / one-off dev).
# Usage (from fabric-clean): bash scripts/run-local-hub.sh
# Optional: FABRIC_BITCOIN_ENABLE=false to skip bitcoind (faster UI + extension login testing).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HUB="${HUB_REPO:-$ROOT/../hub.fabric.pub}"
if [[ ! -f "$HUB/scripts/hub.js" ]]; then
  echo "Expected Hub at: $HUB (set HUB_REPO=...)" >&2
  exit 1
fi
export FABRIC_HUB_USER_DATA="${FABRIC_HUB_USER_DATA:-$ROOT/.hub-dev-data}"
export FABRIC_BITCOIN_ENABLE="${FABRIC_BITCOIN_ENABLE:-false}"
mkdir -p "$FABRIC_HUB_USER_DATA/stores/hub"
echo "Hub user data: $FABRIC_HUB_USER_DATA"
echo "HTTP: http://127.0.0.1:8080  |  For webpack+HMR also run: (cd \"$HUB\" && npm run dev) → http://127.0.0.1:3000"
cd "$HUB"
exec node scripts/hub.js
