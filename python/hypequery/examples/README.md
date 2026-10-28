# Python examples

Run each from `python/hypequery`, against a database seeded with `seed.sql`.
Set `CLICKHOUSE_URL` (or the `CLICKHOUSE_*` variables) and two distinct tenant
tokens:

```bash
export HYPEQUERY_TENANT_A_TOKEN="$(openssl rand -hex 24)"
export HYPEQUERY_TENANT_B_TOKEN="$(openssl rand -hex 24)"
```

| Example | What it shows |
| --- | --- |
| `django_app.py`, `django_urls.py` | Django views on the per-request client, and hypequery's endpoints served from the URLconf with `urls(api)` |
| `flask_app.py` | Flask routes on the per-request client, and hypequery's endpoints as a `blueprint(api)` |
| `dataframes.py`, `sqlalchemy_engine.py` | pandas results; pointing hypequery at a SQLAlchemy engine's server |
| `embedded_analytics.py`, `multitenant_saas.py`, `governed_agent.py` | Standalone ASGI APIs |
| `client_dashboard/` | The full Python → React → MCP tutorial |

## React and MCP against Django or Flask

Both framework examples serve the same API (`utils/analytics.py`) at
`/api/analytics`, natively, with no FastAPI and no second process:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/analytics/orders` | The orders dataset, a strict client endpoint |
| `GET /api/analytics/client-contract` | The caller's authorized client contract |

Start either app with its development server, or under gunicorn
(`pip install gunicorn`) with threaded workers:

```bash
uv run python -m examples.django_app runserver 8000
uv run flask --app examples.flask_app run --port 8000
gunicorn "examples.django_app:wsgi_application()" --threads 8 --bind 127.0.0.1:8000
gunicorn "examples.flask_app:create_app()" --threads 8 --bind 127.0.0.1:8000
```

Each tenant's token is its bearer credential for now; signing in with the
app's own login (`from_context`) arrives with decision 0023 step 5. Query
bodies cannot choose a tenant: the token decides it.

In a real app, swap the token table for signed, short-lived JWTs (the `jwt`
extra). The app mints one for the signed-in user from its own view, and the
API verifies it, through `urls(api)` or `blueprint(api)` exactly as under ASGI:

```python
from hypequery.serve import analytics_token_issuer, create_api, jwt_strategy

issue = analytics_token_issuer(SECRET, issuer="https://app.example.com", audience="analytics")
api = create_api(
    auth=jwt_strategy(secret=SECRET, issuer="https://app.example.com", audience="analytics"),
    ...,
)
# In a logged-in view: return {"token": issue(str(user.id), tenant_id=user.org_id)}
```

```bash
curl -H "Authorization: Bearer $HYPEQUERY_TENANT_A_TOKEN" \
  -H "Content-Type: application/json" -d '{"measures": ["revenue"]}' \
  localhost:8000/api/analytics/orders
```

**`@hypequery/react`.** Export the contract offline, with the paths the mounted
API serves, and generate the typed client from it, as in the
[client tutorial](client_dashboard/README.md):

```bash
uv run python -m hypequery export client-contract \
  --factory examples.utils.analytics:build --output contract.json
```

Then point the generated client at the app (`baseUrl: 'http://localhost:8000'`)
with the user's token. The API allows CORS from `http://localhost:5173`, the
Vite dev server. The contract pins each endpoint's schema; the live contract
at `/api/analytics/client-contract` carries the same hashes, so a mismatch
after a definition change answers `409`.

**`@hypequery/mcp`.** Bridge the same endpoints to an MCP client, one tenant
per process, with the token in the environment rather than the arguments:

```bash
export HYPEQUERY_API_KEY="$HYPEQUERY_TENANT_A_TOKEN"
npx hypequery mcp --client-contract-url http://localhost:8000/api/analytics/client-contract --self-test
```
