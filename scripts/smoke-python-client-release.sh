#!/usr/bin/env bash
set -euo pipefail
HQ_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
HQ_GATE="$(mktemp -d "${TMPDIR:-/tmp}/hq-client-gate-XXXXXX")"
HQ_API_PID=''
HQ_UI_PID=''
HQ_TUTORIAL=''
HQ_DATABASE_CREATED=''
HQ_STAGE='build'
cleanup() {
  for pid in "$HQ_API_PID" "$HQ_UI_PID"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  done
  if [[ "$HQ_DATABASE_CREATED" == 'yes' ]]; then
    (cd "$HQ_TUTORIAL/backend" && "$HQ_TUTORIAL/.venv/bin/python" database.py cleanup) >>"$HQ_GATE/cleanup.log" 2>&1 || return 1
  fi
}
finish() {
  local status=$?
  trap - EXIT
  if [[ "$status" == 0 && "$HQ_STAGE" != 'complete' ]]; then status=1; fi
  if ! cleanup; then status=1; fi
  printf '{"passed":%s,"stage":"%s","exitCode":%s}\n' "$([[ "$status" == 0 ]] && echo true || echo false)" "$HQ_STAGE" "$status" > "$HQ_GATE/status.json"
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'Client release gate evidence: %s\n' "$HQ_GATE"
if [[ -n "${HYPEQUERY_GATE_DIRECTORY_FILE:-}" ]]; then printf '%s\n' "$HQ_GATE" > "$HYPEQUERY_GATE_DIRECTORY_FILE"; fi
cd "$HQ_ROOT"
git rev-parse HEAD > "$HQ_GATE/source-sha.txt"
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then echo true; else echo false; fi > "$HQ_GATE/worktree-dirty.txt"
HYPEQUERY_TUTORIAL_DIRECTORY_FILE="$HQ_GATE/prepared.path" bash scripts/prepare-python-client-tutorial.sh >"$HQ_GATE/build.log" 2>&1 || { tail -80 "$HQ_GATE/build.log"; exit 1; }
read -r HQ_TUTORIAL < "$HQ_GATE/prepared.path"
cp "$HQ_ROOT/testing/fixtures/python-client-gate/error_routes.py" "$HQ_TUTORIAL/backend/gate_error_routes.py"
cp "$HQ_ROOT/testing/fixtures/python-client-gate/backend.py" "$HQ_TUTORIAL/backend/client_gate.py"
cp "$HQ_ROOT/testing/fixtures/python-client-gate/definitions.py" "$HQ_TUTORIAL/backend/gate_definitions.py"
cp "$HQ_ROOT/testing/fixtures/python-client-gate/database.py" "$HQ_TUTORIAL/backend/database.py"
HQ_FRONTEND="$HQ_TUTORIAL/backend/examples/client_dashboard/frontend"
HQ_STAGE='contract'
(cd "$HQ_TUTORIAL/backend" && "$HQ_TUTORIAL/.venv/bin/python" -m hypequery export client-contract --factory gate_definitions:build --output examples/client_dashboard/frontend/contract.json --force)
(cd "$HQ_FRONTEND" && npm run generate -- --force && npm run build) > "$HQ_GATE/semantic-build.log" 2>&1 || { cat "$HQ_GATE/semantic-build.log"; exit 1; }
if [[ "${HYPEQUERY_GATE_FAULT:-}" == 'stale' ]]; then printf '\n// intentional drift\n' >> "$HQ_FRONTEND/client.generated.ts"; fi
(cd "$HQ_FRONTEND" && npm run check:generated) >"$HQ_GATE/generation.log" 2>&1 || { cat "$HQ_GATE/generation.log"; exit 1; }
cp "$HQ_ROOT/testing/fixtures/python-client-gate/"*.mjs "$HQ_FRONTEND/"
cp "$HQ_ROOT/testing/fixtures/python-client-gate/"*-app.tsx "$HQ_FRONTEND/"
cp -R "$HQ_ROOT/testing/fixtures/python-client-gate/utils" "$HQ_FRONTEND/"
export CLICKHOUSE_DATABASE="hq_client_gate_$(python3 -c 'import secrets; print(secrets.token_hex(8))')"
export HYPEQUERY_TENANT_A_TOKEN='gate-user-a'
export HYPEQUERY_TENANT_B_TOKEN='gate-user-b'
export HYPEQUERY_GATE_OUTPUT="$HQ_GATE"
export HYPEQUERY_GATE_TUTORIAL="$HQ_TUTORIAL"
export HYPEQUERY_GATE_VERSION_FILE="$HQ_GATE/clickhouse-version.txt"
cd "$HQ_TUTORIAL/backend"
"$HQ_TUTORIAL/.venv/bin/python" - <<'PY'
import socket
for port in (8000, 5173):
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(('127.0.0.1', port))
PY
HQ_STAGE='database'
"$HQ_TUTORIAL/.venv/bin/python" -c 'import sys; print(sys.version.split()[0])' > "$HQ_GATE/python-version.txt"
"$HQ_TUTORIAL/.venv/bin/python" database.py prepare
HQ_DATABASE_CREATED='yes'
"$HQ_TUTORIAL/.venv/bin/python" -m uvicorn client_gate:app --factory --host 127.0.0.1 --port 8000 >"$HQ_GATE/backend.log" 2>&1 &
HQ_API_PID=$!
"$HQ_TUTORIAL/.venv/bin/python" -m http.server 5173 --bind 127.0.0.1 --directory "$HQ_FRONTEND/public" >"$HQ_GATE/frontend.log" 2>&1 &
HQ_UI_PID=$!
"$HQ_TUTORIAL/.venv/bin/python" - <<'PY'
import time
import urllib.request
for attempt in range(100):
    try:
        request = urllib.request.Request('http://127.0.0.1:8000/v1/client-contract', headers={'Authorization': 'Bearer gate-user-a'})
        with urllib.request.urlopen(request, timeout=1) as response:
            assert response.status == 200
        break
    except OSError:
        if attempt == 99: raise
        time.sleep(0.1)
PY
kill -0 "$HQ_API_PID"
kill -0 "$HQ_UI_PID"
cd "$HQ_FRONTEND"
./node_modules/.bin/tsc semantic-app.tsx errors-app.tsx --ignoreConfig --noEmit --strict --module esnext --moduleResolution bundler --target es2022 --jsx react-jsx --lib es2022,dom
for HQ_PAGE in semantic errors; do
  ./node_modules/.bin/esbuild "$HQ_PAGE-app.tsx" --bundle --format=esm --outfile="public/$HQ_PAGE.js" --metafile="public/$HQ_PAGE.meta.json"
  node "$HQ_ROOT/scripts/utils/audit-python-browser-bundle.mjs" "public/$HQ_PAGE.meta.json"
  printf '<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Client qualification</title></head><body><div id="root"></div><script type="module" src="/%s.js"></script></body></html>\n' "$HQ_PAGE" > "public/$HQ_PAGE.html"
done
npm install --no-save --omit=optional playwright@1.64.1 >"$HQ_GATE/browser-install.log" 2>&1
if [[ -z "${HYPEQUERY_GATE_BROWSER_EXECUTABLE:-}" ]]; then
  npx --no-install playwright install --with-deps chromium >>"$HQ_GATE/browser-install.log" 2>&1
fi
HQ_STAGE='mcp'
npm run check:mcp >"$HQ_GATE/mcp.log" 2>&1 || { cat "$HQ_GATE/mcp.log"; exit 1; }
HQ_STAGE='semantics'
node semantics.mjs >"$HQ_GATE/semantics.log" 2>&1 || { cat "$HQ_GATE/semantics.log"; exit 1; }
HQ_STAGE='browser'
node browser.mjs >"$HQ_GATE/browser.log" 2>&1 || { cat "$HQ_GATE/browser.log"; exit 1; }
HQ_STAGE='errors'
node errors.mjs >"$HQ_GATE/errors.log" 2>&1 || { cat "$HQ_GATE/errors.log"; exit 1; }
node errors-browser.mjs >"$HQ_GATE/errors-browser.log" 2>&1 || { cat "$HQ_GATE/errors-browser.log"; exit 1; }
HQ_STAGE='cancellation'
node cancellation.mjs >"$HQ_GATE/cancellation.log" 2>&1 || { cat "$HQ_GATE/cancellation.log"; exit 1; }
node evidence.mjs
HQ_STAGE='complete'
printf 'Installed Python/React/MCP/ClickHouse release gate passed. Evidence: %s\n' "$HQ_GATE"
