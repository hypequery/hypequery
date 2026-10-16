#!/usr/bin/env bash
set -euo pipefail
HQ_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
HQ_TUTORIAL="$(mktemp -d "${TMPDIR:-/tmp}/hq-python-tutorial-XXXXXX")"
HQ_TUTORIAL="$(cd "$HQ_TUTORIAL" && pwd -P)"
if [[ "${HYPEQUERY_TUTORIAL_REACT_MAJOR:-19}" != '18' && "${HYPEQUERY_TUTORIAL_REACT_MAJOR:-19}" != '19' ]]; then
  printf 'HYPEQUERY_TUTORIAL_REACT_MAJOR must be 18 or 19.\n' >&2
  exit 2
fi
mkdir -p "$HQ_TUTORIAL/artifacts" "$HQ_TUTORIAL/backend"
cd "$HQ_ROOT"
pnpm --filter '@hypequery/cli...' --filter '@hypequery/react...' -r build
for package in protocol datasets mcp-server clickhouse serve deployment cli react; do
  (cd "$HQ_ROOT/packages/$package" && pnpm pack --pack-destination "$HQ_TUTORIAL/artifacts")
done
node scripts/audit-client-packages.mjs "$HQ_TUTORIAL/artifacts"
uv build --project python/hypequery --out-dir "$HQ_TUTORIAL/artifacts"
(cd python/hypequery && tar --exclude=__pycache__ --exclude=node_modules --exclude=client.generated.ts --exclude=contract.json --exclude=app.js --exclude=app.meta.json --exclude=package-lock.json -cf - examples/client_dashboard examples/utils examples/__init__.py) | (cd "$HQ_TUTORIAL/backend" && tar -xf -)
HQ_WHEELS=("$HQ_TUTORIAL"/artifacts/*.whl)
uv venv "$HQ_TUTORIAL/.venv"
uv pip install --python "$HQ_TUTORIAL/.venv/bin/python" "${HQ_WHEELS[0]}[fastapi,clickhouse]"
cd "$HQ_TUTORIAL/backend"
"$HQ_TUTORIAL/.venv/bin/python" -m hypequery export client-contract --factory examples.client_dashboard.definitions:build --output examples/client_dashboard/frontend/contract.json
cd examples/client_dashboard/frontend
HQ_TARBALLS=("$HQ_TUTORIAL"/artifacts/*.tgz)
npm install --omit=optional "${HQ_TARBALLS[@]}"
if [[ "${HYPEQUERY_TUTORIAL_REACT_MAJOR:-19}" == '18' ]]; then
  npm install --omit=optional react@18 react-dom@18 @types/react@18 @types/react-dom@18
fi
npm run generate
npm run check:generated
npm run build
node "$HQ_ROOT/scripts/utils/audit-python-browser-bundle.mjs" public/app.meta.json
printf '\nPrepared tutorial (workspace artifacts, no database touched): %s\n' "$HQ_TUTORIAL"
printf 'Backend directory: %s/backend\nFrontend directory: %s/backend/examples/client_dashboard/frontend\n' "$HQ_TUTORIAL" "$HQ_TUTORIAL"
printf 'Set ClickHouse/user-token variables, seed the tutorial database, and follow examples/client_dashboard/README.md.\n'
if [[ -n "${HYPEQUERY_TUTORIAL_DIRECTORY_FILE:-}" ]]; then
  printf '%s\n' "$HQ_TUTORIAL" > "$HYPEQUERY_TUTORIAL_DIRECTORY_FILE"
fi
