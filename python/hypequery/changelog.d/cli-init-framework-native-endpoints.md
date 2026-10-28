- `hypequery init --framework standalone|django|flask` chooses the application
  written beside `datasets.py` (decision 0023 step 6). `standalone`, the
  default, is `app.py`: an API from `create_api`, served as plain ASGI by
  `hypequery dev` with no web framework. It replaces the `fastapi` choice,
  which wrote the same app; to use FastAPI, mount `app` in it.
- `--framework django` writes a small runnable Django project (`settings.py`,
  `urls.py`, `manage.py`) and `analytics.py`; `--framework flask` writes a
  Flask `app.py`. Both serve hypequery's endpoints natively (`urls(api)`,
  `blueprint(api)`) twice: at `/api/analytics` behind the framework's own
  login (`django_user`, `flask_session`) with the same-origin check, and
  Django's CSRF middleware, for `@hypequery/react`; and at `/api/agents` behind
  a bearer token (`HYPEQUERY_DEV_TOKEN` in development), for `@hypequery/mcp`.
  Each also has a view or route of its own on the per-request client. Until
  wired to a login, Flask's session API and route answer 401, and
  tenant-scoped datasets refuse signed-in Django users. Pyproject extras are
  `django` or `flask`; the README covers secrets, hosts, `jwt_strategy` and
  moving the pieces into an existing Django project.
- `--framework` works with `--skip-connection`: each framework gets the
  offline orders example, with `datasets.py` and `seed.sql`. The standalone
  example's dataset now lives in `datasets.py` too.
