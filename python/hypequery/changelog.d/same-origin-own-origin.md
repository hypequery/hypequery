- The same-origin check for `from_context`, `django_user` and `flask_session`
  now also accepts an unsafe request whose `Origin` is the request's own
  origin, its scheme and `Host`, as Django's CSRF check compares them. A
  browser without Fetch Metadata (Safari before 16.4) calling its own site no
  longer needs that site listed in `CorsPolicy`. `ServeRequest` gains `scheme`,
  which every adapter fills in (Django's and Flask's own, so
  `SECURE_PROXY_SSL_HEADER` and `ProxyFix` apply); a trusted proxy's
  `X-Forwarded-Proto` overrides it.
