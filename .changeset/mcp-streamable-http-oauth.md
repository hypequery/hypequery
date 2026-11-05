---
"@hypequery/mcp": minor
"@hypequery/serve": minor
"@hypequery/cli": minor
---

Self-hosted remote MCP over Streamable HTTP, with OAuth resource-server support.

- `@hypequery/mcp`: `createMCPHttpHandler` answers Fetch `Request`s (Node through `listenMCPHttpServer` or `createMCPNodeRequestListener`; also Bun, Deno and Workers). Every request checks `Host` and `Origin` (DNS-rebinding protection), then the credential. Each session belongs to the principal that opened it and gets its own executor for that principal's tenant; another principal using its id gets `404`. Bodies, open sessions and idle sessions are bounded.
- Credentials: `createMCPStaticKeyAuthenticator` (one shared key), or `createMCPServeAuthenticator`, which reuses `@hypequery/serve` auth strategies such as `createJwtStrategy`. With `oauth` configured, the server publishes RFC 9728 protected-resource metadata, answers with RFC 6750 `WWW-Authenticate` challenges that point at it, and enforces `requiredScopes`. Set the JWT strategy's `audience` to the resource URL so tokens issued for other resources are refused. There is no authorization server.
- `@hypequery/serve`: the MCP source now carries the app's auth strategies and tenant extraction (`ServeMcpAuth`).
- `@hypequery/cli`: `hypequery mcp --http` with `--port`, `--host`, `--allowed-hosts`, `--allowed-origins`, and the OAuth flags `--resource`, `--authorization-servers` and `--required-scopes`. Callers send `HYPEQUERY_MCP_KEY`, or without it are verified by the app's `defineServe` auth, each with its own tenant. `--client-contract-url --http` accepts only the static key and never forwards callers' credentials.
