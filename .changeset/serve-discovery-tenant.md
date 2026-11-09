---
"@hypequery/serve": patch
---

With a required tenant, the built-in `/openapi.json`, `/docs` and semantic `/contract` endpoints returned 403 for any request without a tenant, including signed-in users without one. These endpoints only describe the API and read no tenant data, so they now skip tenant resolution. Every query, dataset and discovery endpoint still requires the tenant.
