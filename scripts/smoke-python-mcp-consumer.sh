#!/usr/bin/env bash
set -euo pipefail

# Installed-artifact HTTP/MCP wiring check; SQLite is a fixture, not ClickHouse certification.
HQ_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
HQ_SMOKE="$(mktemp -d "${TMPDIR:-/tmp}/hq-python-mcp-XXXXXX")"
HQ_SMOKE="$(cd "$HQ_SMOKE" && pwd -P)"
HQ_API_PID=''
cleanup() {
  if [[ -n "$HQ_API_PID" ]]; then
    kill "$HQ_API_PID" 2>/dev/null || true
    wait "$HQ_API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM
mkdir -p "$HQ_SMOKE/artifacts" "$HQ_SMOKE/backend" "$HQ_SMOKE/consumer"
cp "$HQ_ROOT"/testing/fixtures/python-client-browser/*.py "$HQ_SMOKE/backend/"
cp "$HQ_ROOT"/testing/fixtures/python-client-browser/mcp-smoke.mjs "$HQ_SMOKE/consumer/smoke.mjs"
cp "$HQ_ROOT"/testing/fixtures/python-client-browser/mcp-consumer.ts "$HQ_SMOKE/consumer/consumer.ts"

cd "$HQ_ROOT"
pnpm --filter '@hypequery/mcp...' -r build
for package in protocol datasets mcp-server; do
  (cd "$HQ_ROOT/packages/$package" && pnpm pack --pack-destination "$HQ_SMOKE/artifacts")
done
uv build --project python/hypequery --out-dir "$HQ_SMOKE/artifacts"
HQ_WHEELS=("$HQ_SMOKE"/artifacts/*.whl)
HQ_PROTOCOL=("$HQ_SMOKE"/artifacts/hypequery-protocol-*.tgz)
HQ_DATASETS=("$HQ_SMOKE"/artifacts/hypequery-datasets-*.tgz)
HQ_MCP=("$HQ_SMOKE"/artifacts/hypequery-mcp-*.tgz)

cd "$HQ_SMOKE/consumer"
cat > package.json <<'JSON'
{"name":"python-mcp-consumer-qualification","private":true,"type":"module"}
JSON
npm install --omit=optional "${HQ_PROTOCOL[0]}" "${HQ_DATASETS[0]}" "${HQ_MCP[0]}" @modelcontextprotocol/sdk@1.32.1 typescript@6.0.3 @types/node@22
./node_modules/.bin/tsc consumer.ts --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 --lib es2022,dom --types node

uv run --isolated --no-project --with "${HQ_WHEELS[0]}" python - <<'PY'
import socket
with socket.socket() as listener:
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(('127.0.0.1', 8792))
PY
(
  cd "$HQ_SMOKE/backend"
  exec uv run --isolated --no-project --with "${HQ_WHEELS[0]}" --with fastapi==0.141.1 --with uvicorn==0.54.0 \
    uvicorn fixture:app --factory --host 127.0.0.1 --port 8792
) >"$HQ_SMOKE/backend.log" 2>&1 &
HQ_API_PID=$!
uv run --isolated --no-project --with "${HQ_WHEELS[0]}" python - <<'PY'
import time
import urllib.request
for attempt in range(100):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8792/openapi.json', timeout=1) as response:
            assert response.status == 200
        break
    except OSError:
        if attempt == 99:
            raise
        time.sleep(0.1)
PY
kill -0 "$HQ_API_PID"
HYPEQUERY_TEST_CLIENT_CONTRACT_URL='http://127.0.0.1:8792/mounted/v1/client-contract' node smoke.mjs
printf 'Installed MCP/Python HTTP qualification passed. Artifacts and logs: %s\n' "$HQ_SMOKE"
