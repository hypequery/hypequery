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
| `django_app.py`, `django_urls.py` | Django views on the per-request client, and hypequery's endpoints served from the URLconf with `urls(api)`, behind the project's login for a same-origin React page |
| `flask_app.py` | Flask routes on the per-request client, and hypequery's endpoints as a `blueprint(api)`, behind the app's session for a same-origin React page |
| `dataframes.py`, `sqlalchemy_engine.py` | pandas results; pointing hypequery at a SQLAlchemy engine's server |
| `embedded_analytics.py`, `multitenant_saas.py`, `governed_agent.py` | Standalone ASGI APIs |
| `client_dashboard/` | The full Python → React → MCP tutorial |

## React and MCP against Django or Flask

Both framework examples serve the same API (`utils/analytics.py`) natively,
with no FastAPI and no second process, twice:

| Endpoint | Authenticated by | For |
| --- | --- | --- |
| `POST /api/analytics/orders`, `GET /api/analytics/client-contract` | The app's own login (`django_user`, `flask_session`) | The same-origin React page |
| `POST /api/agents/orders`, `GET /api/agents/client-contract` | A bearer token | `@hypequery/mcp`, scripts |

Start either app with its development server, or under gunicorn
(`pip install gunicorn`) with threaded workers:

```bash
uv run python -m examples.django_app runserver 8000
uv run flask --app examples.flask_app run --port 8000
gunicorn "examples.django_app:wsgi_application()" --threads 8 --bind 127.0.0.1:8000
gunicorn "examples.flask_app:create_app()" --threads 8 --bind 127.0.0.1:8000
```

The Django project keeps its users and sessions in a SQLite file, migrated at
startup. Flask signs its session cookie with `FLASK_SECRET_KEY` (random per
process if unset, so set it for more than one worker).

**The React page.** Open http://localhost:8000/ and sign in with a tenant
token: the stand-in login (`POST /login`) signs that organization in with the
framework's own session. The page (`utils/analytics_page.html`, React and
`@hypequery/react` from a CDN) then queries `/api/analytics/orders` with its
session cookie and no token. With curl, the same steps:

```bash
# Flask
curl -c jar -H 'Sec-Fetch-Site: same-origin' -d "token=$HYPEQUERY_TENANT_A_TOKEN" localhost:8000/login
curl -b jar -H 'Sec-Fetch-Site: same-origin' -H 'Content-Type: application/json' \
  -d '{"measures": ["revenue"]}' localhost:8000/api/analytics/orders

# Django also checks its CSRF token, from the csrftoken cookie
curl -c jar -b jar localhost:8000/ > /dev/null
CSRF=$(awk '$6 == "csrftoken" {print $7}' jar)
curl -c jar -b jar -H "X-CSRFToken: $CSRF" -d "token=$HYPEQUERY_TENANT_A_TOKEN" localhost:8000/login
CSRF=$(awk '$6 == "csrftoken" {print $7}' jar)  # signing in rotates it
curl -b jar -H "X-CSRFToken: $CSRF" -H 'Sec-Fetch-Site: same-origin' \
  -H 'Content-Type: application/json' -d '{"measures": ["revenue"]}' \
  localhost:8000/api/analytics/orders
```

A browser sends `Sec-Fetch-Site` itself; the API refuses an unsafe request
without it (`403`), so another site's page cannot use the session. Query
bodies cannot choose a tenant: the signed-in organization decides it.

For a typed client, export the contract offline, with the paths the mounted
API serves, and generate it as in the [client tutorial](client_dashboard/README.md):

```bash
uv run python -m hypequery export client-contract \
  --factory examples.utils.analytics:build --output contract.json
```

Serve the bundle from the app, or proxy `/api` to it from the dev server
(Vite's `server.proxy`), so the page stays on the app's origin, and create the
client with `baseUrl: '/api/analytics'` and no token. The contract pins each
endpoint's schema; the live contract at `/api/analytics/client-contract`
carries the same hashes, so a mismatch after a definition change answers `409`.

**`@hypequery/mcp`.** The MCP bridge has no browser session, so it calls the
token-authenticated mount, one tenant per process, with the token in the
environment rather than the arguments:

```bash
export HYPEQUERY_API_KEY="$HYPEQUERY_TENANT_A_TOKEN"
npx hypequery mcp --client-contract-url http://localhost:8000/api/agents/client-contract --self-test
```

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
