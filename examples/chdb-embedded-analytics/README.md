# Embedded ClickHouse analytics with chDB: typed datasets, a CLI and an API, no server

Run a ClickHouse semantic layer inside your Python process with chDB: no Docker, no server, then point the same datasets at ClickHouse Cloud.

## Demo

```bash
uv run python report.py --by tenant.plan
```

```json
{
  "backend": "chdb",
  "by": "tenant.plan",
  "data": [
    {"tenant.plan": "enterprise", "events": 72883, "unique_users": 602, "p95_latency_ms": 1665.95, "error_rate": 0.0572},
    {"tenant.plan": "growth",     "events": 47166, "unique_users": 504, "p95_latency_ms": 1628.6,  "error_rate": 0.0560},
    {"tenant.plan": "starter",    "events": 42949, "unique_users": 726, "p95_latency_ms": 1655.45, "error_rate": 0.0554},
    {"tenant.plan": "free",       "events": 37002, "unique_users": 948, "p95_latency_ms": 1757.7,  "error_rate": 0.0591}
  ]
}
```

The first run builds `analytics.chdb/`, a ClickHouse database directory next to the code, with 200,000 events and 24 tenants generated from `numbers()` and `cityHash64`. Every machine gets the same rows, so the counts above are what you will see (p95 moves by a few percent because ClickHouse's `quantile` samples). `--by event_type`, `--by device` or `--by tenant.region` slice it differently.

The same datasets over HTTP:

```bash
uv run python -m hypequery.serve.dev app:app      # 127.0.0.1:8000

curl -s -X POST localhost:8000/datasets/events/query \
  -H 'authorization: Bearer local-dev-token' -H 'content-type: application/json' \
  -d '{"dimensions":["tenant.plan"],"measures":["events","p95_latency_ms","error_rate"],"orderBy":[{"field":"events","direction":"desc"}]}'
# {"data":[{"tenant.plan":"enterprise","events":"72883","p95_latency_ms":"1399.35","error_rate":"0.0571..."}, ...]}
```

## Install

```bash
npx hypequery create chdb-embedded-analytics -y --no-seed
cd chdb-embedded-analytics
uv sync
uv run python report.py
```

`uv` is the only requirement (`pip install uv`, or see astral.sh/uv). No Docker, no ClickHouse server, no credentials. chDB ships wheels for Linux and macOS.

New to chDB? The [chDB Python tutorial](https://hypequery.com/blog/chdb-python-tutorial) walks through the engine itself; this example is the app you build on it.

## What it shows

- **ClickHouse in the process** (`analytics/backend.py`): `create_chdb_executor("analytics.chdb")` opens an embedded ClickHouse database directory. It runs the same compiled, parameterized, read-only SQL hypequery sends to a server.
- **Typed datasets, defined once** (`analytics/datasets.py`): dimensions, a `count` with a `status_code >= 500` filter, `count_distinct`, a p95 `percentile`, a derived `error_rate` that stays correct at any grouping, and a `belongs_to` relationship that makes `tenant.plan` a dimension through a join.
- **Deterministic data with no download** (`analytics/sample_data.py`): the seed's `events` and `tenants` shape, generated in chDB with integer hashing, so tests pin exact numbers.
- **One model, three surfaces**: a CLI report (`report.py`), an HTTP API (`app.py`, `create_api`), and a test suite (`tests/test_smoke.py`) that checks measures against raw chDB SQL.
- **Portable to a server by changing the executor**: `ANALYTICS_BACKEND=clickhouse` runs the same report on ClickHouse, and the smoke test proves it against the shared seed when one is reachable.

## Key file

`analytics/backend.py` is the only place that knows where ClickHouse runs:

```python
def open_executor(backend: str | None = None) -> ChdbExecutor | ClickHouseExecutor:
    if (backend or backend_name()) == "clickhouse":
        return create_clickhouse_executor(connection_from_env())
    # chDB: the engine runs in this process, on a directory next to the code.
    from analytics.sample_data import ensure_sample_data

    path = os.environ.get("CHDB_PATH", DEFAULT_CHDB_PATH)
    ensure_sample_data(path)
    return create_chdb_executor(path)


def open_client(executor: ChdbExecutor | ClickHouseExecutor) -> DatasetClient:
    # The registry resolves the `tenant` relationship for `tenant.plan` queries.
    return create_dataset_client(executor=executor, registry=create_dataset_registry(events, tenants))
```

The datasets it serves, from `analytics/datasets.py`:

```python
events = dataset(
    "events",
    source="events",
    time_key="occurred_at",
    dimensions={"event_type": dimension.string(), "device": dimension.string(), ...},
    measures={
        "events": measure.count("event_id"),
        "unique_users": measure.count_distinct("user_id"),
        "errors": measure.count("event_id", filters=(filter.gte("status_code", 500),)),
        "p95_latency_ms": measure.percentile("latency_ms", 0.95),
        "error_rate": measure.derived(divide("errors", null_if_zero("events"))),
    },
    relationships={"tenant": belongs_to(tenants, from_field="tenant_id", to_field="tenant_id")},
)
```

## Architecture

```text
report.py --by tenant.plan ─┐
                            ├─▶ dataset client ─▶ planner ─▶ SELECT ... LEFT ANY JOIN tenants ... ─┐
POST /datasets/events/query ┘   (datasets.py)                (typed params, readonly SETTINGS)     │
  (app.py, create_api)                                                                             ▼
                                         ANALYTICS_BACKEND=chdb (default)   ─▶ chDB in this process, ./analytics.chdb
                                         ANALYTICS_BACKEND=clickhouse       ─▶ ClickHouse server / Cloud over HTTP
```

## Adapt it

- **Switch to ClickHouse Cloud or a server.** Load your tables (or the repo's seed, which has the same `events` and `tenants` columns), then:

  ```bash
  export ANALYTICS_BACKEND=clickhouse
  export CLICKHOUSE_URL=https://<your-service>.clickhouse.cloud:8443
  export CLICKHOUSE_USERNAME=default CLICKHOUSE_PASSWORD=... CLICKHOUSE_DATABASE=default
  uv run python report.py --by tenant.plan
  ```

  `datasets.py`, `report.py` and `app.py` do not change; delete `sample_data.py` once the server is the only backend.
- **Your own files.** chDB reads Parquet, CSV and S3 through ClickHouse table functions. `CREATE VIEW events AS SELECT * FROM file('events.parquet')` in `sample_data.py` and the dataset's `source` stays `events`.
- **In-memory for tests and serverless.** `create_chdb_executor()` with no path opens `:memory:`; tables vanish when the last connection closes. A file-backed directory survives restarts.
- **One process per database.** chDB holds one path per process, so stop `pnpm dev` before opening `analytics.chdb` from another script (the tests use their own temporary directory). `hypequery.serve.dev --reload` already hands the database to the reloaded worker.
- **chDB or DuckDB?** Both embed in Python. chDB is the ClickHouse engine itself, so the SQL, functions (`quantile`, `uniqExact`, `multiIf`) and table engines you prototype locally are the ones production ClickHouse runs.
- **Real auth.** `HYPEQUERY_DEV_TOKEN` is a demo. Swap `authenticate` for `jwt_strategy(...)` and add `tenant_key="tenant_id"` to the dataset for per-tenant scoping, as in the FastAPI example.

## Related recipes

- [p95-latency](../../recipes/p95-latency): the `p95_latency_ms` measure, explained.

## Related examples

- [fastapi-analytics-api](../fastapi-analytics-api): the same kind of datasets served from FastAPI on a ClickHouse server, with tenant-scoped tokens.
- [mcp-agent-analytics](../mcp-agent-analytics): the semantic layer exposed to agents over MCP.

Tested on chDB 4.4.0 (ClickHouse engine embedded) and ClickHouse 25.8 with `hypequery` 0.1.0b3 and Python 3.12.
