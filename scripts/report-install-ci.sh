#!/usr/bin/env bash
# CI-safe sibling of `npm run report:install`: writes the same reports/install.log
# shape (leading `$ npm …` line + full npm output) but uses `npm ci` and does not
# delete node_modules or package-lock.json.
set -euo pipefail
mkdir -p reports
{
  echo '$ npm ci'
  npm ci --loglevel verbose
} 2>&1 | tee reports/install.log
