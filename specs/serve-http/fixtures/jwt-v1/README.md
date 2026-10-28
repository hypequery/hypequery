# Serve JWT fixtures, version 1

These language-neutral fixtures pin JWT bearer authentication in both serve
implementations: `createJwtStrategy` and `createAnalyticsTokenIssuer` in
`@hypequery/serve`, and `jwt_strategy` and `analytics_token_issuer` in
`hypequery.serve` (decision 0023 §3). A divergence is a bug in an
implementation or in this file, never a per-language difference.

`pnpm conformance:serve` runs them in both languages
(`packages/serve/src/serve-jwt-fixtures.test.ts` and
`python/hypequery/tests/test_serve_jwt_fixtures.py`).

## The file

- `secret` is the shared HMAC secret every `secret` verifier uses.
- `jwks` is the public key set every `jwks` verifier fetches. Each test serves
  it from a local HTTP server.
- `verifiers` name strategy configurations: the key source (`secret` or
  `jwks`) and, when given, `issuer`, `audience` and `algorithms`.
- `accept` cases must verify and map to `principal`: the subject, the tenant
  (`null` when none), and the roles and scopes, sorted.
- `reject` cases must be refused: TypeScript throws `AuthError('INVALID')`,
  Python raises `InvalidCredential`, and through each language's API the
  response matches `refusal` (`details` is a subset match).
- `issuer` pins the token issuer. With the clock at `issuedAt`, each language's
  issuer, given `options` and `claims`, must mint exactly its token in
  `tokens`, and both tokens' payloads must equal `payload`, key order
  included. The headers differ (Python adds `"typ": "JWT"`), which no
  verifier reads.

Every token was issued at 2026-01-01T00:00:00Z. Valid tokens expire in 2100,
so the fixtures need no clock; clock skew and expiry boundaries are tested in
each language's own suite.

## Regenerating

```bash
pnpm --filter @hypequery/serve build
node packages/serve/scripts/generate-jwt-fixtures.mjs
```

The generator makes new key pairs (and throws the private keys away), so every
asymmetric token changes. It mints the Python issuer's token through `uv`.

## What both languages enforce

- The token's `alg` must be one the verifier allows, checked before any key
  is looked up. Defaults: HS256 for a secret, RS256 for a key set. `none` is
  never allowed.
- A key set member is chosen as jose chooses it: its `kty` fits the
  algorithm, and its `kid`, `alg`, `use` (`sig`), `key_ops` (`verify`) and
  curve match where present. No match refetches the set, at most once per
  30 s; more than one match is refused.
- The claims set must be a JSON object; `NaN` and `Infinity` are not JSON.
- `iss` and `aud` are checked only when configured. `aud` may be an array
  with any member matching.
- `iat`, `nbf` and `exp` must be numbers when present. `exp <= now` and
  `nbf > now` are refused. `iat` is not compared with the clock.
- Unknown `crit` header parameters are refused.
- RSA keys under 2048 bits are refused.

## Known differences

These are deliberate, and none appears in `cases.json`.

- **A token without a string `sub`.** TypeScript accepts it with no user id.
  Python refuses it, because a `Principal` needs a subject. An empty `org_id`
  is likewise refused by Python and read as tenant `""` by TypeScript.
- **An unreachable or malformed key set.** TypeScript answers 401. Python
  answers 503: no token was judged, and a 401 would make clients discard
  valid tokens during a provider outage.
- **Configuration Python refuses at startup**: HMAC secrets shorter than the
  hash (RFC 7518 §3.2), `http` key-set URLs outside localhost, algorithms
  that do not fit the key source, and an issuer `tenant_id` of `""` (which
  TypeScript silently drops, minting a tenant-free token).

## Where TypeScript is looser than safe

Both languages share these, so the fixtures pin them
(`unchecked-issuer-audience-and-no-exp`, `iat-in-the-future`). Tightening
them is a change to both implementations and to these fixtures.

- `exp` is not required: a token without one never expires.
- With no `audience` configured, any `aud` is accepted, so a key set shared
  by several APIs (one identity-provider tenant) lets a token for one API
  authenticate to another.

TypeScript alone also accepts an `http` key-set URL anywhere (the keys can be
replaced in transit), reads a key-set response of any size, and accepts HMAC
secrets of any length. Python refuses these, as listed above, and bounds the
key-set response at 512 KiB.
