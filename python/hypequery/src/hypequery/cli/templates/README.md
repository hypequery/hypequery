# Your Python dataset project

Requires Python 3.11+ and an existing ClickHouse server. No Node tools are needed.
The generated `pyproject.toml` pins the SDK version used to scaffold this project.

## Install

Before the first PyPI release, build the SDK wheel in the SDK checkout used to
install the CLI (in a separate shell):

```bash
cd /path/to/hypequery/python/hypequery
uv build --wheel
```

From this generated project directory, create an environment and install that
artifact with the serving and ClickHouse extras. Replace the checkout path:

```bash
python -m venv .venv
source .venv/bin/activate
export HYPEQUERY_WHEEL=/path/to/hypequery/python/hypequery/dist/hypequery-__HYPEQUERY_VERSION__-py3-none-any.whl
python -m pip install "$HYPEQUERY_WHEEL[fastapi,clickhouse]"
python -m pip install -e . --no-deps
```

Once the SDK version pinned in `pyproject.toml` is published on PyPI, use
`python -m pip install -e .` in the environment instead.

## Configure

`.env.example` is a reference; it is **not loaded automatically**. Export your
connection settings and create a development token in your shell:

```bash
export CLICKHOUSE_HOST=localhost
export CLICKHOUSE_PORT=8123
export CLICKHOUSE_DATABASE=default
export CLICKHOUSE_USERNAME=default
export CLICKHOUSE_PASSWORD='your-local-password'
export HYPEQUERY_DEV_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
```

Do not commit credentials. The token is for local development; use your real
authentication and a production profile before exposing the app to users.

## Create sample data

Review `seed.sql`, then run it explicitly against your development database.
Scaffolding and the dev command never seed it automatically. Repeating the seed
inserts the sample rows again. Use a fresh scratch database for the exact example
response below. You can use a SQL console or Python:

```bash
python - <<'PY'
import os
from pathlib import Path
import clickhouse_connect

client = clickhouse_connect.get_client(
    host=os.environ["CLICKHOUSE_HOST"],
    port=int(os.environ["CLICKHOUSE_PORT"]),
    database=os.environ["CLICKHOUSE_DATABASE"],
    username=os.environ["CLICKHOUSE_USERNAME"],
    password=os.environ["CLICKHOUSE_PASSWORD"],
)
try:
    for statement in Path("seed.sql").read_text().split(";"):
        if statement.strip():
            client.command(statement)
finally:
    client.close()
PY
```

## Serve and query

```bash
hypequery dev
```

If your older preview SDK does not yet provide `dev`, start it with
`python -m hypequery.serve.dev app:app --reload`.

This serves `app:app` on `127.0.0.1:8000` with file reload enabled. Use
`--no-reload` to disable reload, or `--port 8001` for a different port. From
another shell with `HYPEQUERY_DEV_TOKEN` set:

```bash
curl --fail-with-body -s http://127.0.0.1:8000/datasets/orders/query \
  -H "Authorization: Bearer $HYPEQUERY_DEV_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dimensions":["country"],"measures":["revenue","orderCount"],"filters":[{"field":"status","operator":"eq","value":"paid"}],"orderBy":[{"field":"revenue","direction":"desc"}]}'
```

```json
{"data":[{"country":"US","revenue":"310.25","orderCount":"1"},{"country":"NZ","revenue":"200.50","orderCount":"2"},{"country":"AU","revenue":"200.00","orderCount":"1"}]}
```

A request without the token returns `401`. Measure values are strings on the
HTTP wire. Development docs are at <http://127.0.0.1:8000/docs>.

## Production

`hypequery dev` is for local development. Create an app with
`ProductionProfile`, disable development docs, supply trusted authentication,
and use `run_production` behind your reverse proxy. See the SDK README's
production-process section for the profile and explicit proxy-trust settings.
