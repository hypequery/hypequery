# Django analytics on ClickHouse: ORM for app data, typed datasets for metrics

Keep your Django models in SQLite or Postgres and serve ClickHouse analytics from typed hypequery datasets, scoped to request.user's organization.

## Demo

```bash
curl -s -H 'X-Demo-User: ada' localhost:8000/api/overview
```

```json
{"organization": "Quartz Metrics", "plan": "enterprise",
 "period": ["2026-10-02 00:00:00", "2026-10-31 23:59:59"],
 "data": {"events": 17054, "active_users": 174, "error_rate": 0.024334466987217074, "p95_latency_ms": 664.45}}
```

`organization` and `plan` come from Django's ORM (SQLite); `data` comes from ClickHouse. Ada belongs to Quartz Metrics, so every query runs as tenant 153. Send `X-Demo-User: grace` and the same URL returns Relay Works' numbers; send nothing and it is a 401.

```bash
curl -s -H 'X-Demo-User: ada' "localhost:8000/api/timeseries?by=week"
# {"by": "week", "data": [{"period": "2026-09-27", "events": 922, "active_users": 102}, ...]}
curl -s -H 'X-Demo-User: ada' "localhost:8000/api/breakdown/device?limit=3"
# {"dimension": "device", "data": [{"device": "desktop", "events": 8336, "error_rate": 0.0345...}, ...]}
```

Every view takes `?from=2026-09-01&to=2026-09-30` for another window.

## Install

```bash
npx @hypequery/cli create django-analytics -y
cd django-analytics
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
uv sync
uv run python manage.py migrate      # SQLite: the demo organizations and users
uv run python manage.py runserver 8000
```

`uv` is the only Python requirement (`pip install uv`, or see astral.sh/uv). `uv run pytest -q` runs the tests against the seed.

## What it shows

- **Two databases, two jobs** (`accounts/models.py`, `config/settings.py`): `Organization` and `Membership` are ordinary Django models in SQLite, migrated as usual. Each organization stores the ClickHouse `tenant_id` its analytics belong to. ClickHouse is not a Django database at all, so there is no ORM backend to fight.
- **One `HYPEQUERY` setting** (`config/settings.py`): `hypequery.contrib.django` in `INSTALLED_APPS` validates it under `manage.py check`; `HypequeryMiddleware` gives every request a `request.analytics` client bound to the tenant `analytics.tenancy.tenant_for_request` reads from `request.user`.
- **Typed datasets instead of SQL in views** (`analytics/datasets.py`): `events` defines `events`, `active_users`, `p95_latency_ms` and a derived `error_rate` once. Views ask for them by name; hypequery writes parameterized ClickHouse SQL (`count`, `uniqExact`, `quantile(0.95)`) with the tenant predicate added.
- **JSON views that read like Django** (`analytics/views.py`): `request.analytics.execute(events, {...})` next to `request.user.membership.organization`, with 401 for anonymous callers, 403 for users outside any organization, and an allow-list for breakdown dimensions.
- **Tests with Django's test client** (`tests/test_smoke.py`): pytest-django builds the SQLite test database, then every number is compared with raw SQL run through `clickhouse_connect`, per tenant.

## Key file

`analytics/views.py`: no view names a tenant or writes SQL.

```python
@require_GET
@member_required
def overview(request: HttpRequest) -> JsonResponse:
    """Headline numbers, next to app data from the ORM."""
    org = request.user.membership.organization
    window = period_filter(request)
    result = request.analytics.execute(
        events, {"measures": ["events", "active_users", "error_rate", "p95_latency_ms"], "filters": [window]}
    )
    return JsonResponse({"organization": org.name, "plan": org.plan, "period": window["value"], "data": result.data[0]})


@require_GET
@member_required
def timeseries(request: HttpRequest) -> JsonResponse:
    grain = request.GET.get("by", "day")
    if grain not in GRAINS:
        return JsonResponse({"error": f"by must be one of {sorted(GRAINS)}"}, status=400)
    result = request.analytics.execute(
        events, {"measures": ["events", "active_users"], "by": grain, "filters": [period_filter(request)]}
    )
    return JsonResponse({"by": grain, "data": list(result.data)})
```

The wiring, in `config/settings.py` and `analytics/tenancy.py`:

```python
HYPEQUERY = {
    "URL": clickhouse_url(),  # from CLICKHOUSE_URL + CLICKHOUSE_USERNAME/PASSWORD/DATABASE
    "REGISTRY": "analytics.datasets.registry",
    "TENANT": "analytics.tenancy.tenant_for_request",
}

def tenant_for_request(request):
    user = request.user
    if not user.is_authenticated or not hasattr(user, "membership"):
        return None          # tenant-keyed datasets then refuse to run
    return str(user.membership.organization.clickhouse_tenant_id)
```

## Architecture

```text
browser / curl                Django (manage.py runserver)                               stores
──────────────                ───────────────────────────────────────────────────         ──────
GET /api/overview  ────────▶  AuthenticationMiddleware ─▶ request.user        ◀── SQLite: auth_user,
  X-Demo-User: ada              (demo: X-Demo-User header; yours: session)          accounts_membership,
                              HypequeryMiddleware ─▶ request.analytics                accounts_organization
                                └─ tenant_for_request(request) ─▶ "153"
                              overview view ─▶ request.analytics.execute(events, {...})
                                └─ SELECT count(), uniqExact(user_id), ...
                                   FROM events WHERE tenant_id = 153 AND occurred_at BETWEEN ...  ─▶ ClickHouse
        ◀── JSON {organization (ORM), data (ClickHouse)}
```

## Adapt it

- **Real login.** Delete `DemoUserHeaderMiddleware` and `DemoUserBackend` from `settings.py`; Django's session login (or django-allauth, or your SSO) sets `request.user` and nothing else changes. The header exists only so the demo needs no login form; never deploy it.
- **Postgres for app data.** Point `DATABASES["default"]` at Postgres. The ORM and ClickHouse never share a connection, so nothing in `analytics/` changes.
- **Async views.** Write `async def overview(request)` and `await request.analytics.execute(...)`: the middleware hands async views the async client, and `tenant_for_request` runs through `sync_to_async`, so it may still use the ORM.
- **Serve hypequery's own endpoints.** For `@hypequery/react` or `@hypequery/mcp`, build an API with `create_api(auth=django_user(...))` and add `path("api/analytics/", include(urls(api)))`; it reuses the Django session and its CSRF check. The FastAPI example shows the same `create_api` over a token.
- **Your own tables.** Copy `analytics/datasets.py` per table, or run `hypequery init --framework django` to generate datasets from your ClickHouse schema.
- **Deploy.** `gunicorn config.wsgi --threads 8`, or `uvicorn config.asgi:application`; set `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=0` and your `ALLOWED_HOSTS`.

## Related recipes

- [p95-latency](../../recipes/p95-latency): the `p95_latency_ms` measure, explained.

## Related examples

- [fastapi-analytics-api](../fastapi-analytics-api): the same datasets behind FastAPI, with hypequery's endpoints and a JWT.
- [streamlit-dashboard](../streamlit-dashboard): the same measures in a Streamlit dashboard with pandas export.

Tested on ClickHouse 25.8 with `hypequery` 0.1.0b3 (PyPI), Django 6.1 and Python 3.12.
