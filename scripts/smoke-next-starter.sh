#!/usr/bin/env bash
set -euo pipefail

echo '--- smoke: next-starter ---'
cd "$(dirname "$0")/../examples/next-starter"
pnpm run build >/dev/null
echo 'next-starter smoke passed'
