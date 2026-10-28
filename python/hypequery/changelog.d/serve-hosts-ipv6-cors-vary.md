- `HttpSecurity(allowed_hosts=...)` now matches bracketed IPv6 literals (`[::1]`
  allows `[::1]:8000` and `[0:0::1]`), compares names case-insensitively and
  ignores a trailing dot. An allowed host that is not a valid host, such as
  `[nope]`, is refused when the profile is built.
- With CORS configured, every response carries `Vary: Origin`, including
  responses to requests without an `Origin`, and preflight answers also vary on
  `Access-Control-Request-Method`, `-Headers` and `-Private-Network`. This
  keeps shared caches from serving one origin's answer to another.
