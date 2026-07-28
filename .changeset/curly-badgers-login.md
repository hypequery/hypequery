---
"@hypequery/cli": minor
---

Add browser-based Cloud login with PKCE, OS credential-vault storage, logout,
and automatic authenticated deployment.

`hypequery deploy` now also accepts an `http://127.0.0.1` or `http://localhost`
submission endpoint for local Cloud development, warning that the token is sent
in cleartext; all other endpoints still require HTTPS. `HYPEQUERY_API_TOKEN`
must now be paired with `--endpoint` or `HYPEQUERY_DEPLOYMENT_ENDPOINT` — the
CLI never combines one explicit value with the other from the stored login
profile. A `HYPEQUERY_API_TOKEN` left in a project `.env` is picked up by this
rule and must be unset to use `hypequery login`.
