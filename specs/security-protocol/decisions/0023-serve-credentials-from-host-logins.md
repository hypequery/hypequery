# 0023 — Serve credentials for users signed in to a host app

Status: **Proposed** (27 October 2026). Needs a decision before any code.

## Context

hypequery's Python framework integrations (`hypequery.contrib.django`,
`hypequery.contrib.flask`, PR #771) give server-rendered views a client bound to
the signed-in user's tenant. hypequery's HTTP endpoints (Serve) are a separate
FastAPI app, even when mounted in the same process (`mount_serve`). Serve reads
exactly one opaque credential from one header (`bearer_token()` or `api_key()`),
and the authenticator never sees the request. That is how RFC 0009's rule holds:
request input beyond the credential contributes no role, scope or tenant.

So a browser app (generated React hooks) or an agent (the MCP bridge) can't reuse
the Django or Flask login to call Serve. Building demo apps for both frameworks
(FINDINGS.md item 9), each needed a hand-written API-token table, an
authenticator over it, and a way to show the user their token. Every Django or
Flask team adopting the React client will write the same thing, and some will be
tempted to read the session cookie in an authenticator, which the current API
rightly does not allow.

Cookie authentication is refused on purpose today: `ProductionProfile` rejects
`cookie_auth=True`, and `create_app(production=...)` rejects a router whose
credential header is `cookie`.

## Options

### A. A cookie credential transport with a mandatory origin check

Add `session_cookie(name="sessionid")`: the credential is one named cookie's value,
still opaque to the authenticator, so RFC 0009's rule holds. Because browsers
attach cookies to cross-site requests, every cookie-authenticated request would
also have to pass a same-origin check (`Sec-Fetch-Site: same-origin`, or `Origin`
in an explicit allowlist) that cannot be disabled, and the production profile's
flat refusal would become "cookies require the origin check". Contrib would ship
authenticators that resolve a Django session key (via the session store) or a
Flask signed session cookie.

- For: no extra round trip; the browser's existing login just works.
- Against: relaxes a deliberate production rule; hypequery takes on a CSRF
  surface and must track browser semantics (`Sec-Fetch-*` support, SameSite
  defaults, proxies that strip headers). Each framework's session format becomes
  something Serve parses. The MCP bridge (a non-browser) gains nothing.

### B. Token exchange: the host app mints short-lived Serve tokens (recommended)

The host app, which already authenticates the user, issues a short-lived signed
bearer token. Serve verifies the signature and expiry and never sees a cookie.

- `hypequery.serve.signed_tokens`:
  - `TokenSigner(keys, *, audience, ttl=300)` with `issue(principal) -> str`.
  - `signed_token_authenticator(keys, *, audience) -> Authenticator`.
  - Format: an HMAC-SHA256 signed compact token over canonical JSON (`sub`,
    `tid`, `scopes`, `roles`, `aud`, `exp`, `iat`, `kid`).
  - Keys are a mapping `kid -> secret`, so keys can rotate.
- `hypequery.contrib.django.serve_token_view` and Flask
  `hq.add_serve_token_route(app, "/api/token")`:
  - a POST endpoint, protected by the framework's own CSRF and login;
  - it builds the `Principal` from the same `TENANT` function the views use;
  - it returns `{"token": "...", "expiresAt": "..."}`.
- React: `createHypequeryClient({ token: serveToken })`. `TokenInput` already
  accepts an async function, but the client calls it on every request and does
  not cache. So the proposal includes a small helper,
  `createServeTokenProvider({ url, refreshBeforeMs: 30_000 })`. It caches the
  token until shortly before `expiresAt`, shares one in-flight request between
  concurrent callers, and drops the cached token on a 401. Without it, every
  Serve request would first make a token request.
- MCP: unchanged. It keeps using long-lived API keys from the host's own key
  table, or a token the host issues for it.

- For: no change to Serve's credential model, the production profile or RFC
  0009. Works the same in the same process or across hosts, and for TypeScript
  Serve if the format is shared. The CSRF surface stays with the framework that
  already handles it, on a single POST endpoint.
- Against: one extra request per token lifetime, given the caching provider
  above (one per Serve request without it). hypequery owns a small token
  format (or adopts JWT; see open questions). Tokens can't be revoked before
  `exp`, so the TTL bounds exposure.

### C. Let the authenticator see the request

Rejected. It breaks the rule the auth module is built on: any request header,
query parameter or body could then contribute a tenant or scope.

## Recommendation

B. It solves the problem for both frameworks without weakening any existing
guarantee, and it gives the MCP bridge and the React client one shared model.
Revisit A only if users find the token hop unacceptable for same-origin apps.

## Security notes for B

- Bind tokens to an `aud` that names the Serve deployment; reject other audiences.
- Keep the TTL short (default 5 minutes, maximum 1 hour), with a clock-skew
  allowance of at most 30 seconds.
- Compare MACs in constant time. Reject unknown `kid`s, missing claims and
  `exp` beyond the maximum TTL.
- The issuing endpoint must require POST and the framework's CSRF protection,
  must never be public, and must derive the tenant from the server-side login,
  never from the request.
- Tokens are credentials: never logged. A `Credential`'s `repr` already redacts.
- Revocation is bounded by the TTL; key rotation (`kid`) is the emergency lever.

## Open questions for the decision

1. JWT (HS256) for interoperability with existing tooling, or a minimal
   hypequery-specific format to avoid JWT's algorithm-confusion pitfalls?
2. Should TypeScript Serve get the same verifier in the same release, with a
   shared conformance fixture family for token verification?
3. Default TTL, and whether the issue endpoint may mint MCP tokens with a longer
   TTL.
