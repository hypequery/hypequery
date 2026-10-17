#!/usr/bin/env bash
set -euo pipefail

# Interactive browser qualification against installed artifacts. See testing/python-client-browser.md.
HQ_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
HQ_SMOKE="$(mktemp -d "${TMPDIR:-/tmp}/hq-python-browser-XXXXXX")"
HQ_SMOKE="$(cd "$HQ_SMOKE" && pwd -P)"
HQ_API_PID=''
HQ_WEB_PID=''
cleanup() {
  if [[ -n "$HQ_API_PID" ]]; then kill "$HQ_API_PID" 2>/dev/null || true; fi
  if [[ -n "$HQ_WEB_PID" ]]; then kill "$HQ_WEB_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

mkdir -p "$HQ_SMOKE/artifacts" "$HQ_SMOKE/backend" "$HQ_SMOKE/frontend"
cp "$HQ_ROOT"/testing/fixtures/python-client-browser/*.py "$HQ_SMOKE/backend/"
cp "$HQ_ROOT"/testing/fixtures/python-client-browser/app.tsx "$HQ_ROOT"/testing/fixtures/python-client-browser/index.html "$HQ_SMOKE/frontend/"

cd "$HQ_ROOT"
pnpm --filter '@hypequery/cli...' -r build
pnpm --filter @hypequery/react pack --pack-destination "$HQ_SMOKE/artifacts"
uv build --project python/hypequery --out-dir "$HQ_SMOKE/artifacts"
HQ_WHEELS=("$HQ_SMOKE"/artifacts/*.whl)
HQ_REACT=("$HQ_SMOKE"/artifacts/hypequery-react-*.tgz)

cd "$HQ_SMOKE/backend"
uv run --isolated --no-project --with "${HQ_WHEELS[0]}" python -m hypequery export client-contract \
  --factory fixture:build --output "$HQ_SMOKE/frontend/client-contract.json"

cd "$HQ_SMOKE/frontend"
cat > package.json <<'JSON'
{"name":"python-client-browser-qualification","private":true,"type":"module"}
JSON
npm install "${HQ_REACT[0]}" react@19.3.0 react-dom@19.3.0 @tanstack/react-query@5.104.1 @types/react@19.3.0 @types/react-dom@19.3.0
node "$HQ_ROOT/packages/cli/dist/bin/cli.js" --no-telemetry generate:client client-contract.json --output client.generated.ts
node "$HQ_ROOT/packages/cli/dist/bin/cli.js" --no-telemetry generate:client client-contract.json --output client.generated.ts --check
"$HQ_ROOT/packages/cli/node_modules/.bin/tsc" app.tsx client.generated.ts --noEmit --strict --skipLibCheck --jsx react-jsx --module esnext --moduleResolution bundler --target es2022 --lib es2022,dom
"$HQ_ROOT/packages/cli/node_modules/.bin/esbuild" app.tsx --bundle --format=esm --outfile=app.js --define:process.env.NODE_ENV='"production"' --metafile=bundle-meta.json
node "$HQ_ROOT/scripts/utils/audit-python-browser-bundle.mjs" bundle-meta.json

# Fail rather than silently testing an unrelated process already listening here.
uv run --isolated --no-project --with "${HQ_WHEELS[0]}" python - <<'PY'
import socket
for port in (8790, 8791):
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(('127.0.0.1', port))
PY
(
  cd "$HQ_SMOKE/backend"
  exec uv run --isolated --no-project --with "${HQ_WHEELS[0]}" --with fastapi==0.141.1 --with uvicorn==0.54.0 \
    uvicorn fixture:app --factory --host 127.0.0.1 --port 8790
) >"$HQ_SMOKE/backend.log" 2>&1 &
HQ_API_PID=$!
(
  cd "$HQ_SMOKE/frontend"
  exec uv run --isolated --no-project --with "${HQ_WHEELS[0]}" python -m http.server 8791 --bind 127.0.0.1
) >"$HQ_SMOKE/frontend.log" 2>&1 &
HQ_WEB_PID=$!

uv run --isolated --no-project --with "${HQ_WHEELS[0]}" python - <<'PY'
import time
import urllib.request
for url in ('http://127.0.0.1:8790/openapi.json', 'http://127.0.0.1:8791/'):
    for attempt in range(100):
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                assert response.status == 200
            break
        except OSError:
            if attempt == 99:
                raise
            time.sleep(0.1)
PY
kill -0 "$HQ_API_PID" "$HQ_WEB_PID"
printf 'Browser fixture: http://127.0.0.1:8791\nArtifacts and logs: %s\nRun testing/python-client-browser.md; Ctrl-C stops both servers.\n' "$HQ_SMOKE"
wait "$HQ_API_PID" "$HQ_WEB_PID"
