#!/usr/bin/env bash
set -euo pipefail

echo '--- smoke: vite-starter ---'
cd "$(dirname "$0")/../examples/vite-starter"
pnpm run build >/dev/null
echo 'vite-starter smoke passed'
