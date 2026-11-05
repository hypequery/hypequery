# MCP HTTP transport fixture v1

Shared cases for the self-hosted Streamable HTTP MCP servers in
`@hypequery/mcp` (`createMCPHttpHandler`) and `hypequery.mcp`
(`create_mcp_asgi_app`). Both test suites replay every case in
[`cases.json`](./cases.json) against their server and must produce the same
statuses, challenge headers and metadata documents.

The fixture pins the HTTP and authorization layer only: routing, Host and
Origin checks, credentials, OAuth protected-resource metadata and session
ownership. Tool results are pinned elsewhere (`bridge-manifests-v1.json`), so
the harness behind each server may serve any executor.

## Profiles

| Profile | Credential | OAuth metadata |
| --- | --- | --- |
| `static` | One static key, sent as `Authorization: Bearer <key>` | None |
| `oauth` | HS256 JWT verified by the language's existing serve JWT code, with issuer and audience checks; `org_id` is the tenant | RFC 9728 document for `https://mcp.example.test/mcp` |

In TypeScript the `oauth` profile adapts `createJwtStrategy` from
`@hypequery/serve`. In Python it runs an `Api` authenticated by
`jwt_strategy`, so the MCP server reuses the API's own authentication and
tenant resolution. The secret exists only for these tests.

## Order of checks

Every request goes through the same steps, and the first failure answers:

1. **Host** (DNS-rebinding protection). The `Host` header's name, ignoring any
   port, must be in `allowedHosts`, or the answer is `421`.
2. **Route.** `GET /.well-known/oauth-protected-resource` plus the resource's
   path serves the metadata when OAuth is configured. Any path other than the
   MCP path is `404`.
3. **Origin.** A request with an `Origin` header outside `allowedOrigins` is
   `403`. A request without one (an ordinary MCP client) is allowed.
4. **Credential.** No Bearer credential is `401` with a challenge naming no
   error. A rejected credential is `401` with `error="invalid_token"`. A
   principal missing a required scope is `403` with
   `error="insufficient_scope"` and the scopes it needs. With OAuth
   configured, each challenge carries `resource_metadata`.
5. **Session.** The SDK transport handles MCP sessions. A session belongs to
   the subject and tenant that opened it. The same principal with a new token
   continues it, and any other principal gets `404`, the same answer as an
   unknown session, so session ids leak nothing.

Error challenges never carry `error_description`, so a refusal does not reveal
why a token failed beyond its class.

## Case format

Each case names a profile and runs its `steps` in order against one fresh
server. A step's `request` has `method`, `path`, `headers` and an optional JSON
`body`. `session: <n>` sends the `mcp-session-id` returned by step `n`.
`expect.status` must match exactly. `expect.headers` values must match exactly,
with names compared case-insensitively. `expect.json` must equal the response
body parsed as JSON. `expect.session: true` requires an `mcp-session-id`
response header.

Regenerate deliberately and review the diff: these cases are what an MCP
client meets at the door of either server.
