#!/usr/bin/env bash
# Load data/*.sql into the remote D1 database, in order. Usage: bash scripts/load-db.sh [--local]
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:---remote}"
for f in data/01-schema.sql data/02-projects.sql data/03-retirements-*.sql data/04-fts.sql; do
  echo "== $f $(date +%T)"
  npx wrangler d1 execute truetonne "$TARGET" --file="$f" --yes
done
echo "done $(date +%T)"
