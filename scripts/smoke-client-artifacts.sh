#!/usr/bin/env bash
set -euo pipefail
HQ_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
HQ_ARTIFACTS="$(mktemp -d "${TMPDIR:-/tmp}/hq-client-artifacts-XXXXXX")"
trap 'rm -rf "$HQ_ARTIFACTS"' EXIT
cd "$HQ_ROOT"
# Run after the workspace build, like the other consumer smokes. Prepack verifies
# each package's own build; dependencies have already been built by the caller.
pnpm --filter @hypequery/react --filter @hypequery/datasets --filter @hypequery/mcp pack --pack-destination "$HQ_ARTIFACTS" >"$HQ_ARTIFACTS/pack.log" 2>&1 || { cat "$HQ_ARTIFACTS/pack.log"; exit 1; }
node scripts/audit-client-packages.mjs "$HQ_ARTIFACTS"
