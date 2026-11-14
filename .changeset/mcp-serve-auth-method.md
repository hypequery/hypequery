---
"@hypequery/mcp": patch
---

`createMCPServeAuthenticator` now accepts `@hypequery/serve` strategies such as `createJwtStrategy(...)` and `createApiKeyStrategy(...)` under `strict` mode. `MCPServeAuthRequest.method` is typed as the new `MCPServeHttpMethod` (serve's `HttpMethod`) instead of `string`.
