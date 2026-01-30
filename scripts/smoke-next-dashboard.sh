#!/usr/bin/env bash
set -euo pipefail

echo '--- smoke: next-dashboard ---'
cd "$(dirname "$0")/../examples/next-dashboard"

# Create .env file with dummy values for build
cat > .env << EOF
CLICKHOUSE_HOST=http://localhost:8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=default
CACHE_MODE=stale-while-revalidate
CACHE_TTL=5000
CACHE_STALE_TTL=60000
EOF

pnpm run lint >/dev/null
pnpm run build >/dev/null
echo 'next-dashboard smoke passed'
