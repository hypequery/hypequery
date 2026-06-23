---
"@hypequery/serve": minor
---

Add first-class semantic APIs and production authentication primitives to the
Serve runtime.

- `createAPI` and the builder can register datasets and metrics backed by the
  unified dataset client, execute them programmatically, expose typed HTTP
  endpoints, and carry semantic metadata through caching and lifecycle hooks.
- Add standalone Node and Fetch adapters plus reusable API builder methods for
  composing and describing an API.
- Add context authentication, remote JWKS verification, analytics token
  issuance, and configurable auth paths for separating browser authentication
  from analytics endpoints.
- Wire configured CORS behavior through `createAPI`, including preflight and
  response headers.
