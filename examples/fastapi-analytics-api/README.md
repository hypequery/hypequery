# A FastAPI analytics API on ClickHouse with tenant-scoped datasets

Serve governed ClickHouse analytics from FastAPI: datasets defined once in Python, query endpoints mounted beside your routes, tenant fixed by the token.

## Demo

```bash
TOKEN=$(curl -s -X POST localhost:8000/auth/token -H 'content-type: application/json' \
  -d '{"email":"ada@quartz.example"}' | jq -r .token)

curl -s -X POST localhost:8000/analytics/datasets/events/query \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"dimensions":["event_type"],"measures":["events","error_rate"],"orderBy":[{"field":"events","direction":"desc"}]}'
```

```json
{"data":[{"event_type":"page_view","events":"7689","error_rate":"0"},
         {"event_type":"api_call","events":"4246","error_rate":"0"},
         {"event_type":"query_run","events":"2559","error_rate":"0"},
         {"event_type":"login","events":"1358","error_rate":"0"},
         {"event_type":"export","events":"669","error_rate":"0"},
         {"event_type":"error","events":"533","error_rate":"0.7786116322701688"}]}
```

Ada's token carries tenant 153 in `org_id`. Mint one for `grace@relay.example` and the same request returns Relay Works' numbers. No request body ever names a tenant; one that tries (`{"field":"tenant_id",...}`) gets a 400.

Your own route, same scoping:

```bash
curl -s "localhost:8000/reports/top-paths?limit=3" -H "authorization: Bearer $TOKEN"
# {"tenant_id":"153","data":[{"path":"/explore","events":7676,"unique_users":204}, ...]}
```

## Install

```bash
npx @hypequery/cli create fastapi-analytics-api -y
cd fastapi-analytics-api
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait   # or set CLICKHOUSE_* for your own ClickHouse
uv sync
uv run uvicorn app:app --reload --port 8000
```

`uv` is the only requirement (`pip install uv`, or see astral.sh/uv). Set `HYPEQUERY_AUTH_SECRET` before deploying; the default is for the demo only. `HYPEQUERY_DEV_DOCS=1` adds Swagger UI at `/analytics/docs`.

## What it shows

- **Datasets defined once, in Python** (`analytics/datasets.py`): `dataset(...)` with `tenant_key="tenant_id"`, filtered measures (`errors` is `count` with a `status_code >= 500` filter), a percentile, and a derived `error_rate` that stays correct however the query groups.
- **hypequery's endpoints mounted in your app** (`analytics/api.py`, `app.py`): `create_api(...)` builds validated `POST /datasets/<name>/query` endpoints; `app.mount("/analytics", to_asgi_app(api))` puts them next to your routes. `EndpointPolicy(tenant="required", max_limit=500)` refuses tenant-free requests and caps rows.
- **Your server mints the token** (`analytics/api.py`, `app.py`): `analytics_token_issuer` signs a 15-minute HS256 token with the tenant in `org_id`; `jwt_strategy` verifies it and the default tenant resolver scopes the request. Swap the demo "login" for your session.
- **Hand-written routes reuse the same client** (`app.py`): `/reports/top-paths` calls `client.for_tenant(tenant(tenant_id)).execute(events, {...})`, so your custom endpoints get the same tenant predicate and the same semantic layer.
- **Isolation proven by the smoke test** (`tests/test_smoke.py`): per-tenant totals equal raw SQL via `clickhouse_connect`, no token is 401, a forged token is 401, and a tenant filter is 400.

## Key file

`analytics/api.py` is the whole security boundary; `app.py` mounts it and adds the demo login and a report route:

```python
executor = create_async_from_sync_clickhouse_executor(connection_from_env())
client = create_async_dataset_client(executor=executor)

SECRET = os.environ.get("HYPEQUERY_AUTH_SECRET", "demo-only-change-me-7c9a4b1f2e3d")
issue_token = analytics_token_issuer(SECRET, audience="analytics")  # (subject, tenant_id=, roles=) -> str
verify_token = jwt_strategy(secret=SECRET, audience="analytics")   # sub, org_id -> tenant, roles

policy = EndpointPolicy(tenant="required", max_limit=500)

api = create_api(
    auth=verify_token,
    client=client,
    client_mount_path="/analytics",
    datasets={
        "events": create_dataset_endpoint(dataset=events, client=client, policy=policy),
        "subscriptions": create_dataset_endpoint(dataset=subscriptions, client=client, policy=policy),
    },
)
```

Then in `app.py`:

```python
app = FastAPI(title="Analytics API", lifespan=lifespan)   # lifespan closes the executor
app.mount("/analytics", to_asgi_app(api))

@app.get("/reports/top-paths")
async def top_paths(tenant_id: Annotated[str, Depends(current_tenant)], limit: int = 5):
    scoped = client.for_tenant(tenant(tenant_id))
    result = await scoped.execute(events, {"dimensions": ["path"], "measures": ["events", "unique_users"],
                                           "order_by": [{"field": "events", "direction": "desc"}], "limit": min(limit, 20)})
    return {"tenant_id": tenant_id, "data": list(result.data)}
```

## Architecture

```text
client                                   FastAPI (app.py)                                           ClickHouse
──────                                   ───────────────────────────────────────────────────         ──────────
POST /auth/token {email}  ──────────▶    your login  ─▶ analytics_token_issuer(org_id=153)
        ◀── { token (15m) }
POST /analytics/datasets/events/query    to_asgi_app(api): jwt_strategy ─▶ Principal(tenant_id=153)
  Authorization: Bearer <token>  ───▶      ─▶ create_dataset_endpoint ─▶ dataset(tenant_key)
                                             └─ SELECT ... FROM events WHERE tenant_id = 153 ... ─▶
GET /reports/top-paths  ─────────────▶   current_tenant ─▶ client.for_tenant(...).execute(events) ─▶
```

## Adapt it

- **Your identity provider.** `jwt_strategy(jwks_url=..., issuer=..., audience=...)` accepts tokens from Auth0, Clerk or Cognito directly; pass `map_claims` if your tenant claim is not `org_id`.
- **Session auth instead of tokens.** `create_api(auth=from_context(...))` reads your app's own session from the request, so a browser already signed in to your product needs no analytics token.
- **Django or Flask.** The datasets and `create_api` are framework-agnostic: `to_asgi_app` mounts in any ASGI app, and `to_wsgi_app` exists for WSGI. `create_async_from_sync_clickhouse_executor` needs no aiohttp, so it suits apps without a shutdown hook.
- **Cross-tenant reporting.** Internal jobs call `client.execute(events, query, context=...)` with a tenant scope of `all`, server-side only. Never route that through a customer-facing endpoint.
- **Typed clients.** `GET /analytics/discovery` and the OpenAPI document describe the datasets, so `hypequery` can generate a TypeScript client for your front end, as in the Next.js dashboard example.
- **Deploy.** It is a plain ASGI app: `uv run uvicorn app:app --host 0.0.0.0` behind your usual proxy, or `gunicorn -k uvicorn.workers.UvicornWorker app:app`.

## Related recipes

- [p95-latency](../../recipes/p95-latency): the `p95_latency_ms` measure, explained.

## Related examples

- [multi-tenant-embedded-analytics](../multi-tenant-embedded-analytics): the same datasets and token flow in TypeScript with `@hypequery/serve`.
- [mcp-agent-analytics](../mcp-agent-analytics): the semantic layer exposed to agents over MCP.

Tested on ClickHouse 25.8 with `hypequery` 0.1.0b3 (PyPI), FastAPI 0.162 and Python 3.13.
