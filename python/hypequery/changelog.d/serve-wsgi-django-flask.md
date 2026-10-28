- Django and Flask serve hypequery's HTTP endpoints natively, for
  `@hypequery/react` and `@hypequery/mcp`, with no FastAPI and no second app
  (decision 0023 step 4). `hypequery.contrib.django.urls(api)` returns URL
  patterns to `include()` below any prefix: the view is async under ASGI and
  sync under WSGI, `ServeRequest.raw` is the `HttpRequest`, and the body is
  read from the request's stream, bounded by the API's body policy rather than
  `DATA_UPLOAD_MAX_MEMORY_SIZE`. The views are CSRF-exempt because their
  credential is a header; Django's CSRF middleware stays installed.
  `hypequery.contrib.flask.blueprint(api)` returns a blueprint to register
  below any `url_prefix`; `raw` is Flask's request, and host code runs in the
  request's Flask context. Client contracts and discovery name the paths a
  request was routed under, unless `client_mount_path` is set.
- `hypequery.serve.to_wsgi_app(api)` serves an API to gunicorn, waitress or any
  WSGI framework. Sync hosts run the API on one event loop per process, on its
  own thread, while the request's thread waits and reads the body for it, so
  no loop is created per request and threaded servers serve requests
  concurrently. The loop restarts in each forked worker and stops at exit.
- `Api.handle` and `Api.serve` take `mounted_at=`, the prefix a host
  framework's router served the request under, for adapters mounted inside one.
