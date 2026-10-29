- Django's `urls(api)` now checks the request's `Host` against `ALLOWED_HOSTS`
  itself, so an API without an `HttpSecurity` is protected even in a project
  without `CommonMiddleware`.
- `ServeRequest.is_disconnected` is replaced by `wait_disconnected`, an
  awaitable that returns once the caller has gone. The core no longer polls for
  disconnection every 50 ms per running query.
- The default tenant resolver runs inline instead of on a worker thread for
  every authenticated request.
- A WSGI, Django or Flask request arriving after interpreter exit has stopped
  the serving loop is refused instead of starting a loop that is never closed.
- Removed the re-export modules `hypequery.serve.security`,
  `hypequery.serve.rate_limit`, `hypequery.serve.request_ids` and
  `hypequery.serve.errors`; import those names from `hypequery.serve`.
