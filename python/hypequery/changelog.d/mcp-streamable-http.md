- `hypequery mcp --http` serves MCP over Streamable HTTP instead of stdio,
  bound to loopback by default, with `--port`, `--host`, `--allowed-hosts`
  and `--allowed-origins`. Every request checks `Host` and `Origin`
  (DNS-rebinding protection) before its credential.
- Callers send `HYPEQUERY_MCP_KEY` as a bearer token (one shared key), or,
  without it, are authenticated by the Api's own auth: the same credential is
  forwarded on every query, so the API's authentication, policy and tenant
  apply to each call as over REST. Each MCP session belongs to the principal
  that opened it, and keeps the executor it started with.
- OAuth resource-server support: `--resource` and `--authorization-servers`
  publish RFC 9728 protected-resource metadata, 401 and 403 answers carry
  RFC 6750 challenges pointing at it, and `--required-scopes` is enforced.
  The Api's `jwt_strategy` must accept the resource URL as an audience, or
  the server refuses to start. There is no authorization server.
- `hypequery.mcp` exposes `create_mcp_asgi_app` (an ASGI app that also runs
  the lifespan protocol), `McpPrincipal`, `ApiAuthenticator`,
  `static_key_authenticator`, `ApiExecutorFactory`, `HttpExecutorFactory`,
  `ProtectedResource` and `check_resource_audience`.
  `ClientContractExecutor.invalidated` and `JwtStrategy.audiences` are new
  read-only properties.
