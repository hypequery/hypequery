#!/usr/bin/env bash
set -euo pipefail

echo '--- smoke: next-dashboard ---'
cd "$(dirname "$0")/../examples/next-dashboard"
pnpm run lint >/dev/null
pnpm run build >/dev/null
echo 'next-dashboard smoke passed'
