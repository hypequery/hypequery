#!/usr/bin/env bash
set -euo pipefail

echo '--- smoke: node-embedded ---'
cd "$(dirname "$0")/../examples/node-embedded"
pnpm run build >/dev/null
echo 'node-embedded smoke passed'
